import { beforeEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  native: true,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: () => mocks.native,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
import { bridge } from "./bridge";
beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.listen.mockReset();
});
describe("shared Tauri contract", () => {
  it("uses native file selection and returns only transfer counts or cancellation", async () => {
    mocks.invoke.mockResolvedValueOnce({ imported: 2, skipped: 1 });
    await expect(bridge.transfer("synthetic password", true)).resolves.toEqual({
      imported: 2,
      skipped: 1,
    });
    expect(mocks.invoke).toHaveBeenLastCalledWith("transfer_accounts", {
      password: "synthetic password",
      importing: true,
    });
    mocks.invoke.mockResolvedValueOnce(null);
    await expect(
      bridge.transfer("synthetic password", false),
    ).resolves.toBeNull();
  });
  it("delegates quit to the native lifecycle command", async () => {
    await bridge.quit();
    expect(mocks.invoke).toHaveBeenLastCalledWith("quit_app", undefined);
  });
  it("sends exact command names and camelCase payloads", async () => {
    await bridge.add("Work", "workspace-1");
    expect(mocks.invoke).toHaveBeenLastCalledWith("add_account", {
      label: "Work",
      workspaceId: "workspace-1",
    });
    await bridge.update("a", { subscriptionEndsAt: 123, alertThreshold: null });
    expect(mocks.invoke).toHaveBeenLastCalledWith("update_account", {
      id: "a",
      patch: { subscriptionEndsAt: 123, alertThreshold: null },
    });
    await bridge.reorder(["b", "a"]);
    expect(mocks.invoke).toHaveBeenLastCalledWith("reorder_accounts", {
      ids: ["b", "a"],
    });
    await bridge.refresh("a");
    expect(mocks.invoke).toHaveBeenLastCalledWith("refresh_accounts", {
      id: "a",
    });
  });
  it("delegates login, pin, and switching without synthetic success", async () => {
    await bridge.login("a");
    expect(mocks.invoke).toHaveBeenLastCalledWith("start_login", { id: "a" });
    await bridge.cancel("a");
    expect(mocks.invoke).toHaveBeenLastCalledWith("cancel_login", { id: "a" });
    await bridge.pin(true);
    expect(mocks.invoke).toHaveBeenLastCalledWith("set_pinned", {
      pinned: true,
    });
    await bridge.switch("a");
    expect(mocks.invoke).toHaveBeenLastCalledWith("switch_desktop_account", {
      id: "a",
    });
    mocks.invoke.mockRejectedValueOnce("Unsupported");
    await expect(bridge.restore()).rejects.toBe("Unsupported");
  });
  it("cleans up both subscriptions and partially subscribed failures", async () => {
    const offState = vi.fn(),
      offLogin = vi.fn();
    mocks.listen
      .mockResolvedValueOnce(offState)
      .mockResolvedValueOnce(offLogin);
    const state = vi.fn(),
      login = vi.fn();
    const off = await bridge.subscribe(state, login);
    expect(mocks.listen.mock.calls.map((c) => c[0])).toEqual([
      "state-changed",
      "login-changed",
    ]);
    mocks.listen.mock.calls[0][1]({ payload: { accounts: [] } });
    expect(state).toHaveBeenCalledWith({ accounts: [] });
    off();
    expect(offState).toHaveBeenCalledOnce();
    expect(offLogin).toHaveBeenCalledOnce();
    mocks.listen
      .mockResolvedValueOnce(offState)
      .mockRejectedValueOnce("event unavailable");
    await expect(bridge.subscribe(state, login)).rejects.toBe(
      "event unavailable",
    );
    expect(offState).toHaveBeenCalledTimes(2);
  });
});

describe("browser safety", () => {
  it("rejects native operations in browser mode without invoking transport", async () => {
    vi.resetModules();
    mocks.native = false;
    try {
      const browser = await import("./bridge");
      await expect(browser.bridge.login("preview")).rejects.toThrow("desktop");
      await expect(browser.bridge.quit()).rejects.toThrow("desktop");
      expect(mocks.invoke).not.toHaveBeenCalled();
    } finally {
      mocks.native = true;
      vi.resetModules();
    }
  });
});

it("delegates notification testing to the native permission-aware command", async () => {
  mocks.invoke.mockResolvedValueOnce(null);
  await expect(bridge.testNotification()).resolves.toBeNull();
  expect(mocks.invoke).toHaveBeenLastCalledWith("test_notification", undefined);
});

it("opens notification settings through a fixed native command without a URL payload", async () => {
  await bridge.openNotificationSettings();
  expect(mocks.invoke).toHaveBeenLastCalledWith(
    "open_notification_settings",
    undefined,
  );
});

it("rechecks native permission without requesting or sending a notification", async () => {
  mocks.invoke.mockResolvedValueOnce(null);
  await expect(bridge.checkNotificationReadiness()).resolves.toBeNull();
  expect(mocks.invoke).toHaveBeenLastCalledWith(
    "check_notification_readiness",
    undefined,
  );
});

it("accepts only known switch progress phases and terminal cleanup", async () => {
  const receive = vi.fn();
  await bridge.subscribeDesktopSwitch(receive);
  const call = mocks.listen.mock.calls.at(-1)!;
  expect(call[0]).toBe("desktop-switch-progress");
  const listener = call[1] as (event: { payload: unknown }) => void;
  listener({ payload: "quitting" });
  listener({ payload: "saving" });
  listener({ payload: "private unexpected value" });
  listener({ payload: { secret: "unexpected" } });
  listener({ payload: null });
  expect(receive.mock.calls.map(([phase]) => phase)).toEqual([
    "quitting",
    "saving",
    null,
  ]);
});
