import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { packagePreview } from "../package-native-preview.mjs";

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "codexdeck-preview-"));
  const input = join(root, "input");
  mkdirSync(input);
  try {
    run(input, join(root, "output"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
for (const [platform, extension] of [
  ["windows", ".exe"],
  ["linux", ".deb"],
]) {
  test(`${platform} installer retains bytes, with a matching checksum and honest preview manifest`, () =>
    fixture((input, output) => {
      const bytes = Buffer.from("synthetic installer");
      writeFileSync(join(input, "setup" + extension), bytes);
      const archive = packagePreview(input, output, platform, "0.1.0");
      assert.deepEqual(readFileSync(join(output, archive)), bytes);
      const manifest = JSON.parse(
        readFileSync(join(output, archive.replace(extension, ".json"))),
      );
      assert.equal(
        manifest.sha256,
        createHash("sha256").update(bytes).digest("hex"),
      );
      assert.equal(manifest.channel, "preview");
      assert.equal(manifest.runtimeValidated, false);
      assert.equal(
        readFileSync(
          join(output, archive.replace(extension, ".sha256")),
          "utf8",
        ),
        `${manifest.sha256}  ${archive}\n`,
      );
      if (platform === "windows") assert.equal(manifest.signing, "unsigned");
    }));
}
test("missing and ambiguous installers are rejected", () =>
  fixture((input, output) => {
    assert.throws(
      () => packagePreview(input, output, "windows", "0.1.0"),
      /exactly one/,
    );
    for (const name of ["a.exe", "b.exe"])
      writeFileSync(join(input, name), "synthetic");
    assert.throws(
      () => packagePreview(input, output, "windows", "0.1.0"),
      /exactly one/,
    );
  }));
test(
  "symbolic-link installers are rejected",
  {
    skip:
      process.platform === "win32"
        ? "Creating symlinks requires Windows developer privileges"
        : false,
  },
  () =>
    fixture((input, output) => {
      writeFileSync(join(input, "source"), "synthetic");
      symlinkSync(join(input, "source"), join(input, "setup.exe"));
      assert.throws(
        () => packagePreview(input, output, "windows", "0.1.0"),
        /regular file/,
      );
    }),
);
