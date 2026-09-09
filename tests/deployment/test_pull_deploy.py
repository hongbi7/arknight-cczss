import importlib.util
import base64
import copy
import io
import json
import os
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


MODULE = Path(__file__).resolve().parents[2] / "deploy" / "pull_deploy.py"
SPEC = importlib.util.spec_from_file_location("pull_deploy", MODULE)
pull_deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pull_deploy)

SHA_A = "a" * 40
SHA_B = "b" * 40
SHA_C = "c" * 40
SHA_D = "d" * 40


def config(root):
    return {
        "repository": "hongbi7/arknight-cczss",
        "branch": "main",
        "workflow": "production-ci.yml",
        "root_dir": str(root),
        "service": "arknight-guess",
        "app_user": "arkguess",
        "deploy_user": "arkdeploy",
        "health_url": "http://127.0.0.1:3000",
        "public_url": "https://example.test",
        "keep_releases": 3,
    }


class TemporaryDeploy(unittest.TestCase):
    def setUp(self):
        self.directory = Path(tempfile.mkdtemp(prefix="pull-deploy-test-"))
        (self.directory / "releases").mkdir()
        (self.directory / "repository.git").mkdir()

    def tearDown(self):
        target = self.directory.resolve()
        if target.parent != Path(tempfile.gettempdir()).resolve() or not target.name.startswith("pull-deploy-test-"):
            raise RuntimeError("refusing to clean up a path outside the test temporary directory")
        def remove_readonly(function, filename, error):
            if os.name != "nt":
                raise error[1]
            # Git marks loose objects read-only on Windows.
            os.chmod(filename, 0o700)
            function(filename)
        shutil.rmtree(target, onerror=remove_readonly)

    def deployer(self, **kwargs):
        return pull_deploy.PullDeployer(config(self.directory), sleep=lambda _seconds: None, **kwargs)


class NginxEntryTests(TemporaryDeploy):
    def test_entry_accepts_loopback_http_and_https_domain(self):
        for origin in ("http://127.0.0.1", "http://127.0.0.1:8080", "http://[::1]", "https://example.test"):
            pull_deploy.PullDeployer.validate_origin("public_url", origin)

    def test_entry_rejects_remote_http_and_invalid_origins(self):
        for origin in ("http://example.test", "http://192.0.2.1", "http://127.0.0.1.example.test",
                       "https://user:password@example.test", "http://127.0.0.1:70000", "", None):
            with self.subTest(origin=origin):
                with self.assertRaises(pull_deploy.DeployError):
                    pull_deploy.PullDeployer.validate_origin("public_url", origin)

    def test_loopback_nginx_checks_api_and_both_static_files(self):
        deployer = self.deployer()
        deployer.config["public_url"] = "http://127.0.0.1"
        files = {"/index.html": b"<html>current release</html>", "/data/names.json": b'["operator"]'}
        for relative, contents in files.items():
            destination = deployer.app / "public" / relative.lstrip("/")
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(contents)
        responses = {"/api/health": json.dumps({"status": "ok", "release": SHA_A}).encode(), **files}
        visited = []
        def request(url, **_kwargs):
            address = url.full_url if isinstance(url, pull_deploy.urllib.request.Request) else url
            parsed = pull_deploy.urllib.parse.urlparse(address)
            self.assertEqual(parsed.scheme, "http")
            self.assertEqual(parsed.netloc, "127.0.0.1")
            visited.append(parsed.path)
            result = mock.MagicMock()
            result.__enter__.return_value = result
            result.status = 200
            result.geturl.return_value = address
            result.read.return_value = responses[parsed.path]
            return result
        with mock.patch.object(pull_deploy.urllib.request, "urlopen", side_effect=request):
            deployer._public_check(SHA_A)
            self.assertEqual(visited, ["/api/health", "/index.html", "/data/names.json"])
            responses["/index.html"] = b"<html>old release</html>"
            with self.assertRaisesRegex(pull_deploy.DeployError, "static version"):
                deployer._public_check(SHA_A)


