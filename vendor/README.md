# Reviewed dependency backport

`glib/` is the complete crates.io `glib 0.18.5` source, including its MIT license and copyright notice. Tauri's Linux GTK 3 dependency still requires the 0.18 API. Replacing it with glib 0.20 would not repair that dependency graph.

The only source change is in `src/variant_iter.rs`: the output pointer passed through GLib's C varargs is declared mutable and passed as `&mut p`. This backports the fix described in [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html) and [gtk-rs core #1343](https://github.com/gtk-rs/gtk-rs-core/pull/1343). It prevents C from writing through a pointer derived from a shared Rust reference.

Original crates.io archive SHA-256: `233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5`.

Upstream revision: `42b9caf98e03ded086362d9653ca58fe94dc8658`, path `glib`, as recorded in `.cargo_vcs_info.json`. Cargo's `[patch.crates-io]` selects this local copy. The package retains version 0.18.5, so version-only advisory scanners may still report it; do not suppress the advisory globally. Remove the backport when Tauri's Linux dependency no longer needs it.

The optimized runtime regression probe covers forward, reverse, skipped, empty and Unicode string iteration:

```sh
cargo test --release --locked --manifest-path scripts/tests/glib-variant-probe/Cargo.toml
```

It requires the GLib development library (`libglib2.0-dev` on Ubuntu, `brew install glib` on macOS). CI runs it on Linux. macOS execution validates this GLib backport, not the Linux desktop application.
