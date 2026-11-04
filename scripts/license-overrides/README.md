# License text overrides

Some published npm/crates.io archives declare a license but omit its text. These version-pinned copies preserve upstream copyright and license notices from the exact source revision recorded by the archive (or the exact npm release's `gitHead` where available). Each text records its source URL; `manifest.json` pins its SHA-256. The two winapi target-library archives inherit the license from winapi 0.3.9 in the same upstream project.

Do not replace these with generic SPDX templates or silently reuse an override for another version. After dependency changes, run `npm run licenses:generate`, review missing texts and the generated diff, then commit the notices. `npm run licenses:check` verifies the committed result against installed npm packages and Cargo's complete locked metadata. It may download locked crates, but does not compile foreign-platform code.

Where upstream only declares an SPDX identifier and supplies no complete text, the supplement includes the corresponding standard text from SPDX license-list-data v3.27.0, with its source URL. Author attribution is copied from Cargo metadata; no copyright years are invented. The objc2 supplements preserve its upstream licensing explanation and add MIT permission text; linux-keyutils and r-efi select the offered Apache-2.0 alternative. The selectors supplement preserves its source header and adds the full MPL-2.0 text.

react-remove-scroll-bar also omits a full license file at its recorded source revision. Its supplement records the published author and MIT declaration, the source revision, and the standard MIT permission text.
