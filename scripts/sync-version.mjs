import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(resolve(root, path), "utf8");
const version = JSON.parse(read("package.json")).version;
if (!/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/.test(version)) {
  throw new Error("package.json must contain a valid application version.");
}
const check = process.argv.includes("--check");
const positional = process.argv.slice(2).filter((arg) => arg !== "--check");
if (positional.length > 1) throw new Error("Pass at most one release tag.");
const tag = positional[0];
if (tag && tag !== `v${version}`) {
  throw new Error(
    `Release tag ${tag} does not match package.json (${version}).`,
  );
}
const changes = [
  ["src-tauri/Cargo.toml", /(\[package\][\s\S]*?\nversion = ")[^"]+("\n)/],
  [
    "src-tauri/Cargo.lock",
    /(\[\[package\]\]\nname = "codexdeck"\nversion = ")[^"]+("\n)/,
  ],
];
for (const [path, pattern] of changes) {
  const before = read(path);
  if (!pattern.test(before))
    throw new Error(`Application version not found in ${path}.`);
  const after = before.replace(
    pattern,
    (_, start, end) => `${start}${version}${end}`,
  );
  if (before !== after) {
    if (check)
      throw new Error(`${path} is out of sync; run npm run version:sync.`);
    writeFileSync(resolve(root, path), after);
  }
}
const lock = JSON.parse(read("package-lock.json"));
if (lock.version !== version || lock.packages[""].version !== version) {
  if (check)
    throw new Error(
      "package-lock.json is out of sync; run npm run version:sync.",
    );
  lock.version = version;
  lock.packages[""].version = version;
  writeFileSync(
    resolve(root, "package-lock.json"),
    JSON.stringify(lock, null, 2) + "\n",
  );
}
if (
  JSON.parse(read("src-tauri/tauri.conf.json")).version !== "../package.json"
) {
  throw new Error("Tauri must read its version from ../package.json.");
}
console.log(
  `Application version ${version}: ${check ? "verified" : "synchronized"}.`,
);
