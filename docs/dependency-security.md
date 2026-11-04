# Dependency security review

The application locks npm and Rust dependency versions. Run `npm audit` and `cargo audit --file src-tauri/Cargo.lock` with a current advisory database before releases. Neither a clean scan nor a build replaces application or platform testing.

## GLib safety backport

Tauri's GTK 3 Linux backend uses glib 0.18.5, affected by [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html). The upstream fix requires a mutable C varargs output pointer. CodexDeck selects a reviewed local source copy through Cargo's `[patch.crates-io]`; see [provenance and exact change](../vendor/README.md). The optimized regression probe runs on Linux CI and can run on macOS with Homebrew GLib.

No blanket advisory ignore is configured. Registry/version-only scanners can still recognize version 0.18.5 without understanding the local fix. Verify the Cargo path patch and runtime regression test, rather than claiming that the upstream version has become fixed. Remove the backport when the Tauri dependency graph permits a maintained upstream version.

## Upstream maintenance warnings

The audited lockfile contains maintenance advisories for `proc-macro-error` and older `zbus_names`, `zvariant`, and `zvariant_derive` versions. Some entries belong to optional or foreign-platform graphs. Linux's Tauri single-instance plugin still selects zbus 5, and GTK's procedural macros still select proc-macro-error. These are maintenance warnings, not reported exploitable vulnerabilities in the reviewed advisory snapshot. They remain follow-up work for upstream upgrades; they are not hidden or described as resolved.

Do not swap notification backends or remove single-instance protection solely to silence these warnings: both affect desktop behavior and credential access. Inspect the target-specific graph before deciding on an update:

```sh
cargo tree --locked --manifest-path src-tauri/Cargo.toml --target x86_64-unknown-linux-gnu -i zbus@5.19.0
cargo tree --locked --manifest-path src-tauri/Cargo.toml --target x86_64-unknown-linux-gnu -i proc-macro-error
```

## Redistribution notices

`public/licenses/third-party-notices.txt` inventories production npm dependencies and the complete Rust lock graph. `npm run licenses:check` rejects stale notices or missing texts. The app bundles these with its MIT license, shadcn/ui and Vazirmatn notices in its resource `licenses` directory. Missing upstream license files have version-pinned supplements with source URLs and integrity hashes under `scripts/license-overrides/`.