class GitHubSelectionTests(TemporaryDeploy):
    def test_only_matching_successful_main_workflow_is_approved(self):
        deployer = self.deployer(api_json=lambda _endpoint: {})
        run = {
            "head_sha": SHA_A,
            "status": "completed",
            "conclusion": "success",
            "event": "push",
            "head_branch": "main",
            "head_repository": {"full_name": "hongbi7/arknight-cczss"},
            "html_url": "https://github.example/runs/1",
        }
        deployer.api_json = lambda _endpoint: {"workflow_runs": [run]}
        self.assertEqual(deployer.approved_run(SHA_A), "https://github.example/runs/1")

        for field, value in (("conclusion", "failure"), ("event", "pull_request"), ("head_branch", "other")):
            rejected = dict(run)
            rejected[field] = value
            deployer.api_json = lambda _endpoint, rejected=rejected: {"workflow_runs": [rejected]}
            self.assertIsNone(deployer.approved_run(SHA_A), field)

        wrong_repository = dict(run, head_repository={"full_name": "fork/arknight-cczss"})
        deployer.api_json = lambda _endpoint: {"workflow_runs": [wrong_repository]}
        self.assertIsNone(deployer.approved_run(SHA_A))

        # A fresh failed/in-progress run must supersede a prior success for the SHA.
        for latest in (dict(run, conclusion="failure"), dict(run, status="in_progress", conclusion=None)):
            deployer.api_json = lambda _endpoint, latest=latest: {"workflow_runs": [latest, run]}
            self.assertIsNone(deployer.approved_run(SHA_A))

    def test_pin_skips_network_and_resume_clears_it(self):
        deployer = self.deployer(api_json=lambda _endpoint: self.fail("network must not be queried while pinned"))
        deployer._assert_layout = lambda: None
        deployer._state = lambda: {"pinned": True, "known_good": []}
        self.assertFalse(deployer.check())

        written = []
        deployer._state = lambda: {"pinned": True, "known_good": []}
        deployer._write_state = written.append
        deployer.resume()
        self.assertEqual(written, [{"pinned": False, "known_good": []}])

    def test_main_advancing_during_candidate_check_does_not_switch(self):
        deployer = self.deployer()
        deployer._assert_layout = lambda: None
        deployer._assert_disk_space = lambda: None
        deployer._main_sha = mock.Mock(side_effect=[SHA_A, SHA_A, SHA_B])
        deployer.approved_run = lambda _sha: "https://example.test/ci"
        deployer._git_fetch = lambda _sha: None
        deployer._create_release = lambda sha: self.directory / "releases" / sha
        deployer._promote = lambda *_args: self.fail("stale candidate must not be promoted")
        with self.assertRaisesRegex(pull_deploy.DeployError, "during candidate"):
            deployer.check()


