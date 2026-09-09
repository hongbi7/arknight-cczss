#!/usr/bin/env python3
"""Pull a CI-approved Arknights release onto an ECS host.

This program is deliberately a *pull* deployer.  GitHub never needs SSH access
to the host: a systemd timer invokes ``check`` and this process only promotes a
commit after GitHub reports a successful production CI run for that exact main
commit.  It is intended to be installed root-owned at
``/usr/local/lib/arknight-deploy/pull_deploy.py``.
"""

import argparse
import base64
import hashlib
try:  # fcntl is present on the Ubuntu production host.
    import fcntl
except ImportError:  # Allow offline unit tests to import this module on Windows.
    fcntl = None
import json
import os
try:  # POSIX-only; imported conditionally so the offline tests are portable.
    import pwd
except ImportError:
    pwd = None
import re
import shutil
import signal
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path, PurePosixPath


SHA_RE = re.compile(r"^[0-9a-f]{40}$", re.I)
SAFE_RELEASE_FILES = {"server.js", "package.json", "package-lock.json"}
SAFE_RELEASE_DIRS = {"api", "lib", "public", "server-data", "scripts"}
ARCHIVE_PATHS = ["api", "lib", "public", "server-data", "server.js", "package.json",
                 "package-lock.json", "scripts/check_deployment.js"]
REQUIRED_FILES = {"server.js", "package.json", "package-lock.json", "scripts/check_deployment.js"}
MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024


class DeployError(RuntimeError):
    """A safe deploy refusal.  The current application is left untouched."""


