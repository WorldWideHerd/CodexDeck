# Project workflow

- After every change to application code, styles, configuration, or dependencies, run the relevant production build before handing the result back to the user. Finish a related edit batch, then build; rebuild if further edits are made.
- For the Tauri app in the repository root, build both the frontend and the native application bundle. A frontend-only `npm run build` is not sufficient. From the repository root, run `npm run tauri -- build --bundles app` on macOS; on Windows, use a supported Windows bundle target. Use the existing Rust toolchain when it is outside PATH.
- The current application is Tauri in the repository root. macOS security sources live in `native/macos/`; validate the desktop build after changing them.
- Run tests appropriate to behavior changes. Fix build failures caused by the change and rebuild before reporting completion.
- Report the actual build result and link to the generated application or installer. Clearly state which platform was built; do not claim Windows validation from a macOS build.
- If a build is blocked, report the concrete blocker and do not describe the build as successful.