class PrivateRepositoryTests(TemporaryDeploy):
    def test_token_reaches_only_authenticated_fetch_and_never_command_arguments(self):
        calls = []
        token = "fake-read-only-deployment-token"
        encoded = base64.b64encode(("x-access-token:" + token).encode()).decode()
        deployer = self.deployer(run=lambda command, **kwargs: calls.append((command, kwargs)))
        with mock.patch.dict(os.environ, {"GITHUB_TOKEN": token, "GAME_SECRET": "production-secret", "GIT_TRACE_CURL": "1"}):
            deployer._git("fetch", "origin", authenticated=True)
            deployer._git("archive", SHA_A)
            deployer._runuser("arkguess", ["/usr/bin/node", "server.js"])
        fetch_command, fetch_options = calls[0]
        self.assertEqual(fetch_command[:4], ["/usr/sbin/runuser", "-u", "arkdeploy", "--"])
        environment = fetch_options["env"]
        self.assertEqual(environment["GIT_CONFIG_KEY_1"], "http.https://github.com/hongbi7/arknight-cczss.git.extraHeader")
        self.assertEqual(environment["GIT_CONFIG_VALUE_1"], "Authorization: Basic " + encoded)
        self.assertEqual(environment["GIT_CONFIG_VALUE_0"], "")
        self.assertEqual(environment["GIT_CONFIG_VALUE_2"], "false")
        for command, options in calls:
            self.assertNotIn(token, str(command))
            self.assertNotIn(encoded, str(command))
            self.assertNotIn("GITHUB_TOKEN", options["env"])
            self.assertNotIn("GAME_SECRET", options["env"])
            self.assertNotIn("GIT_TRACE_CURL", options["env"])
        for _, options in calls[1:]:
            self.assertNotIn("GIT_CONFIG_COUNT", options["env"])
            self.assertNotIn(encoded, str(options["env"]))

    def test_public_repository_fetch_without_token_stays_anonymous(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            environment = self.deployer()._git_fetch_env()
        self.assertNotIn("GIT_CONFIG_COUNT", environment)
        self.assertEqual(environment["GIT_TERMINAL_PROMPT"], "0")

    def test_git_fetch_authenticates_only_network_operation(self):
        calls = []
        deployer = self.deployer()
        def git(*args, **kwargs):
            calls.append((args, kwargs))
            return SimpleNamespace(stdout=SHA_A)
        deployer._git = git
        deployer._git_fetch(SHA_A)
        authenticated = [args for args, kwargs in calls if kwargs.get("authenticated")]
        self.assertEqual(len(authenticated), 1)
        self.assertIn("fetch", authenticated[0])
        self.assertIn("origin", authenticated[0])


class ArchiveSafetyTests(TemporaryDeploy):
    def _tar_runner(self, body):
        def fake_run(command, **kwargs):
            self.assertEqual(command[:6], ["/usr/sbin/runuser", "-u", "arkdeploy", "--", "/usr/bin/git", "-C"])
            self.assertEqual(command[-len(pull_deploy.ARCHIVE_PATHS):], pull_deploy.ARCHIVE_PATHS)
            with tarfile.open(fileobj=kwargs["stdout"], mode="w") as archive:
                for name, content, kind in body:
                    item = tarfile.TarInfo(name)
                    if kind == "file":
                        item.size = len(content)
                        archive.addfile(item, io.BytesIO(content))
                    elif kind == "symlink":
                        item.type = tarfile.SYMTYPE
                        item.linkname = content.decode()
                        archive.addfile(item)
                    elif kind == "directory":
                        item.type = tarfile.DIRTYPE
                        archive.addfile(item)
            return SimpleNamespace(returncode=0)
        return fake_run

    def test_archive_rejects_path_escape_and_links(self):
        for bad_name, kind in (("../outside", "file"), ("public/link", "symlink")):
            deployer = self.deployer()
            staging = self.directory / ("stage-" + bad_name.replace("/", "-"))
            staging.mkdir()
            with mock.patch.object(pull_deploy.subprocess, "run", self._tar_runner([(bad_name, b"x", kind)])):
                with self.assertRaisesRegex(pull_deploy.DeployError, "unsafe"):
                    deployer._extract_archive(SHA_A, staging)
            self.assertFalse((self.directory / "outside").exists())

    def test_runtime_dependencies_require_a_deployment_flow_change(self):
        deployer = self.deployer()
        stage = self.directory / "stage"
        stage.mkdir()
        (stage / "package.json").write_text(json.dumps({"dependencies": {"new-package": "1"}}))
        with self.assertRaisesRegex(pull_deploy.DeployError, "production dependencies"):
            deployer._assert_no_dependencies(stage)

    def test_full_runtime_archive_can_be_staged_and_is_readable(self):
        deployer = self.deployer()
        files = [
            ("scripts/", b"", "directory"),
            ("server-data/", b"", "directory"),
            ("server.js", b"// runtime", "file"),
            ("package.json", b"{}", "file"),
            ("package-lock.json", b"{}", "file"),
            ("scripts/check_deployment.js", b"// smoke", "file"),
            ("scripts/check_image_pages.js", b"// image smoke", "file"),
            ("server-data/data-version.json", b'{"status":"ready"}', "file"),
        ]
        checked = []
        def candidate(stage, sha):
            self.assertTrue(stage.stat().st_mode & 0o004)
            self.assertEqual(json.loads((stage / "deployment-version.json").read_text())["commit"], sha)
            checked.append(sha)
        deployer._candidate_check = candidate
        with mock.patch.object(pull_deploy.subprocess, "run", self._tar_runner(files)):
            release = deployer._create_release(SHA_A)
        self.assertEqual(release, self.directory / "releases" / SHA_A)
        self.assertEqual(checked, [SHA_A])
        self.assertFalse((release / ".git").exists())
        self.assertFalse(any(item.name.startswith(".") for item in deployer.releases.iterdir()))
        # Reuse is still verified, rather than trusting a partially staged path.
        self.assertEqual(deployer._create_release(SHA_A), release)
        self.assertEqual(checked, [SHA_A, SHA_A])

    def test_partial_data_cannot_be_staged(self):
        stage = self.directory / "stage"
        (stage / "server-data").mkdir(parents=True)
        (stage / "server-data/data-version.json").write_text('{"status":"asset_refresh_required"}')
        with self.assertRaisesRegex(pull_deploy.DeployError, "not marked ready"):
            self.deployer()._assert_data_ready(stage)

    def test_disk_shortage_fails_before_fetch_or_switch(self):
        deployer = self.deployer()
        with mock.patch.object(pull_deploy.shutil, "disk_usage", return_value=SimpleNamespace(free=1024)):
            with self.assertRaisesRegex(pull_deploy.DeployError, "2 GiB"):
                deployer._assert_disk_space()

    @unittest.skipUnless(shutil.which("git"), "Git is required for the archive integration check")
    def test_real_git_archive_excludes_nonruntime_files(self):
        source = self.directory / "source"
        source.mkdir()
        fixtures = {
            "server.js": "// fixture", "package.json": "{}", "package-lock.json": "{}",
            "scripts/check_deployment.js": "// fixture", "scripts/check_image_pages.js": "// image fixture", "server-data/data-version.json": '{"status":"ready"}',
            "api/new.js": "// fixture", "lib/game.js": "// fixture", "public/index.html": "<html></html>",
            "docs/private.md": "not in runtime", "scripts/build_data.py": "not in runtime",
            ".github/workflows/ci.yml": "not in runtime",
        }
        for name, contents in fixtures.items():
            target = source / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(contents)
        git = shutil.which("git")
        environment = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}
        def local_git(*args):
            return subprocess.run([git, "-C", str(source), *args], env=environment,
                                  check=True, text=True, capture_output=True)
        local_git("init")
        local_git("add", ".")
        local_git("-c", "user.name=Deployment Test", "-c", "user.email=deployment@example.invalid",
                  "commit", "-m", "Archive fixture")
        sha = local_git("rev-parse", "HEAD").stdout.strip()
        def local_archive(command, **kwargs):
            self.assertEqual(command[:5], ["/usr/sbin/runuser", "-u", "arkdeploy", "--", "/usr/bin/git"])
            kwargs["env"] = environment
            return subprocess.run([git, *command[5:]], check=True, text=True, **kwargs)
        deployer = self.deployer(run=local_archive)
        deployer.cache = source
        deployer._candidate_check = lambda *_args: None
        release = deployer._create_release(sha)
        self.assertTrue((release / "public/index.html").is_file())
        self.assertFalse((release / "docs").exists())
        self.assertFalse((release / ".github").exists())
        self.assertFalse((release / "scripts/build_data.py").exists())


