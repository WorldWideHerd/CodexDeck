// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AccountCard } from "./account-card";
import { bridge, syntheticState } from "@/lib/bridge";
import type { Account } from "@/lib/types";
vi.mock("@/lib/bridge", async (original) => ({
  ...(await original<typeof import("@/lib/bridge")>()),
  native: true,
  bridge: { switch: vi.fn(async () => ({})) },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("switches the selected connected account in the original desktop app", async () => {
  const state = syntheticState();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const run = vi.fn(async (action: () => Promise<unknown>) => {
    await action();
    return true;
  });
  const render = async (account: Account, supported = true, busy = false) => {
    await act(async () =>
      root.render(
        <AccountCard
          a={account}
          index={0}
          accounts={state.accounts}
          settings={{ ...state.settings, layout: "list" }}
          caps={{
            platform: "macos",
            desktopSwitch: supported,
            desktopRestore: true,
            reason: supported ? null : "desktopMissing",
          }}
          busy={busy}
          now={Date.now() / 1000}
          fa={false}
          t={(_f, e) => e}
          num={String}
          date={String}
          move={async () => {}}
          run={run}
          setEditor={() => {}}
          setDeleting={() => {}}
          startLogin={async () => {}}
          cancelLogin={async () => {}}
        />,
      ),
    );
    return host.querySelector<HTMLButtonElement>(".row-use-codex")!;
  };
  try {
    let button = await render({ ...state.accounts[0], status: "connected" });
    expect(button.disabled).toBe(false);
    expect(
      host.querySelector(".account-disclosure")?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(button.title).toContain("close and reopen");
    await act(async () => button.click());
    expect(bridge.switch).toHaveBeenCalledWith(state.accounts[0].id);
    expect(run).toHaveBeenCalledTimes(1);
    for (const status of [
      "needsLogin",
      "idle",
      "signingIn",
      "failed",
    ] as const) {
      button = await render({ ...state.accounts[0], status });
      expect(button.disabled).toBe(true);
    }
    expect((await render(state.accounts[0], false)).disabled).toBe(true);
    expect((await render(state.accounts[0], true, true)).disabled).toBe(true);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
