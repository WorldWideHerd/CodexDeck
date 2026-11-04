import { createHash } from "node:crypto";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function packagePreview(directory, output, platform, version) {
  const formats = { windows: [".exe", "x64"], linux: [".deb", "amd64"] };
  if (!formats[platform]) throw new Error("Choose windows or linux.");
  if (!/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/.test(version))
    throw new Error("Invalid version.");
  const [extension, architecture] = formats[platform];
  const files = readdirSync(directory).filter((name) =>
    name.endsWith(extension),
  );
  if (files.length !== 1)
    throw new Error(
      `Expected exactly one ${extension} installer; found ${files.length}.`,
    );
  const input = join(directory, files[0]);
  if (!lstatSync(input).isFile())
    throw new Error("Installer must be a regular file.");
  const stem = `CodexDeck_${version}_${platform}_${architecture}-preview`;
  const archive = stem + extension;
  const bytes = readFileSync(input);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  mkdirSync(output, { recursive: true });
  copyFileSync(input, join(output, archive));
  writeFileSync(join(output, stem + ".sha256"), `${sha256}  ${archive}\n`);
  writeFileSync(
    join(output, stem + ".json"),
    JSON.stringify(
      {
        version,
        platform,
        architectures: [architecture],
        channel: "preview",
        signing: platform === "windows" ? "unsigned" : "not-applicable",
        runtimeValidated: false,
        archive,
        sha256,
      },
      null,
      2,
    ) + "\n",
  );
  return archive;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const platform = process.argv[2];
  const subfolder = { windows: "nsis", linux: "deb" }[platform];
  if (!subfolder)
    throw new Error(`Usage: node ${basename(process.argv[1])} windows|linux`);
  const version = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  ).version;
  console.log(
    packagePreview(
      join(root, "src-tauri/target/release/bundle", subfolder),
      join(root, "output/releases"),
      platform,
      version,
    ),
  );
}
