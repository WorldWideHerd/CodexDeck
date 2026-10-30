# Privacy documentation

The current app is the Tauri implementation in the repository root. Its local data, account isolation, native capabilities and service boundaries are documented in the [desktop guide](docs/development.md) and [native backend guide](src-tauri/README.md). Account transfer files are described in the [transfer format](docs/account-transfer.md).


Private local signing material and broker caches stay under the repository's ignored `.local-data/` directory. They are not source files or distributable app assets.