class PromotionTests(TemporaryDeploy):
    def _release(self, sha):
        release = self.directory / "releases" / sha
        release.mkdir()
        (release / "deployment-version.json").write_text(json.dumps({"commit": sha}))
        return release

    def test_failed_health_check_restores_old_link_and_raises(self):
        old = self._release(SHA_A)
        candidate = self._release(SHA_B)
        deployer = self.deployer()
        active = [old]
        deployer._app_target = lambda: active[0]
        deployer._switch = lambda release: active.__setitem__(0, release)
        calls = []
        written = []
        deployer._systemctl = lambda *args: calls.append(args)
        deployer._cleanup = lambda **_kwargs: self.fail("cleanup must not run after failed promotion")
        deployer._write_state = lambda state: written.append(copy.deepcopy(state))

        def verify(sha=None):
            if sha == SHA_B:
                raise pull_deploy.DeployError("bad new health")
            self.assertEqual(sha, SHA_A)

        deployer._verify_live = verify
        with self.assertRaisesRegex(pull_deploy.DeployError, "previous release was restored"):
            deployer._promote(candidate, SHA_B, {"known_good": []})
        self.assertEqual(active[0], old)
        self.assertEqual(calls, [("restart", "arknight-guess"), ("restart", "arknight-guess")])
        self.assertEqual(written[0]["pending"]["previous"], str(old))
        self.assertEqual(written[-1], {"known_good": [], "pinned": True, "failed_commit": SHA_B})

    def test_interrupted_switch_restores_recorded_previous_release_and_pins(self):
        old = self._release(SHA_A)
        deployer = self.deployer()
        restored = []
        deployer._restore = lambda path, sha: restored.append((path, sha))
        state = {"known_good": [SHA_A], "pending": {"previous": str(old), "candidate": SHA_B}}
        deployer._recover_pending(state)
        self.assertEqual(restored, [(old, SHA_A)])
        self.assertTrue(deployer._state()["pinned"])
        self.assertNotIn("pending", deployer._state())

    def test_failed_restore_keeps_pending_recovery_and_returns_failure(self):
        old = self._release(SHA_A)
        candidate = self._release(SHA_B)
        deployer = self.deployer()
        deployer._app_target = lambda: old
        deployer._switch = lambda _release: None
        deployer._systemctl = lambda *_args: None
        deployer._verify_live = mock.Mock(side_effect=pull_deploy.DeployError("service unavailable"))
        with self.assertRaisesRegex(pull_deploy.DeployError, "rollback also failed"):
            deployer._promote(candidate, SHA_B, {"known_good": [SHA_A]})
        self.assertTrue(deployer._state()["pinned"])
        self.assertEqual(deployer._state()["pending"]["previous"], str(old))

    def test_successful_manual_rollback_stays_pinned(self):
        old = self._release(SHA_A)
        current = self._release(SHA_B)
        deployer = self.deployer()
        deployer._assert_layout = lambda: None
        deployer._write_state({"known_good": [SHA_A, SHA_B], "last_successful": SHA_B})
        active = [current]
        deployer._app_target = lambda: active[0]
        deployer._switch = lambda release: active.__setitem__(0, release)
        deployer._systemctl = lambda *_args: None
        deployer._verify_live = lambda _sha: None
        deployer._candidate_check = lambda *_args: None
        deployer.rollback(SHA_A)
        self.assertEqual(active[0], old)
        self.assertTrue(deployer._state()["pinned"])
        self.assertEqual(deployer._state()["last_successful"], SHA_A)

    def test_cleanup_keeps_current_previous_and_requested_count(self):
        releases = [self._release(sha) for sha in (SHA_A, SHA_B, SHA_C, SHA_D)]
        for index, release in enumerate(releases):
            # deterministic newest-first sorting without waiting for file clocks
            release.touch()
            release_stat = release.stat()
            import os
            os.utime(release, (release_stat.st_atime, 100 + index))
        deployer = self.deployer()
        deployer._cleanup(keep_current=SHA_D, keep_previous=SHA_A)
        remaining = {item.name for item in (self.directory / "releases").iterdir()}
        self.assertIn(SHA_D, remaining)
        self.assertIn(SHA_A, remaining)
        self.assertEqual(len(remaining), 3)


