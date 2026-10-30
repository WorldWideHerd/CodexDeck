"""Exercise the real native identity guard without accessing notification permissions."""
import plistlib
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class NotificationIdentityTests(unittest.TestCase):
    def test_signing_requires_relaunch_and_matching_bundle_identity(self):
        bridge = (ROOT / "src-tauri/src/notification_mac.m").read_text()
        guard = bridge[bridge.index("static bool validIdentity"):bridge.index("static void status")]
        with tempfile.TemporaryDirectory(prefix="codexdeck-identity-") as folder:
            folder = Path(folder)
            app = folder / "Synthetic.app"
            binary = app / "Contents/MacOS/probe"
            binary.parent.mkdir(parents=True)
            with (app / "Contents/Info.plist").open("wb") as file:
                plistlib.dump({"CFBundleIdentifier": "test.codexdeck.notification-identity",
                              "CFBundleExecutable": "probe", "CFBundlePackageType": "APPL"}, file)
            source = folder / "probe.m"
            source.write_text('#import <Foundation/Foundation.h>\n#import <Security/Security.h>\n#include <stdbool.h>\n#include <stdio.h>\n' + guard + '''
int main(int argc, const char **argv) {
    @autoreleasepool {
        puts(validIdentity() ? "valid" : "invalid"); fflush(stdout);
        if (argc > 1) { getchar(); puts(validIdentity() ? "valid" : "invalid"); fflush(stdout); }
    }
    return 0;
}
''')
            subprocess.run(["/usr/bin/clang", "-fobjc-arc", "-framework", "Foundation",
                            "-framework", "Security", str(source), "-o", str(binary)], check=True)
            # Linker signing has an executable identity unrelated to the bundle ID.
            process = subprocess.Popen([str(binary), "wait"], stdin=subprocess.PIPE,
                                       stdout=subprocess.PIPE, text=True)
            try:
                self.assertEqual(process.stdout.readline().strip(), "invalid")
                subprocess.run(["/usr/bin/codesign", "--force", "--sign", "-", "--identifier",
                                "test.codexdeck.notification-identity", str(app)], check=True, capture_output=True)
                output, _ = process.communicate("\n", timeout=10)
                self.assertEqual(output.strip(), "invalid", "Signing on disk must not fix the already-running identity")
                self.assertEqual(subprocess.check_output([str(binary)], text=True).strip(), "valid")
            finally:
                if process.poll() is None:
                    process.kill()
                process.wait()


if __name__ == "__main__":
    unittest.main()
