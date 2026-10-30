import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MenubarPanel } from "./menubar-panel";
import { syntheticState, emptyState } from "@/lib/bridge";
const now = Date.now() / 1000;
describe("menu bar summary", () => {
  it("shows known quotas without manufacturing unknown windows", () => {
    const state = syntheticState();
    state.accounts[0].snapshot = null;
    const html = renderToStaticMarkup(
      <MenubarPanel
        state={state}
        busy={false}
        now={now}
        run={async () => true}
      />,
    );
    expect(html).toContain("Personal studio");
    expect(html).toContain("—");
    expect(html).toContain("۵ ساعته");
  });
  it("marks cached quotas as stale rather than current", () => {
    const state = syntheticState();
    state.accounts[0].status = "needsLogin";
    const html = renderToStaticMarkup(
      <MenubarPanel
        state={state}
        busy={false}
        now={now}
        run={async () => true}
      />,
    );
    expect(html).toContain('class="menubar-quota cached"');
    expect(html).toContain("اطلاعات قدیمی");
  });
  it("handles an empty English account list", () => {
    const state = {
      ...emptyState,
      settings: { ...emptyState.settings, language: "en" as const },
    };
    const html = renderToStaticMarkup(
      <MenubarPanel
        state={state}
        busy={false}
        now={now}
        run={async () => true}
      />,
    );
    expect(html).toContain("No accounts yet");
    expect(html).toContain("Open app");
  });
});
