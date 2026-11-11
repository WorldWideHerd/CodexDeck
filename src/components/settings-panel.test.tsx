import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountTransfer } from "./account-transfer";
import { SettingsPanel } from "./settings-panel";
import { emptyState } from "@/lib/bridge";
import type { PlatformCapabilities, Settings } from "@/lib/types";

function render(
  patch: Partial<Settings> = {},
  platformCaps: Partial<PlatformCapabilities> = {},
) {
  const settings = { ...emptyState.settings, ...patch };
  const fa = settings.language === "fa";
  return renderToStaticMarkup(
    <SettingsPanel
      state={{ ...emptyState, settings }}
      caps={{
        platform: "browser",
        desktopSwitch: false,
        desktopRestore: false,
        reason: null,
        ...platformCaps,
      }}
      busy={false}
      fa={fa}
      t={(persian, english) => (fa ? persian : english)}
      num={(n) => String(n)}
      settings={async () => {}}
      run={async () => true}
    />,
  );
}

function buttons(html: string) {
  return Array.from(
    html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g),
  ).map(([, attributes, content]) => ({
    attributes,
    text: content.replace(/<[^>]*>/g, ""),
  }));
}
function selected(html: string) {
  return buttons(html)
    .filter((button) => button.attributes.includes('aria-pressed="true"'))
    .map((button) => button.text);
}

describe("settings panel", () => {
  it("shows Windows restoration and close-first guidance without macOS project copying", () => {
    const html = render(
      {},
      { platform: "windows", desktopSwitch: true, desktopRestore: true },
    );
    expect(html).toContain("Restore original desktop account");
    expect(html).toContain("close Codex and its tasks");
    expect(html).not.toContain("Copy project list");
    expect(html).not.toContain("Touch ID");
  });
  it("defaults to English and identifies the saved calendar, appearance and refresh choices", () => {
    const html = render();
    expect(selected(html)).toEqual(["English", "Persian", "System", "3"]);
    expect(html).toContain('dir="ltr"');
    expect(
      buttons(html).filter((b) =>
        b.attributes.includes('aria-pressed="false"'),
      ),
    ).toHaveLength(8);
  });

  it("reflects changed settings and localizes English choice labels", () => {
    const html = render({
      language: "en",
      calendar: "gregory",
      appearance: "dark",
      refreshMinutes: 30,
    });
    expect(selected(html)).toEqual(["English", "Gregorian", "Dark", "30"]);
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('aria-label="Every 30 minutes"');
    expect(html).toContain('aria-label="App language"');
    expect(html).toContain('aria-label="App appearance"');
  });

  it("explains unavailable services and disables native-only actions in the browser", () => {
    const html = render({ language: "en" });
    expect(html).toContain(
      "The update service is not connected in this version.",
    );
    expect(html).toContain(
      "You can turn reporting off under Usage &amp; errors.",
    );
    expect(html).toContain('role="switch" aria-checked="true" disabled=""');
    expect(html).toContain("without account details or chat content.");
    for (const label of ["Quit app", "Choose Codex CLI executable"]) {
      const action = buttons(html).find((button) => button.text === label);
      expect(action, label).toBeDefined();
      expect(action!.attributes, label).toContain('disabled=""');
    }
    expect(html).not.toContain("Restore original desktop account");
    expect(html).toContain("Account transfer &amp; backup");
    expect(html).not.toContain('type="password"');
    const transfer = renderToStaticMarkup(
      <AccountTransfer fa={false} busy={false} run={async () => true} />,
    );
    for (const label of ["Export JSON", "Import JSON"]) {
      const action = buttons(transfer).find((button) => button.text === label);
      expect(action, label).toBeDefined();
      expect(action!.attributes, label).toContain('disabled=""');
    }
    expect(html).not.toContain("You’re up to date");
  });
});
