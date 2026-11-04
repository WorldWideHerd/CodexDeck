import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MenubarPanel } from "./menubar-panel";
import { syntheticState, emptyState } from "@/lib/bridge";
const now = Date.now() / 1000;
describe("menu bar summary", () => {
  it("shows known quotas without manufacturing unknown windows", () => {
    const state = syntheticState();
    state.settings = { ...state.settings, language: "fa" };
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
    state.settings = { ...state.settings, language: "fa" };
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
  it.each([
    ["needsLogin", "Sign in required"],
    ["failed", "Refresh failed"],
  ] as const)(
    "explains %s even without cached quota data",
    (status, message) => {
      const state = syntheticState();
      state.settings.language = "en";
      state.accounts = [{ ...state.accounts[0], status, snapshot: null }];
      const html = renderToStaticMarkup(
        <MenubarPanel
          state={state}
          busy={false}
          now={now}
          run={async () => true}
        />,
      );
      expect(html).toContain(`aria-label="${message};`);
      expect(html).toContain('class="menubar-account-status"');
      expect(html).not.toContain('class="menubar-meter"');
    },
  );
  it("keeps healthy accounts quiet and names aged data separately from sign-in failures", () => {
    const state = syntheticState();
    state.settings.language = "en";
    state.accounts = [state.accounts[0]];
    const render = () =>
      renderToStaticMarkup(
        <MenubarPanel
          state={state}
          busy={false}
          now={now}
          run={async () => true}
        />,
      );
    expect(render()).not.toContain('class="menubar-account-status"');
    state.accounts[0].updatedAt = now - 360;
    const html = render();
    expect(html).toContain('aria-label="Cached data; refresh to update."');
    expect(html).not.toContain("Sign in required");
  });
});
