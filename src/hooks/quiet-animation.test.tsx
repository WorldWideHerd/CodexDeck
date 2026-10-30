// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { syntheticState, bridge } from "@/lib/bridge";
import { refreshSucceeded, useManualRefresh } from "./use-quiet-feedback";
import { useAccountPresence } from "./use-account-presence";
import type { Account } from "@/lib/types";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("requires request-specific completion and healthy returned data for every requested account", () => {
  const before = syntheticState().accounts.map((a) => ({
    ...a,
    updatedAt: 100,
  }));
  const result = {
    ...syntheticState(),
    refreshedIds: before.map((a) => a.id),
    accounts: before.map((a) => ({
      ...a,
      status: "connected" as const,
      error: null,
      updatedAt: 101,
    })),
  };
  expect(refreshSucceeded(before, result)).toBe(true);
  for (const patch of [
    { status: "failed" },
    { status: "needsLogin" },
    { status: "refreshing" },
    { error: "failure" },
    { snapshot: null },
  ])
    expect(
      refreshSucceeded(before, {
        ...result,
        accounts: [
          { ...result.accounts[0], ...patch } as Account,
          ...result.accounts.slice(1),
        ],
      }),
    ).toBe(false);
  expect(refreshSucceeded(before, { ...result, accounts: [] })).toBe(false);
  expect(refreshSucceeded([], result)).toBe(false);
  expect(refreshSucceeded(before, { ...result, refreshedIds: [] })).toBe(false);
  expect(refreshSucceeded(before, { ...result, refreshedIds: undefined })).toBe(
    false,
  );
  expect(
    refreshSucceeded(before, {
      ...result,
      accounts: result.accounts.map((a) => ({ ...a, updatedAt: 100 })),
    }),
  ).toBe(true);
});

it("confirms manual completion only, clears on retry, rejects fulfilled failures and expires feedback", async () => {
  vi.useFakeTimers();
  const root = createRoot(document.createElement("div"));
  const before = syntheticState()
    .accounts.slice(0, 1)
    .map((a) => ({ ...a, updatedAt: 100 }));
  const result = {
    ...syntheticState(),
    refreshedIds: before.map((a) => a.id),
    accounts: before.map((a) => ({
      ...a,
      status: "connected" as const,
      error: null,
      updatedAt: 101,
    })),
  };
  const refresh = vi.spyOn(bridge, "refresh").mockResolvedValue(result);
  let feedback!: ReturnType<typeof useManualRefresh>;
  function Probe() {
    feedback = useManualRefresh(before, async (action) => {
      try {
        await action();
        return true;
      } catch {
        return false;
      }
    });
    return null;
  }
  try {
    await act(async () => root.render(<Probe />));
    expect(feedback.confirmed).toBe(false);
    await act(async () => {
      await feedback.refresh();
    });
    expect(feedback.confirmed).toBe(true);
    refresh.mockResolvedValue({
      ...result,
      accounts: [{ ...result.accounts[0], status: "failed" }],
    });
    await act(async () => {
      await feedback.refresh();
    });
    expect(feedback.confirmed).toBe(false);
    refresh.mockRejectedValue(new Error("offline"));
    await act(async () => {
      await feedback.refresh();
    });
    expect(feedback.confirmed).toBe(false);
    refresh.mockResolvedValue(result);
    await act(async () => {
      await feedback.refresh();
    });
    await act(async () => {
      vi.advanceTimersByTime(1400);
    });
    expect(feedback.confirmed).toBe(false);
  } finally {
    await act(async () => root.unmount());
  }
});

it("skips hydration entrances, retains the last removed record, and never replays after exit", async () => {
  vi.useFakeTimers();
  const root = createRoot(document.createElement("div"));
  let presence!: ReturnType<typeof useAccountPresence>;
  function Probe({
    accounts,
    ready = true,
  }: {
    accounts: Account[];
    ready?: boolean;
  }) {
    presence = useAccountPresence(accounts, ready);
    return null;
  }
  const accounts = syntheticState().accounts.slice(0, 1);
  try {
    await act(async () => root.render(<Probe accounts={[]} ready={false} />));
    await act(async () => root.render(<Probe accounts={accounts} />));
    expect(presence.entering).toEqual([]);
    await act(async () => root.render(<Probe accounts={[]} />));
    expect(presence.accounts).toEqual(accounts);
    expect(presence.exiting).toEqual([accounts[0].id]);
    await act(async () => {
      vi.advanceTimersByTime(180);
    });
    expect(presence.accounts).toEqual([]);
    await act(async () => root.render(<Probe accounts={accounts} />));
    expect(presence.entering).toEqual([accounts[0].id]);
    await act(async () =>
      root.render(
        <Probe accounts={accounts.map((a) => ({ ...a, label: "updated" }))} />,
      ),
    );
    expect(presence.entering).toEqual([accounts[0].id]);
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(presence.entering).toEqual([]);
    await act(async () => root.render(<Probe accounts={[...accounts]} />));
    expect(presence.entering).toEqual([]);
  } finally {
    await act(async () => root.unmount());
  }
});

it("cancels removal when ID returns and removes immediately with reduced motion", async () => {
  vi.useFakeTimers();
  const root = createRoot(document.createElement("div"));
  let presence!: ReturnType<typeof useAccountPresence>;
  function Probe({ accounts }: { accounts: Account[] }) {
    presence = useAccountPresence(accounts);
    return null;
  }
  const accounts = syntheticState().accounts.slice(0, 1);
  try {
    await act(async () => root.render(<Probe accounts={accounts} />));
    await act(async () => root.render(<Probe accounts={[]} />));
    await act(async () => root.render(<Probe accounts={accounts} />));
    await act(async () => {
      vi.advanceTimersByTime(180);
    });
    expect(presence.accounts).toEqual(accounts);
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    await act(async () => root.render(<Probe accounts={[]} />));
    expect(presence.accounts).toEqual([]);
  } finally {
    await act(async () => root.unmount());
  }
});
