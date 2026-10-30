// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SettingsPanel } from "./settings-panel";
import { bridge, emptyState } from "@/lib/bridge";
vi.mock("@/lib/bridge", async (original) => ({
  ...(await original<object>()),
  native: true,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("shows notification failure inside settings and allows retry without claiming presentation", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const test = vi
    .spyOn(bridge, "testNotification")
    .mockRejectedValueOnce("OS notification permission is denied.")
    .mockResolvedValueOnce(null);
  const check = vi
    .spyOn(bridge, "checkNotificationReadiness")
    .mockResolvedValue(null);
  try {
    await act(async () =>
      root.render(
        <SettingsPanel
          state={emptyState}
          caps={{
            platform: "macos",
            desktopSwitch: false,
            desktopRestore: false,
            reason: null,
          }}
          busy={false}
          fa={false}
          t={(_f, e) => e}
          num={String}
          settings={async () => {}}
          run={async (action) => {
            try {
              await action();
              return true;
            } catch {
              return false;
            }
          }}
        />,
      ),
    );
    const trigger = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Test notification",
    )!;
    expect(
      host.querySelector(".notification-readiness")?.textContent,
    ).toContain("Enabled");
    expect(host.querySelector(".notification-help")).toBeNull();
    expect(check).toHaveBeenCalledOnce();
    await act(async () => trigger.click());
    expect(host.querySelector(".notification-result")?.textContent).toContain(
      "Enable CodexDeck notifications",
    );
    expect(host.querySelector(".notification-help")).toBeNull();
    expect(host.textContent).not.toContain("Settings & help");
    expect(host.textContent).not.toContain("System notification settings");
    expect(host.textContent).not.toContain("Recheck status");
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(host.querySelector(".notification-result")).toBeNull();
    await act(async () => trigger.click());
    expect(test).toHaveBeenCalledTimes(2);
    expect(host.querySelector(".notification-result")?.textContent).toContain(
      "submitted to the OS",
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  }
});
