"""Exercise the shipped Nginx snippets with real symlink release changes.

The CI installs nginx. On a Windows development host this test is skipped;
the deployer's configuration/rollback logic has separate portable unit tests.
"""

import os
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path


REPOSITORY = Path(__file__).resolve().parents[2]
NGINX = shutil.which("nginx")
if os.name == "posix" and os.environ.get("CI") == "true" and not NGINX:
    raise RuntimeError("CI must install nginx to exercise the production image routing snippets")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


@unittest.skipUnless(os.name == "posix" and NGINX, "requires Ubuntu/Linux nginx (installed in CI)")
class NginxImageRoutingTests(unittest.TestCase):
    def test_images_follow_release_switch_rollback_and_local_baseline(self):
        with tempfile.TemporaryDirectory(prefix="arknight-nginx-images-") as temporary:
            root = Path(temporary).resolve()
            # Nginx may drop privileges when the test is run by root.
            root.chmod(0o755)
            releases = root / "releases"
            releases.mkdir()
            paths = []
            for sha in ("a" * 40, "b" * 40, "c" * 40):
                release = releases / sha
                images = release / "public" / "img"
                images.mkdir(parents=True)
                (images / "sample.webp").write_bytes(("local-" + sha).encode())
                paths.append(release)

            origins = (
                "https://11111111.arknight-test-images.pages.dev",
                "https://22222222.arknight-test-images.pages.dev",
            )
            mapping = root / "image-pages.map"
            mapping.write_text("\n".join(
                '"%s" "%s";' % ((release / "public").as_posix(), origin)
                for release, origin in zip(paths, origins)
            ) + "\n", encoding="utf-8")
            http_snippet = (REPOSITORY / "deploy" / "nginx-image-pages-http.conf.example").read_text(encoding="utf-8")
            http_snippet = http_snippet.replace("/opt/arknight-guess/image-pages.map", mapping.as_posix())
            location_snippet = (REPOSITORY / "deploy" / "nginx-images-pages.location.example").read_text(encoding="utf-8")
            with socket.socket() as reservation:
                reservation.bind(("127.0.0.1", 0))
                port = reservation.getsockname()[1]

            app = root / "app"
            app.symlink_to(paths[0], target_is_directory=True)
            configuration = root / "nginx.conf"
            configuration.write_text(
                'worker_processes 1;\npid "%s";\nerror_log "%s" notice;\n'
                'events { worker_connections 64; }\nhttp {\n'
                'access_log off; default_type application/octet-stream;\n%s\n'
                'server { listen 127.0.0.1:%s; root "%s";\n%s\n}\n}\n'
                % ((root / "nginx.pid").as_posix(), (root / "error.log").as_posix(),
                   http_snippet, port, (app / "public").as_posix(), location_snippet),
                encoding="utf-8",
            )
            command = [NGINX, "-p", str(root) + "/", "-c", str(configuration)]
            checked = subprocess.run(command + ["-t"], capture_output=True, text=True, timeout=15)
            self.assertEqual(checked.returncode, 0, checked.stderr)
            process = subprocess.Popen(command + ["-g", "daemon off;"], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            opener = urllib.request.build_opener(NoRedirect())

            def request():
                address = "http://127.0.0.1:%s/img/sample.webp?check=1" % port
                try:
                    response = opener.open(address, timeout=2)
                except urllib.error.HTTPError as error:
                    response = error
                with response:
                    return response.code, response.headers, response.read()

            def switch(release):
                replacement = root / ".app.next"
                replacement.symlink_to(release, target_is_directory=True)
                replacement.replace(app)

            try:
                deadline = time.monotonic() + 8
                while True:
                    try:
                        request()
                        break
                    except urllib.error.URLError:
                        if process.poll() is not None or time.monotonic() > deadline:
                            self.fail("Nginx did not start: " + (root / "error.log").read_text())
                        time.sleep(0.05)

                # Neither switching nor rollback reloads nginx: the realpath
                # map must select the immutable image URL for each app target.
                for index in (0, 1, 0):
                    with self.subTest(release=index):
                        switch(paths[index])
                        status, headers, _body = request()
                        self.assertEqual(status, 302)
                        self.assertEqual(headers["Location"], origins[index] + "/img/sample.webp?check=1")
                        self.assertEqual(headers["Cache-Control"], "no-store")

                switch(paths[2])
                status, headers, body = request()
                self.assertEqual(status, 200)
                self.assertIsNone(headers.get("Location"))
                self.assertIn("max-age=86400", headers["Cache-Control"])
                self.assertEqual(body, ("local-" + "c" * 40).encode())
            finally:
                process.terminate()
                try:
                    process.communicate(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.communicate(timeout=5)


if __name__ == "__main__":
    unittest.main()
