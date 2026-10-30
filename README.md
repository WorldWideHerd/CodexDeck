# CodexDeck

A desktop app for monitoring usage across multiple Codex accounts. Built with Tauri, React and Rust.

- Five-hour and weekly quotas, reset countdowns and quota alerts.
- Isolated account sign-in, encrypted account transfer and a menu bar panel.
- Persian and English, light/dark themes and Persian/Gregorian calendars.
- Original Codex/ChatGPT account switching in the signed macOS build.

macOS is the locally validated platform. Windows and Linux support remains unverified.

## Run from source

Requires Node.js 22.12+, stable Rust, the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) and an installed Codex CLI. macOS also requires Xcode and Python 3.

```sh
npm ci
npm run tauri -- dev
```

Select the Codex executable in Settings if it is not found automatically. `npm run dev` opens a browser preview with optional sample accounts; account operations require the desktop app.

## Build

```sh
npm run build:mac        # signed macOS app: output/CodexDeck.app
npm run tauri -- build   # native packaging on the current platform
```

The macOS script uses a persistent local development signing identity by default. It does not produce a notarized release.

[Development and checks](docs/development.md) · [Account transfer](docs/account-transfer.md) · [Architecture](docs/architecture.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Privacy](PRIVACY.md)

## License

[MIT](LICENSE). Bundled components retain their own notices: [shadcn/ui](public/licenses/shadcn-MIT.txt) and [Vazirmatn](public/fonts/OFL.txt).
