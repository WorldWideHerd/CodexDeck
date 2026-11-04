# Release guide

## Versions

`package.json` is the application version source. Tauri and the interface read it directly. The npm version hook synchronizes the application's `Cargo.toml` and `Cargo.lock` entries without changing dependency versions.

```sh
npm version 0.1.1 --no-git-tag-version
npm run version:check
```

Use `npm run version:sync` after a manual version edit. The checker also rejects a stale npm lockfile or a mismatched release tag. The credential broker's own version stays independent: preserving its exact signed binary across compatible app updates avoids unnecessary Keychain approval.

## Local validation and preview archive

```sh
npm ci
npm run version:check
npm run test:release
npm run licenses:check
npm test
npm run format:check
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
python3 -m unittest discover -s scripts/tests -p 'test_*.py'
bash scripts/test-desktop-quit.sh
npm run build:mac -- --skip-registration
python3 scripts/verify-credential-broker.py --identifier com.codexdeck.desktop
npm run package:mac
```

`output/releases/` contains the app ZIP, a SHA-256 checksum file and a JSON manifest describing its version, architecture and signing channel. Only the complete app is archived; local signing keys, caches and account folders are outside the app. A preview is signed for local development and has not passed Apple's notarization service. For normal end-user downloads, use the release procedure below.

Verify a downloaded ZIP before extracting it:

```sh
shasum -a 256 -c CodexDeck_0.1.0_macos_arm64-preview.sha256
```

For a different macOS target, install its Rust standard library and build explicitly:

```sh
rustup target add x86_64-apple-darwin
npm run build:mac -- --target x86_64-apple-darwin --skip-registration
```

For `universal-apple-darwin`, install both `aarch64-apple-darwin` and `x86_64-apple-darwin`. The broker follows the app's actual architectures, and its cache separates Intel and Universal binaries while retaining the existing Apple Silicon cache. Cross-compilation does not establish runtime compatibility.

## Official macOS release

Install a **Developer ID Application** certificate and its private key in a signing keychain. Preserve this identity across releases, including signing the main app and its broker with the same identity. Set `CODEXDECK_SIGNING_IDENTITY` to its fingerprint or full identity name; optionally set `CODEXDECK_SIGNING_KEYCHAIN` to its keychain path. Explicit identities use Apple's secure timestamp service.

For local notarization, store credentials with `xcrun notarytool store-credentials` and set `CODEXDECK_NOTARY_PROFILE` to that profile name. Alternatively supply `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password), and `APPLE_TEAM_ID` through the environment. Keep these values out of source files, terminal logs and commits.

```sh
npm run build:mac -- --skip-registration
npm run package:mac -- --channel release
```

The packager rejects local/ad-hoc signatures, absent timestamps, incomplete brokers and mixed architectures. It submits a staged app archive to Apple, waits for acceptance, staples and validates the ticket, checks Gatekeeper acceptance, and recreates the final ZIP from the stapled app. A notarization failure does not produce a new release asset.

See [Apple's notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow) and [Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/).

## GitHub setup

Create the destination repository, connect this checkout to it, review and commit the intended source changes, and push the default branch. Configure Actions and enable **Settings → Security → Private vulnerability reporting** so that the reporting path in `SECURITY.md` is available. Enable dependency alerts and secret scanning where the repository settings offer them.

The regular CI workflow checks Apple Silicon macOS, Intel macOS, Windows and Linux. It builds complete signed macOS previews and checks authenticated broker connections; Windows produces an NSIS installer and Linux a Debian package. Artifacts are retained for 14 days. These jobs still need to run on GitHub before their platforms can be considered validated.

Set the default branch to `main` once it contains the reviewed source. For an open-source public launch, confirm repository visibility is Public, the MIT license is detected, and the Security reporting link works. These are account-level settings, not changes made by local build scripts.

The [release workflow](../.github/workflows/release.yml) defaults to **preview** for tag pushes and manual runs. Preview builds do not require Apple credentials. It builds Apple Silicon and Intel macOS previews plus experimental Windows x64 NSIS and Linux amd64 Debian installers. Each asset has a checksum and manifest; Windows previews are unsigned. It creates a prerelease **draft**, never a public release. Build failures prevent the draft job.

For an official macOS release, manually run the workflow with an existing version tag and select `channel: release`. This channel requires these repository Actions secrets:

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | Base64-encoded `.p12` containing the Developer ID certificate and private key |
| `APPLE_CERTIFICATE_PASSWORD` | Password protecting that `.p12` |
| `APPLE_SIGNING_IDENTITY` | Matching certificate fingerprint or full Developer ID Application identity |
| `APPLE_ID` | Apple account used for notarization |
| `APPLE_PASSWORD` | App-specific password for that account |
| `APPLE_TEAM_ID` | Apple Developer team identifier |

After validation, tag the reviewed commit with the exact package version:

```sh
git tag -a v0.1.0 -m "CodexDeck 0.1.0"
git push origin v0.1.0
```

A version tag starts preview builds. For a public launch, review the draft, download and test every offered platform, and explicitly publish it. Official-channel macOS builds sign, notarize and validate both architectures before preparing a draft. Windows/Linux assets are only included in preview-channel drafts until their runtime validation and distribution signing requirements are addressed.

Release notes are version-specific: add `docs/releases/v<version>.md` before tagging. The tag must exactly match `package.json`; previews still use the exact app version and are distinguished by asset filenames and prerelease status. To use a semantic prerelease tag, set the app version to that prerelease first. Reruns may replace assets only on a draft of the same channel. Published releases and channel changes are rejected; use a new version/tag for corrections. A manual workflow run can retry an existing tag. Dependency updates are proposed monthly by Dependabot.

## Validate the downloadable app before publishing

Record the macOS version, architecture, app version and exact installed Codex CLI version. Use dedicated test accounts. Do these checks on another Mac without this checkout's signing cache:

- Download the candidate archive, verify its checksum, extract it and move `CodexDeck.app` to Applications. Confirm normal Gatekeeper acceptance for an official release.
- Start with no accounts; add an account, finish browser sign-in, cancel another login and refresh after disconnect/reconnect.
- Confirm quota/reset display, Persian/English, calendar, light/dark, keyboard navigation and menu bar behavior.
- Set a quota alert, submit a test notification, deny/allow notification permission and reopen the app.
- Export/import using a test password; reject a wrong password and preserve existing duplicate accounts.
- Switch the original desktop account, cancel system authentication, restore the previous account and verify recovery after a failed switch.
- Schedule a test prompt, cancel a pending one, and verify that sleeping past the due time or restarting does not replay it. A prompt can consume real quota.
- Upgrade from the previous release and confirm saved accounts, settings and credential access remain usable.

Complete these checks for Intel macOS before claiming Intel support, and run the equivalent account/notification checks on Windows/Linux before claiming support there. Attach only synthetic or redacted screenshots to public issues. Read `CHANGELOG.md`, review the draft's assets, then publish it from GitHub Releases.

## Dependency and notice checks

Run `npm run licenses:generate` after changing dependencies, review and commit the resulting notices and any version-pinned supplements, then run `npm run licenses:check`. The generator needs installed npm packages and Cargo access to locked crate sources for all platforms. Notices are committed so ordinary builds do not require a new license service or license-generation network request. See [dependency security](dependency-security.md) for the GLib backport and unresolved upstream maintenance warnings.

Local macOS validation does not create Windows/Linux installers. Those installers must be built on their respective runners and pass the interactive checks, including [Windows notification registration](testing/windows-notifications.md).
