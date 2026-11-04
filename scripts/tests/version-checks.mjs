import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  copyFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "codexdeck-version-"));
  const put = (path, text) => writeFileSync(join(root, path), text);
  for (const dir of ["scripts", "src-tauri"]) mkdirSync(join(root, dir));
  copyFileSync(
    new URL("../sync-version.mjs", import.meta.url),
    join(root, "scripts/sync-version.mjs"),
  );
  put("package.json", JSON.stringify({ version: "1.2.3" }));
  put(
    "package-lock.json",
    JSON.stringify({
      version: "1.2.3",
      packages: { "": { version: "1.2.3" } },
    }),
  );
  put(
    "src-tauri/tauri.conf.json",
    JSON.stringify({ version: "../package.json" }),
  );
  put(
    "src-tauri/Cargo.toml",
    '[package]\nname = "codexdeck"\nversion = "1.2.3"\n',
  );
  put(
    "src-tauri/Cargo.lock",
    '[[package]]\nname = "codexdeck"\nversion = "1.2.3"\n\n[[package]]\nname = "other"\nversion = "9.0.0"\n',
  );
  const command = (...args) =>
    spawnSync(process.execPath, ["scripts/sync-version.mjs", ...args], {
      cwd: root,
      encoding: "utf8",
    });
  try {
    run({ root, put, command });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("matching versions and release tag pass; mismatched tags fail", () =>
  fixture(({ command }) => {
    assert.equal(command("--check", "v1.2.3").status, 0);
    assert.notEqual(command("--check", "v1.2.4").status, 0);
    assert.notEqual(command("--check", "master").status, 0);
  }));

test("version drift is rejected without modifying files and sync preserves dependencies", () =>
  fixture(({ root, put, command }) => {
    put(
      "src-tauri/Cargo.toml",
      '[package]\nname = "codexdeck"\nversion = "1.0.0"\n',
    );
    put(
      "src-tauri/Cargo.lock",
      '[[package]]\nname = "codexdeck"\nversion = "1.0.0"\n\n[[package]]\nname = "other"\nversion = "9.0.0"\n',
    );
    assert.notEqual(command("--check").status, 0);
    assert.match(
      readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8"),
      /1\.0\.0/,
    );
    assert.equal(command().status, 0);
    assert.equal(command("--check").status, 0);
    assert.match(
      readFileSync(join(root, "src-tauri/Cargo.lock"), "utf8"),
      /name = "other"\nversion = "9\.0\.0"/,
    );
  }));

test("stale npm lockfiles and a second Tauri version source are rejected", () =>
  fixture(({ put, command }) => {
    put(
      "package-lock.json",
      JSON.stringify({
        version: "1.0.0",
        packages: { "": { version: "1.0.0" } },
      }),
    );
    assert.notEqual(command("--check").status, 0);
    put(
      "package-lock.json",
      JSON.stringify({
        version: "1.2.3",
        packages: { "": { version: "1.2.3" } },
      }),
    );
    put("src-tauri/tauri.conf.json", JSON.stringify({ version: "1.2.3" }));
    assert.notEqual(command("--check").status, 0);
  }));
