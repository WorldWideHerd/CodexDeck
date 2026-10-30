// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { NotificationSettingsLink } from "./notification-settings-link";
import { bridge } from "@/lib/bridge";
vi.mock("@/lib/bridge", async (original) => ({
  ...(await original<object>()),
  native: true,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("keeps a Persian recovery path after opening fails and permits retry", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  let finish: () => void = () => {};
  const open = vi
    .spyOn(bridge, "openNotificationSettings")
    .mockRejectedValueOnce(new Error("private OS error"))
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
  try {
    await act(async () =>
      root.render(<NotificationSettingsLink platform="macos" fa />),
    );
    const button = host.querySelector("button")!;
    expect(button.textContent).toContain("باز کردن تنظیمات اعلان سیستم");
    await act(async () => button.click());
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "CodexDeck",
    );
    expect(host.textContent).not.toContain("private OS error");
    await act(async () => button.click());
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain("در حال باز کردن");
    await act(async () => finish());
    expect(button.disabled).toBe(false);
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(open).toHaveBeenCalledTimes(2);
    await act(async () =>
      root.render(<NotificationSettingsLink platform="linux" fa={false} />),
    );
    expect(host.querySelector("button")).toBeNull();
    expect(host.textContent).toContain("Open Notifications in system settings");
  } finally {
    await act(async () => root.unmount());
    vi.restoreAllMocks();
  }
});