class ImagePagesTests(TemporaryDeploy):
    PROJECT = "arknight-guess-images"
    BASE_URL = "https://1a2b3c4d.arknight-guess-images.pages.dev"
    RUN = {"id": 101, "attempt": 2, "url": "https://github.example/runs/101"}

    def image_deployer(self, **kwargs):
        values = config(self.directory)
        values["image_pages"] = {"project": self.PROJECT}
        return pull_deploy.PullDeployer(values, sleep=lambda _seconds: None, **kwargs)

    def payload(self, sha=SHA_A, **changes):
        result = {
            "schemaVersion": 1,
            "kind": "arknight-image-pages-release",
            "commit": sha,
            "repository": "hongbi7/arknight-cczss",
            "workflow": "production-ci.yml",
            "runId": self.RUN["id"],
            "runAttempt": self.RUN["attempt"],
            "project": self.PROJECT,
            "baseUrl": self.BASE_URL,
            "assetSetSha256": "1" * 64,
            "samplePath": "/img/operators/final/example.webp",
        }
        result.update(changes)
        return result

    def deployment(self, payload=None, **changes):
        result = {
            "id": 202,
            "sha": SHA_A,
            "ref": SHA_A,
            "environment": "cloudflare-images",
            "task": "deploy:images",
            "payload": payload or self.payload(),
        }
        result.update(changes)
        return result

    def test_binding_requires_exact_approved_run_attempt_sha_and_success_status(self):
        deployer = self.image_deployer()
        deployment = self.deployment()
        endpoints = []
        def api(endpoint):
            endpoints.append(endpoint)
            if "/statuses?" in endpoint:
                return [{"state": "success", "environment_url": self.BASE_URL}]
            return [deployment]
        deployer.api_json = api
        self.assertEqual(deployer.image_pages_binding(SHA_A, self.RUN)["payload"], self.payload())
        self.assertIn("task=deploy%3Aimages", endpoints[0])

        for field, value in (("sha", SHA_B), ("ref", SHA_B), ("payload", self.payload(runAttempt=3)),
                             ("payload", self.payload(commit=SHA_B))):
            rejected = self.deployment()
            rejected[field] = value
            deployer.api_json = lambda endpoint, rejected=rejected: (
                [{"state": "success", "environment_url": self.BASE_URL}] if "/statuses?" in endpoint else [rejected]
            )
            self.assertIsNone(deployer.image_pages_binding(SHA_A, self.RUN), field)

        deployer.api_json = lambda endpoint: (
            [{"state": "failure", "environment_url": self.BASE_URL}] if "/statuses?" in endpoint else [deployment]
        )
        self.assertIsNone(deployer.image_pages_binding(SHA_A, self.RUN))

    def test_payload_and_url_reject_injection_and_missing_records(self):
        deployer = self.image_deployer()
        for payload in (self.payload(baseUrl="https://1a2b3c4d.arknight-guess-images.pages.dev/evil"),
                        self.payload(baseUrl="https://1a2b3c4d.arknight-guess-images.pages.dev;evil"),
                        self.payload(project="image;evil"), self.payload(samplePath="/img/../evil.webp")):
            with self.subTest(payload=payload):
                with self.assertRaises(pull_deploy.DeployError):
                    deployer._validate_image_payload(payload, SHA_A, self.RUN)
        release = self.directory / "releases" / SHA_A
        release.mkdir()
        with self.assertRaisesRegex(pull_deploy.DeployError, "no valid Cloudflare image binding"):
            deployer._read_image_record(release, SHA_A)

    def test_image_check_passes_expected_digest_without_production_secrets(self):
        calls = []
        deployer = self.image_deployer()
        deployer._runuser = lambda user, command, **kwargs: calls.append((user, command, kwargs))
        deployer._image_check(self.directory, {"payload": self.payload()})
        user, command, kwargs = calls[0]
        self.assertEqual(user, "arkguess")
        self.assertIn("--expected-digest", command)
        self.assertEqual(command[command.index("--expected-digest") + 1], "1" * 64)
        self.assertNotIn("GAME_SECRET", kwargs["env"])
        self.assertEqual(kwargs["timeout"], 180)

    def test_map_contains_verified_release_and_restores_old_file_after_nginx_failure(self):
        deployer = self.image_deployer()
        # The installed deployer runs as root. Unit tests intentionally run as
        # an unprivileged account, so isolate map transaction behavior from the
        # separate ownership guard tested below.
        deployer._assert_image_map_path = lambda: None
        release = self.directory / "releases" / SHA_A
        (release / "public").mkdir(parents=True)
        deployer._write_image_record(release, {"payload": self.payload()})
        self.assertEqual(deployer._image_map_entries()[0][1], self.BASE_URL)
        # The deployer runs on Linux; supply a Linux root for the Nginx text
        # rendering portion while keeping this unit test portable to Windows.
        deployer._image_map_entries = lambda: [("/opt/arknight-guess/releases/" + SHA_A + "/public", self.BASE_URL)]
        old = b'# prior generated map\n"/old/public" "https://deadbeef.arknight-guess-images.pages.dev";\n'
        deployer.image_map.write_bytes(old)
        nginx_calls = []
        def nginx(*args):
            nginx_calls.append(args)
            if len(nginx_calls) == 1:
                raise pull_deploy.DeployError("invalid Nginx configuration")
        deployer._nginx = nginx
        deployer._systemctl = lambda *args: nginx_calls.append(args)
        with self.assertRaisesRegex(pull_deploy.DeployError, "previous map was restored"):
            deployer._write_image_map()
        self.assertEqual(deployer.image_map.read_bytes(), old)
        self.assertIn(("-t",), nginx_calls)
        self.assertIn(("reload", "nginx"), nginx_calls)

    def test_nginx_map_failure_does_not_switch_the_app_and_restores_previous_release(self):
        deployer = self.image_deployer()
        old = self.directory / "releases" / SHA_A
        candidate = self.directory / "releases" / SHA_B
        old.mkdir()
        candidate.mkdir()
        (old / "deployment-version.json").write_text(json.dumps({"commit": SHA_A}))
        (candidate / "deployment-version.json").write_text(json.dumps({"commit": SHA_B}))
        active = [old]
        deployer._app_target = lambda: active[0]
        deployer._switch = lambda release: active.__setitem__(0, release)
        deployer._write_image_map = lambda: (_ for _ in ()).throw(pull_deploy.DeployError("Nginx rejected map; restored"))
        restored = []
        deployer._restore = lambda release, sha: restored.append((release, sha))
        with self.assertRaisesRegex(pull_deploy.DeployError, "previous release was restored"):
            deployer._promote(candidate, SHA_B, {"pinned": False, "known_good": [SHA_A]})
        self.assertEqual(active[0], old)
        self.assertEqual(restored, [(old, SHA_A)])

    def test_existing_release_cannot_be_silently_rebound(self):
        deployer = self.image_deployer()
        release = self.directory / "releases" / SHA_A
        release.mkdir()
        (release / "deployment-version.json").write_text(json.dumps({"commit": SHA_A}))
        (release / "package.json").write_text("{}")
        (release / "server-data").mkdir()
        (release / "server-data" / "data-version.json").write_text('{"status":"ready"}')
        deployer._write_image_record(release, {"payload": self.payload(assetSetSha256="2" * 64)})
        with self.assertRaisesRegex(pull_deploy.DeployError, "different Cloudflare image binding"):
            deployer._create_release(SHA_A, {"payload": self.payload()})

    def test_rollback_to_a_pre_pages_release_keeps_local_images(self):
        deployer = self.image_deployer(api_json=lambda _endpoint: self.fail("old local release must not need GitHub image lookup"))
        release = self.directory / "releases" / SHA_A
        release.mkdir()
        (release / "deployment-version.json").write_text(json.dumps({"commit": SHA_A}))
        deployer._assert_layout = lambda: None
        deployer._state = lambda: {"pinned": False, "known_good": [SHA_A]}
        deployer._candidate_check = lambda *_args: None
        promoted = []
        deployer._promote = lambda *args, **kwargs: promoted.append((args, kwargs))
        deployer.rollback(SHA_A)
        self.assertEqual(promoted[0][0][0], release)
        # Missing root-generated metadata means _verify_image_redirect leaves
        # the Nginx local /img fallback intact.
        deployer._verify_image_redirect(SHA_A)

    def test_enabling_pages_for_an_already_deployed_unbound_sha_requires_new_commit(self):
        deployer = self.image_deployer()
        release = self.directory / "releases" / SHA_A
        release.mkdir()
        deployer._assert_layout = lambda: None
        deployer._state = lambda: {"pinned": False, "known_good": [SHA_A], "last_successful": SHA_A}
        deployer._app_target = lambda: release
        deployer._main_sha = lambda: SHA_A
        deployer.approved_run_details = lambda _sha: self.RUN
        deployer.image_pages_binding = lambda _sha, _run: {"payload": self.payload()}
        with self.assertRaisesRegex(pull_deploy.DeployError, "publish a new commit"):
            deployer.check()

    def test_same_sha_pages_reenable_checks_remote_assets_before_writing_map(self):
        deployer = self.image_deployer()
        release = self.directory / "releases" / SHA_A
        release.mkdir()
        deployer._write_image_record(release, {"payload": self.payload()})
        deployer._assert_layout = lambda: None
        deployer._state = lambda: {"pinned": False, "known_good": [SHA_A], "last_successful": SHA_A}
        deployer._app_target = lambda: release
        deployer._main_sha = lambda: SHA_A
        deployer.approved_run_details = lambda _sha: self.RUN
        binding = {"payload": self.payload()}
        deployer.image_pages_binding = lambda _sha, _run: binding
        deployer._image_check = lambda *_args: (_ for _ in ()).throw(pull_deploy.DeployError("Pages is gone"))
        deployer._write_image_map = lambda: self.fail("map must wait for image verification")
        with self.assertRaisesRegex(pull_deploy.DeployError, "Pages is gone"):
            deployer.check()

    def test_recorded_rollback_checks_pages_bytes_after_candidate_before_promote(self):
        deployer = self.image_deployer()
        release = self.directory / "releases" / SHA_A
        release.mkdir()
        (release / "deployment-version.json").write_text(json.dumps({"commit": SHA_A}))
        deployer._write_image_record(release, {"payload": self.payload()})
        deployer._assert_layout = lambda: None
        deployer._state = lambda: {"pinned": False, "known_good": [SHA_A]}
        deployer.image_record_is_live = lambda sha, record: sha == SHA_A and record == self.payload()
        order = []
        deployer._candidate_check = lambda *_args: order.append("candidate")
        deployer._image_check = lambda _release, binding: (order.append("image"), self.assertEqual(binding["payload"], self.payload()))
        deployer._promote = lambda *_args, **_kwargs: order.append("promote")
        deployer.rollback(SHA_A)
        self.assertEqual(order, ["candidate", "image", "promote"])

    def test_failed_recorded_rollback_image_check_never_promotes(self):
        deployer = self.image_deployer()
        release = self.directory / "releases" / SHA_A
        release.mkdir()
        (release / "deployment-version.json").write_text(json.dumps({"commit": SHA_A}))
        deployer._write_image_record(release, {"payload": self.payload()})
        deployer._assert_layout = lambda: None
        deployer._state = lambda: {"pinned": False, "known_good": [SHA_A]}
        deployer.image_record_is_live = lambda *_args: True
        deployer._candidate_check = lambda *_args: None
        deployer._image_check = lambda *_args: (_ for _ in ()).throw(pull_deploy.DeployError("remote digest differs"))
        deployer._promote = lambda *_args, **_kwargs: self.fail("failed image check must not promote")
        with self.assertRaisesRegex(pull_deploy.DeployError, "remote digest differs"):
            deployer.rollback(SHA_A)

    def test_disabling_pages_clears_map_before_pin_or_any_github_request(self):
        deployer = self.deployer(api_json=lambda _endpoint: self.fail("CDN-off must not contact GitHub"))
        deployer._assert_image_map_path = lambda: None
        deployer.image_map.write_text('"/opt/old/public" "https://deadbeef.example.pages.dev";\n')
        deployer._assert_layout = lambda: None
        deployer._state = lambda: {"pinned": True, "known_good": []}
        commands = []
        deployer._nginx = lambda *args: commands.append(args)
        deployer._systemctl = lambda *args: commands.append(args)
        self.assertFalse(deployer.check())
        self.assertEqual(deployer.image_map.read_text(), "# Generated by arknight pull deployer. Do not edit.\n")
        self.assertEqual(commands, [("-t",), ("reload", "nginx")])

    def test_image_map_permission_guard_rejects_non_root_owned_file(self):
        deployer = self.image_deployer()
        deployer.image_map.write_text("# generated\n")
        bad_stat = SimpleNamespace(st_uid=1000, st_mode=0o100644)
        with mock.patch.object(pull_deploy.os, "name", "posix"), \
                mock.patch.object(Path, "stat", return_value=bad_stat):
            with self.assertRaisesRegex(pull_deploy.DeployError, "root-owned"):
                deployer._assert_image_map_path()


class GitCommandTests(TemporaryDeploy):
    def test_git_commands_are_always_run_as_deploy_user(self):
        commands = []

        def runner(command, **kwargs):
            commands.append(command)
            self.assertNotIn("GITHUB_TOKEN", kwargs["env"])
            self.assertNotIn("GAME_SECRET", kwargs["env"])
            output = SHA_A + "\n" if "rev-parse" in command else ""
            return SimpleNamespace(stdout=output)

        deployer = self.deployer(run=runner)
        deployer._git_fetch(SHA_A)
        self.assertTrue(commands)
        self.assertTrue(all(command[:5] == ["/usr/sbin/runuser", "-u", "arkdeploy", "--", "/usr/bin/git"] for command in commands))

    def test_runner_accepts_nonfatal_git_remote_remove(self):
        with mock.patch.object(pull_deploy.subprocess, "run", return_value=SimpleNamespace(returncode=2)) as runner:
            self.deployer()._run(["git", "remote", "remove", "origin"], check=False)
        self.assertFalse(runner.call_args.kwargs["check"])


if __name__ == "__main__":
    unittest.main()