class PullDeployer:
    def __init__(self, config, *, api_json=None, run=None, sleep=time.sleep):
        self.config = config
        self.root = Path(config["root_dir"]).resolve()
        self.releases = self.root / "releases"
        self.cache = self.root / "repository.git"
        self.app = self.root / "app"
        self.state_path = self.root / "deploy-state.json"
        self.lock_path = self.root / "deploy.lock"
        self.api_json = api_json or self._api_json
        self.run = run or self._run
        self.sleep = sleep
        self.deploy_user = config["deploy_user"]
        self.app_user = config["app_user"]

    @classmethod
    def load(cls, filename):
        try:
            config_stat = Path(filename).stat()
            if hasattr(config_stat, "st_uid") and os.name != "nt":
                if config_stat.st_uid != 0 or config_stat.st_mode & 0o022:
                    raise DeployError("deployment configuration must be root-owned and not writable by others")
            with open(filename, encoding="utf-8") as source:
                config = json.load(source)
        except (OSError, json.JSONDecodeError) as error:
            raise DeployError("cannot read deployment configuration: " + str(error)) from error
        required = {
            "repository", "branch", "workflow", "root_dir", "service", "app_user", "deploy_user",
            "health_url", "public_url", "keep_releases",
        }
        missing = sorted(required.difference(config))
        if missing:
            raise DeployError("deployment configuration is missing: " + ", ".join(missing))
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", str(config["repository"])):
            raise DeployError("repository must be an owner/name GitHub repository")
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", str(config["branch"])):
            raise DeployError("branch contains unsupported characters")
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", str(config["workflow"])):
            raise DeployError("workflow contains unsupported characters")
        for field in ("service", "app_user", "deploy_user"):
            if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.-]*", str(config[field])):
                raise DeployError(field + " contains unsupported characters")
        if config["app_user"] == config["deploy_user"] or "root" in (config["app_user"], config["deploy_user"]):
            raise DeployError("application and deployment users must be distinct non-root accounts")
        for field in ("health_url", "public_url"):
            cls.validate_origin(field, config[field])
        if not isinstance(config["keep_releases"], int) or config["keep_releases"] < 2:
            raise DeployError("keep_releases must be an integer of at least 2")
        return cls(config)

    @staticmethod
    def validate_origin(field, value):
        if not isinstance(value, str):
            raise DeployError(field + " must be an HTTP(S) origin")
        try:
            url = urllib.parse.urlparse(value)
            # Reading port also rejects malformed or out-of-range port numbers.
            port = url.port
            if url.scheme not in ("https", "http") or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in ("", "/") or port == 0:
                raise ValueError()
        except ValueError as error:
            raise DeployError(field + " must be an HTTP(S) origin without credentials or a path") from error
        # Before a domain is configured, verify Nginx directly over loopback.
        # Remote ingress checks continue to require TLS.
        if field == "public_url" and url.scheme != "https" and url.hostname not in ("127.0.0.1", "::1"):
            raise DeployError("public_url must use HTTPS unless it is an HTTP loopback origin")

    def _log(self, message):
        print(message, flush=True)

    def _api_json(self, endpoint):
        url = "https://api.github.com" + endpoint
        headers = {"Accept": "application/vnd.github+json", "User-Agent": "arknight-pull-deploy"}
        token = os.environ.get("GITHUB_TOKEN")
        if token:
            headers["Authorization"] = "Bearer " + token
        request = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            if error.code in (403, 429):
                raise DeployError("GitHub API access denied or rate limited; check outbound access and the optional read-only token") from error
            if error.code in (401, 404):
                raise DeployError("GitHub repository is unavailable; check repository name, token expiry, and read-only Contents/Actions access") from error
            raise DeployError("GitHub API request failed (HTTP " + str(error.code) + ")") from error
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            raise DeployError("GitHub API request failed; leaving the current release running") from error

    def _run(self, command, **kwargs):
        kwargs.setdefault("check", True)
        kwargs.setdefault("text", True)
        return subprocess.run(command, **kwargs)

    def _runuser(self, user, command, **kwargs):
        kwargs.setdefault("timeout", 90)
        kwargs.setdefault("env", self._minimal_env())
        return self.run(["/usr/sbin/runuser", "-u", user, "--"] + command, **kwargs)

    def _git(self, *args, authenticated=False, **kwargs):
        """Every git invocation is performed by the non-root deploy account."""
        kwargs.setdefault("timeout", 1500)
        if authenticated:
            kwargs["env"] = self._git_fetch_env()
        try:
            return self._runuser(self.deploy_user, ["/usr/bin/git"] + list(args), **kwargs)
        except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
            raise DeployError("git operation failed; leaving the current release running") from error

    def _git_fetch_env(self):
        """Pass credentials only to fetch, never to argv, Git config, or Node."""
        environment = self._minimal_env()
        token = os.environ.get("GITHUB_TOKEN")
        if token:
            remote = "https://github.com/%s.git" % self.config["repository"]
            authorization = base64.b64encode(("x-access-token:" + token).encode()).decode("ascii")
            environment.update({
                "GIT_CONFIG_COUNT": "3",
                "GIT_CONFIG_KEY_0": "credential.helper",
                "GIT_CONFIG_VALUE_0": "",
                "GIT_CONFIG_KEY_1": "http." + remote + ".extraHeader",
                "GIT_CONFIG_VALUE_1": "Authorization: Basic " + authorization,
                "GIT_CONFIG_KEY_2": "http.followRedirects",
                "GIT_CONFIG_VALUE_2": "false",
            })
        return environment

    def _assert_layout(self):
        if os.geteuid() != 0:
            raise DeployError("pull_deploy.py must be run by root from its systemd service")
        if not self.root.is_dir() or self.root.parent == self.root:
            raise DeployError("root_dir must be an existing, non-root directory")
        if self.root.lstat().st_uid != 0 or self.root.stat().st_mode & 0o022:
            raise DeployError("root_dir must be root-owned and not writable by other users")
        for item in (self.releases, self.cache):
            if item.is_symlink() or item.resolve() != self.root / item.name:
                raise DeployError("managed cache and release paths must not be symlinks")
            if not item.exists():
                raise DeployError(str(item) + " is missing; run the installer first")
        if not self.releases.is_dir() or not self.cache.is_dir():
            raise DeployError("release cache paths must be directories")
        # Resolve users now: this turns a typo into a non-mutating failure.
        user_ids = []
        for user in (self.deploy_user, self.app_user):
            try:
                if pwd is not None:
                    user_ids.append(pwd.getpwnam(user).pw_uid)
            except KeyError as error:
                raise DeployError("configured user does not exist: " + user) from error
        if 0 in user_ids or len(set(user_ids)) != len(user_ids):
            raise DeployError("deployment and application accounts must have distinct non-root UIDs")

    def _state(self):
        try:
            with open(self.state_path, encoding="utf-8") as source:
                state = json.load(source)
            if not isinstance(state, dict):
                raise ValueError()
        except FileNotFoundError:
            return {"pinned": False, "known_good": []}
        except (OSError, ValueError, json.JSONDecodeError) as error:
            raise DeployError("deployment state is unreadable; refusing to change the live release") from error
        state.setdefault("pinned", False)
        state.setdefault("known_good", [])
        if not isinstance(state["known_good"], list) or any(not isinstance(item, str) or not SHA_RE.fullmatch(item) for item in state["known_good"]):
            raise DeployError("deployment state is invalid; refusing to change the live release")
        return state

    def _write_state(self, state):
        temporary = self.state_path.with_name(self.state_path.name + ".new")
        data = json.dumps(state, sort_keys=True, indent=2) + "\n"
        with open(temporary, "w", encoding="utf-8") as destination:
            destination.write(data)
            destination.flush()
            os.fsync(destination.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, self.state_path)

    def _locked(self):
        self.lock_path.parent.mkdir(mode=0o755, exist_ok=True)
        lock = open(self.lock_path, "a+", encoding="utf-8")
        if fcntl is None:
            return lock
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            lock.close()
            raise DeployError("another deployment check is already running")
        return lock

    def _main_sha(self):
        repo = urllib.parse.quote(self.config["repository"], safe="/")
        branch = urllib.parse.quote(self.config["branch"], safe="")
        payload = self.api_json("/repos/" + repo + "/commits/" + branch)
        sha = payload.get("sha") if isinstance(payload, dict) else None
        if not isinstance(sha, str) or not SHA_RE.fullmatch(sha):
            raise DeployError("GitHub returned no usable main commit; leaving the current release running")
        return sha.lower()

    def approved_run(self, sha):
        repo = urllib.parse.quote(self.config["repository"], safe="/")
        workflow = urllib.parse.quote(self.config["workflow"], safe="")
        branch = urllib.parse.quote(self.config["branch"], safe="")
        endpoint = "/repos/%s/actions/workflows/%s/runs?branch=%s&per_page=30" % (repo, workflow, branch)
        payload = self.api_json(endpoint)
        runs = payload.get("workflow_runs", []) if isinstance(payload, dict) else []
        for run in runs:
            head_repo = ((run.get("head_repository") or {}).get("full_name"))
            if (
                run.get("head_sha", "").lower() == sha
                and run.get("event") in ("push", "workflow_dispatch")
                and run.get("head_branch") == self.config["branch"]
                and head_repo == self.config["repository"]
            ):
                # The API lists newest runs first. Do not fall back to an older
                # success when the same commit's latest validation is failing.
                if run.get("status") == "completed" and run.get("conclusion") == "success":
                    return run.get("html_url") or "GitHub Actions run"
                return None
        return None

    def _git_fetch(self, sha):
        remote = "https://github.com/%s.git" % self.config["repository"]
        if not (self.cache / "HEAD").exists():
            self._git("init", "--bare", str(self.cache))
        self._git("-C", str(self.cache), "remote", "remove", "origin", check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self._git("-C", str(self.cache), "remote", "add", "origin", remote)
        branch_ref = "refs/remotes/origin/" + self.config["branch"]
        self._git("-c", "pack.threads=1", "-C", str(self.cache), "fetch", "--depth=1", "--no-tags", "origin", "+%s:%s" % (self.config["branch"], branch_ref), authenticated=True)
        actual = self._git("-C", str(self.cache), "rev-parse", branch_ref, capture_output=True).stdout.strip().lower()
        if actual != sha:
            raise DeployError("GitHub main changed while fetching; retry on the next timer run")
        self._git("-C", str(self.cache), "cat-file", "-e", sha + "^{commit}")

    @staticmethod
    def _safe_member(name):
        parts = PurePosixPath(name).parts
        if not name or name.startswith("/") or ".." in parts or "\\" in name or ":" in name:
            return False
        top = parts[0] if parts else ""
        if top in SAFE_RELEASE_FILES:
            return len(parts) == 1
        if top not in SAFE_RELEASE_DIRS:
            return False
        if top == "scripts":
            return len(parts) == 1 or name == "scripts/check_deployment.js"
        return True

    def _extract_archive(self, sha, staging):
        archive = staging.parent / ("." + sha + ".tar")
        try:
            with open(archive, "wb") as destination:
                self._git("-C", str(self.cache), "archive", "--format=tar", sha, "--",
                          *ARCHIVE_PATHS, stdout=destination, stderr=subprocess.PIPE)
            with tarfile.open(archive, "r:") as source:
                members = source.getmembers()
                for member in members:
                    if not self._safe_member(member.name) or not (member.isfile() or member.isdir()):
                        raise DeployError("release archive contains an unsafe path or non-regular file")
                # Members were checked above before extraction.  Extracting one at
                # a time keeps this compatible with Ubuntu's Python 3.10 as well
                # as newer releases where tarfile's ``filter=`` API exists.
                for member in members:
                    member.uid = member.gid = 0
                    member.uname = member.gname = "root"
                    member.mode = 0o755 if member.isdir() else 0o644
                    source.extract(member, staging)
            missing = [name for name in REQUIRED_FILES if not (staging / name).is_file()]
            if missing:
                raise DeployError("release archive is missing required runtime files")
        except subprocess.TimeoutExpired as error:
            raise DeployError("git archive timed out; leaving the current release running") from error
        finally:
            archive.unlink(missing_ok=True)

    def _assert_no_dependencies(self, staging):
        try:
            package = json.loads((staging / "package.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise DeployError("release package.json is invalid") from error
        if package.get("dependencies") or package.get("optionalDependencies"):
            raise DeployError("production dependencies were added; update the deployment flow before releasing")

    def _assert_data_ready(self, staging):
        try:
            version = json.loads((staging / "server-data" / "data-version.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise DeployError("release data-version.json is missing or invalid") from error
        if version.get("status") != "ready":
            raise DeployError("release data is not marked ready; refusing a partial data update")

    @staticmethod
    def _make_runtime_readable(staging):
        """The root-created staging tree must be readable by the smoke user."""
        for current, directories, files in os.walk(staging):
            os.chmod(current, 0o755)
            for directory in directories:
                os.chmod(os.path.join(current, directory), 0o755)
            for filename in files:
                os.chmod(os.path.join(current, filename), 0o644)

    @staticmethod
    def _free_port():
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.bind(("127.0.0.1", 0))
            return listener.getsockname()[1]

    def _minimal_env(self, **extra):
        environment = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "NODE_ENV": "production",
                       "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null",
                       "GIT_TERMINAL_PROMPT": "0"}
        environment.update(extra)
        return environment

    def _wait_url(self, url, expected_sha, seconds=25):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            try:
                request = urllib.request.Request(url + "/api/health", headers={"Accept": "application/json"})
                with urllib.request.urlopen(request, timeout=3) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                if payload.get("status") == "ok" and payload.get("release", "").lower() == expected_sha:
                    return
            except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError):
                pass
            self.sleep(0.2)
        raise DeployError("health endpoint did not report the expected release")

    def _node_check(self, cwd, base_url, sha):
        self._runuser(self.app_user, ["/usr/bin/node", "scripts/check_deployment.js", "--base-url", base_url, "--expected-commit", sha], cwd=str(cwd), env=self._minimal_env(SERVE_STATIC="false"))

    def _candidate_check(self, staging, sha):
        port = self._free_port()
        process = subprocess.Popen(
            ["/usr/sbin/runuser", "-u", self.app_user, "--", "/usr/bin/node", "--max-old-space-size=384", "server.js", "--host", "127.0.0.1", "--port", str(port)],
            cwd=str(staging), env=self._minimal_env(SERVE_STATIC="false"), stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True, text=True,
        )
        base_url = "http://127.0.0.1:" + str(port)
        try:
            self._wait_url(base_url, sha)
            self._node_check(staging, base_url, sha)
        finally:
            # A runuser parent may already have exited while its child remains.
            # Always clean the isolated process group we created.
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            if process.poll() is None:
                try:
                    process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    process.wait(timeout=3)

    def _release_dir(self, sha):
        if not SHA_RE.fullmatch(sha):
            raise DeployError("invalid release SHA")
        raw = self.releases / sha.lower()
        if raw.is_symlink():
            raise DeployError("release directories must not be symlinks")
        result = raw.resolve()
        if result.parent != self.releases.resolve():
            raise DeployError("release path escaped the releases directory")
        return result

    def _create_release(self, sha):
        release = self._release_dir(sha)
        if release.exists():
            # A previous attempt may have completed staging but never promoted.
            # Re-test it, and reject an incomplete or mismatched directory.
            try:
                marker = json.loads((release / "deployment-version.json").read_text())
            except (OSError, ValueError) as error:
                raise DeployError("existing release is incomplete; inspect it before retrying") from error
            if marker.get("commit") != sha:
                raise DeployError("existing release metadata does not match its directory")
            self._assert_no_dependencies(release)
            self._assert_data_ready(release)
            self._candidate_check(release, sha)
            return release
        staging = Path(tempfile.mkdtemp(prefix="." + sha + ".", dir=self.releases))
        try:
            self._extract_archive(sha, staging)
            self._assert_no_dependencies(staging)
            self._assert_data_ready(staging)
            (staging / "deployment-version.json").write_text(json.dumps({"commit": sha}) + "\n", encoding="utf-8")
            self._make_runtime_readable(staging)
            self._candidate_check(staging, sha)
            os.replace(staging, release)
            self._log("candidate passed " + sha)
            return release
        except BaseException:
            shutil.rmtree(staging, ignore_errors=True)
            raise

    def _assert_disk_space(self):
        try:
            free = shutil.disk_usage(self.releases).free
        except OSError as error:
            raise DeployError("cannot determine release filesystem free space") from error
        if free < MIN_FREE_BYTES:
            raise DeployError("less than 2 GiB free for a safe staged release; leaving current release running")

    def _app_target(self):
        if not self.app.exists() and not self.app.is_symlink():
            raise DeployError("app link is missing; run the deployment installer first")
        if not self.app.is_symlink():
            raise DeployError("app must be a symlink; refusing to migrate a live directory automatically")
        target = self.app.resolve(strict=True)
        in_releases = target.parent == self.releases.resolve() and SHA_RE.fullmatch(target.name)
        is_baseline = target.parent == self.root and target.name.startswith("app-manual-backup-")
        if not target.is_dir() or not (in_releases or is_baseline):
            raise DeployError("app symlink points outside the managed deployment root")
        return target

    def _switch(self, release):
        temporary = self.root / ".app.next"
        temporary.unlink(missing_ok=True)
        os.symlink(str(release), temporary)
        os.replace(temporary, self.app)

    def _systemctl(self, *args):
        self.run(["/usr/bin/systemctl"] + list(args), timeout=90, env=self._minimal_env())

    def _public_check(self, sha):
        public_root = self.config["public_url"].rstrip("/")
        def public_bytes(path):
            request = urllib.request.Request(public_root + path + "?deploy=" + sha, headers={"Cache-Control": "no-cache"})
            with urllib.request.urlopen(request, timeout=12) as response:
                if response.status != 200:
                    raise ValueError()
                final = response.geturl()
                expected_prefix = public_root + path
                if not final.startswith(expected_prefix):
                    raise ValueError()
                return response.read()
        try:
            with urllib.request.urlopen(public_root + "/api/health", timeout=12) as response:
                payload = json.loads(response.read().decode("utf-8"))
            if payload.get("status") != "ok" or payload.get("release", "").lower() != sha:
                raise ValueError()
            # Nginx must serve the same symlink target as Node.  A plain 200 for
            # the homepage is insufficient when an old static root is configured.
            static_pairs = (("/index.html", "index.html"), ("/data/names.json", "data/names.json"))
            for url_path, release_path in static_pairs:
                expected = (self.app / "public" / release_path).read_bytes()
                actual = public_bytes(url_path)
                if hashlib.sha256(actual).digest() != hashlib.sha256(expected).digest():
                    raise ValueError()
        except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError) as error:
            raise DeployError("Nginx entry health or static version verification failed") from error

    def _verify_live(self, sha=None):
        self._systemctl("is-active", "--quiet", self.config["service"])
        if sha:
            self._wait_url(self.config["health_url"].rstrip("/"), sha, seconds=15)
            self._node_check(self.app, self.config["health_url"], sha)
            self._public_check(sha)
            return
        # Manual baseline releases predate /api/health.  Verify a playable opening
        # instead, without executing any application code as root.
        request = urllib.request.Request(self.config["health_url"].rstrip("/") + "/api/new?mode=sudden&v=3")
        try:
            deadline = time.monotonic() + 15
            while True:
                try:
                    with urllib.request.urlopen(request, timeout=3) as response:
                        data = json.loads(response.read().decode("utf-8"))
                    if data.get("mode") != "sudden" or not isinstance(data.get("token"), str) or not data["token"]:
                        raise ValueError()
                    break
                except (urllib.error.URLError, TimeoutError, ValueError):
                    if time.monotonic() >= deadline:
                        raise
                    self.sleep(0.2)
            with urllib.request.urlopen(self.config["public_url"], timeout=12) as response:
                if response.status != 200:
                    raise ValueError()
        except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError) as error:
            raise DeployError("restored baseline did not pass its playable smoke check") from error

    def _restore(self, previous, previous_sha):
        self._switch(previous)
        self._systemctl("restart", self.config["service"])
        self._verify_live(previous_sha)

    def _recover_pending(self, state):
        pending = state.get("pending")
        if not pending:
            return
        if not isinstance(pending, dict) or not isinstance(pending.get("previous"), str):
            raise DeployError("interrupted deployment state is invalid; inspect it before continuing")
        previous = Path(pending["previous"])
        is_release = previous.parent == self.releases and SHA_RE.fullmatch(previous.name)
        is_baseline = previous.parent == self.root and previous.name.startswith("app-manual-backup-")
        if previous.is_symlink() or not previous.is_dir() or not (is_release or is_baseline):
            raise DeployError("interrupted deployment has no safe previous release to restore")
        previous_sha = previous.name if is_release else None
        self._log("recovering an interrupted deployment")
        self._restore(previous, previous_sha)
        state.update({"pinned": True, "failed_commit": pending.get("candidate")})
        state.pop("pending", None)
        self._write_state(state)

    def _promote(self, release, sha, state, pin=False):
        previous = self._app_target()
        previous_sha = previous.name.lower() if SHA_RE.fullmatch(previous.name) else None
        # Persist before switching so a power loss or SIGKILL can be recovered on
        # the next timer invocation. Only this installed root-owned program writes state.
        state["pending"] = {"previous": str(previous), "candidate": sha}
        self._write_state(state)
        try:
            self._switch(release)
            self._systemctl("restart", self.config["service"])
            self._verify_live(sha)
        except BaseException as original:
            state.update({"pinned": True, "failed_commit": sha})
            try:
                self._restore(previous, previous_sha)
            except BaseException as rollback_error:
                self._write_state(state)
                raise DeployError("new release failed and rollback also failed; pending recovery was retained for the next check") from rollback_error
            # A bad release must not restart the game every five minutes.  An
            # operator explicitly resumes automatic deployment after diagnosis.
            state.pop("pending", None)
            self._write_state(state)
            raise DeployError("new release failed; previous release was restored") from original
        known = [sha] + [item for item in state.get("known_good", []) if item != sha and SHA_RE.fullmatch(item)]
        state.pop("pending", None)
        state.pop("failed_commit", None)
        state.update({"pinned": pin, "last_successful": sha, "known_good": known})
        self._write_state(state)
        try:
            self._cleanup(keep_current=sha, keep_previous=previous_sha)
        except OSError:
            self._log("release is healthy, but old release cleanup needs attention")
        self._log("deployed " + sha)

    def _cleanup(self, keep_current, keep_previous=None):
        candidates = []
        for entry in self.releases.iterdir():
            if entry.is_dir() and not entry.is_symlink() and SHA_RE.fullmatch(entry.name):
                candidates.append(entry)
        candidates.sort(key=lambda item: item.stat().st_mtime, reverse=True)
        protected = {keep_current.lower()}
        if keep_previous:
            protected.add(keep_previous.lower())
        keep = set(protected)
        for item in candidates:
            if len(keep) >= self.config["keep_releases"]:
                break
            keep.add(item.name.lower())
        for item in candidates:
            if item.name.lower() not in keep:
                shutil.rmtree(item)

    def check(self):
        self._assert_layout()
        with self._locked():
            state = self._state()
            self._recover_pending(state)
            if state.get("pinned"):
                self._log("automatic deployment is pinned")
                return False
            sha = self._main_sha()
            if sha == state.get("last_successful") and self._app_target() == self._release_dir(sha):
                self._log("already deployed " + sha)
                return False
            run_url = self.approved_run(sha)
            if not run_url:
                self._log("no successful production CI run for " + sha)
                return False
            self._log("approved " + sha + " " + run_url)
            self._assert_disk_space()
            self._git_fetch(sha)
            # Re-check immediately before switching: a newer main must win the
            # next timer cycle, never be silently replaced by an older commit.
            if self._main_sha() != sha:
                raise DeployError("GitHub main advanced before release switch; retry later")
            release = self._create_release(sha)
            if self._main_sha() != sha:
                raise DeployError("GitHub main advanced during candidate verification; retry later")
            self._promote(release, sha, state)
            return True

    def rollback(self, sha):
        sha = sha.lower()
        self._assert_layout()
        with self._locked():
            state = self._state()
            self._recover_pending(state)
            if sha not in state.get("known_good", []):
                raise DeployError("rollback SHA is not a previously health-verified release")
            release = self._release_dir(sha)
            if not release.is_dir() or not (release / "deployment-version.json").is_file():
                raise DeployError("rollback release is incomplete or no longer present")
            self._candidate_check(release, sha)
            self._promote(release, sha, state, pin=True)
            self._log("rolled back to " + sha + "; automatic deployment pinned")

    def resume(self):
        self._assert_layout()
        with self._locked():
            state = self._state()
            self._recover_pending(state)
            state["pinned"] = False
            self._write_state(state)
            self._log("automatic deployment resumed")

    def status(self):
        self._assert_layout()
        with self._locked():
            state = self._state()
            target = self._app_target()
            self._log("app=" + target.name + " pinned=" + str(bool(state.get("pinned"))).lower())
            if state.get("pending"):
                self._log("an interrupted deployment needs recovery: run check")
            for sha in state["known_good"]:
                if self._release_dir(sha).is_dir():
                    self._log("available rollback: " + sha)
            return state


def main(argv=None):
    parser = argparse.ArgumentParser(description="Pull a successful GitHub CI release onto ECS")
    parser.add_argument("--config", default="/etc/arknight-deploy.json")
    parser.add_argument("command", choices=("check", "status", "rollback", "resume"), nargs="?", default="check")
    parser.add_argument("sha", nargs="?")
    arguments = parser.parse_args(argv)
    if arguments.command == "rollback" and (not arguments.sha or not SHA_RE.fullmatch(arguments.sha)):
        parser.error("rollback requires a 40-character commit SHA")
    if arguments.command != "rollback" and arguments.sha:
        parser.error("only rollback accepts a SHA")
    def interrupted(_signum, _frame):
        raise DeployError("deployment interrupted by the service manager")

    signal.signal(signal.SIGTERM, interrupted)
    try:
        deployer = PullDeployer.load(arguments.config)
        if arguments.command == "check":
            deployer.check()
        elif arguments.command == "status":
            deployer.status()
        elif arguments.command == "rollback":
            deployer.rollback(arguments.sha)
        else:
            deployer.resume()
    except DeployError as error:
        print("deployment refused: " + str(error), file=sys.stderr)
        return 1
    except (OSError, subprocess.SubprocessError, KeyboardInterrupt):
        print("deployment failed; inspect the service log and deployment state before retrying", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
