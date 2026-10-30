// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AccountCard } from "./account-card";
import type { Account, Settings } from "@/lib/types";
import { bridge, emptyState, syntheticState } from "@/lib/bridge";
vi.mock("@/lib/bridge", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  native: true,
}));
let root: Root;
let host: HTMLDivElement;
const edit = vi.fn();
const login = vi.fn();
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}
async function click(button: HTMLElement) {
  await act(async () => {
    button.click();
  });
  await settle();
}
function button(text: string) {
  const element = [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === text,
  );
  if (!element) throw new Error(`Button missing: ${text}`);
  return element;
}
beforeEach(async () => {
  edit.mockReset();
  login.mockReset();
  vi.spyOn(bridge, "refresh").mockResolvedValue(syntheticState());
  vi.spyOn(bridge, "update").mockResolvedValue(syntheticState());
  Object.assign(globalThis, {
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await renderCard();
});
async function renderCard(
  expiryOffset?: number,
  missingCredits = false,
  overrides: Partial<Account> = {},
  layout: Settings["layout"] = "cards",
) {
  const state = syntheticState();
  const a = { ...state.accounts[1], ...overrides };
  if (expiryOffset != null)
    a.snapshot!.rateLimitResetCredits = {
      availableCount: 1,
      credits: [
        { id: "test", title: "Gift", expiresAt: 1000000 + expiryOffset },
      ],
    };
  if (missingCredits) a.snapshot!.rateLimitResetCredits = null;
  await act(async () =>
    root.render(
      <AccountCard
        a={a}
        index={1}
        accounts={state.accounts}
        settings={{ ...emptyState.settings, layout }}
        caps={{
          platform: "macos",
          desktopSwitch: false,
          desktopRestore: false,
          reason: null,
        }}
        busy={false}
        now={expiryOffset != null ? 1000000 : Date.now() / 1000}
        fa={false}
        t={(_f, e) => e}
        num={String}
        date={String}

        move={async () => {}}
        run={async (action) => {
          try {
            await action();
            return true;
          } catch {
            return false;
          }
        }}
        setEditor={edit}
        setDeleting={() => {}}
        startLogin={login}
        cancelLogin={async () => {}}
      />,
    ),
  );
}

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  await settle();
});
describe("account information card popover", () => {
  it("opens within its own card, then closes with Escape and restores focus", async () => {
    const trigger = document.querySelector<HTMLButtonElement>(
      ".card-reset-credits",
    )!;
    await click(trigger);
    const panel = document.querySelector(".account-info-popover")!;
    expect(panel.getAttribute("role")).toBe("dialog");
    expect(panel.classList.contains("deck-dialog")).toBe(false);
    expect(document.querySelector(".deck-dialog-overlay")).toBeNull();
    expect(trigger.closest(".account")?.contains(panel)).toBe(true);
    expect(panel.closest("[data-radix-popper-content-wrapper]")).toBeNull();
    expect(trigger.getAttribute("aria-controls")).toBe(panel.id);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await settle();
    expect(document.querySelector(".account-info-popover")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it("dismisses on outside pointer interaction", async () => {
    await click(
      document.querySelector<HTMLButtonElement>(".card-reset-credits")!,
    );
    await act(async () => {
      document
        .querySelector("body")!
        .dispatchEvent(
          new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
        );
      document.body.click();
    });
    await settle();
    expect(document.querySelector(".account-info-popover")).toBeNull();
  });
  it("opens the subscription panel and closes before editing", async () => {
    const indicator = document.querySelector<HTMLButtonElement>(
      ".card-subscription-end",
    )!;
    expect(indicator).not.toBeNull();
    await click(indicator);
    expect(document.querySelectorAll(".account-info-popover")).toHaveLength(1);
    const editorField = document.createElement("input");
    host.append(editorField);
    edit.mockImplementation(() => editorField.focus());
    const editButton = [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".account-info-popover button",
      ),
    ].find((b) => b.textContent?.trim() === "Edit")!;
    await click(editButton);
    expect(edit).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(editorField);
    expect(document.querySelector(".account-info-popover")).toBeNull();
  });
  it("opens only reset credits, without the old icon or generic information action", async () => {
    expect(document.querySelector(".gift-deadline-indicator")).toBeNull();
    expect(host.textContent).not.toContain("More information");
    await click(
      document.querySelector<HTMLButtonElement>(".card-reset-credits")!,
    );
    const panel = document.querySelector(".account-info-popover")!;
    expect(panel.querySelector("h2")?.textContent).toBe("Reset credits");
    expect(panel.textContent).toContain("Expires");
    expect(panel.textContent).not.toContain("Subscription end");
  });
  it.each([
    [259201, "normal"],
    [259200, "soon"],
    [86401, "soon"],
    [86400, "urgent"],
    [1, "urgent"],
    [0, "expired"],
  ])("marks a reset credit %s seconds away as %s", async (seconds, urgency) => {
    await renderCard(Number(seconds));
    expect(
      document
        .querySelector(".card-reset-credits")
        ?.classList.contains(String(urgency)),
    ).toBe(true);
  });
  it("keeps unknown resets clickable and explains missing details", async () => {
    await renderCard(undefined, true);
    const trigger = document.querySelector<HTMLButtonElement>(
      ".card-reset-credits",
    )!;
    expect(trigger.textContent).toContain("Unknown");
    await click(trigger);
    expect(
      document.querySelector(".account-info-popover")?.textContent,
    ).toContain("Credit details have not been reported.");
  });
});

describe("animated account actions menu", () => {
  it("restores trigger focus on Escape and dismisses on outside click", async () => {
    const trigger = host.querySelector<HTMLButtonElement>(
      ".account-menu > button",
    )!;
    expect(host.querySelector(".account-action-popover")).toBeNull();
    await click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(
      host.querySelector(".account-action-popover")?.getAttribute("data-state"),
    ).toBe("open");
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await settle();
    expect(host.querySelector(".account-action-popover")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await click(trigger);
    await act(async () => {
      document.body.dispatchEvent(
        new MouseEvent("pointerdown", { button: 0, bubbles: true }),
      );
      document.body.click();
    });
    await settle();
    expect(host.querySelector(".account-action-popover")).toBeNull();
  });
});

describe("quick account saves", () => {
  it.each(["color", "alert"])(
    "closes the %s editor only after a successful native save",
    async (mode) => {
      let complete!: (state: ReturnType<typeof syntheticState>) => void;
      vi.mocked(bridge.update).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      );
      if (mode === "color") {
        await click(
          document.querySelector<HTMLButtonElement>(".account-avatar")!,
        );
        await click(
          document.querySelector<HTMLButtonElement>('[aria-label="Violet"]')!,
        );
      } else {
        await click(
          host.querySelector<HTMLButtonElement>(".account-menu > button")!,
        );
        await click(button("Set quota alert"));
        const toggle =
          document.querySelector<HTMLInputElement>('[role="switch"]')!;
        if (!toggle.checked) await click(toggle);
        await click(button("30%"));
      }
      await click(button("Save"));
      expect(bridge.update).toHaveBeenCalledWith(
        syntheticState().accounts[1].id,
        mode === "color" ? { color: "#7585f8" } : { alertThreshold: 30 },
      );
      expect(document.querySelector(".quick-account-dialog")).not.toBeNull();
      await act(async () => complete(syntheticState()));
      await settle();
      expect(document.querySelector(".quick-account-dialog")).toBeNull();
    },
  );
  it("keeps a failed save editable, shows the error inside the dialog, and closes on retry", async () => {
    vi.mocked(bridge.update).mockRejectedValueOnce(
      "Could not save app storage.",
    );
    await click(
      host.querySelector<HTMLButtonElement>(".account-menu > button")!,
    );
    await click(button("Set quota alert"));
    await click(button("Save"));
    expect(
      document.querySelector(".quick-account-dialog [role=alert]")?.textContent,
    ).toBeTruthy();
    await click(button("Save"));
    expect(bridge.update).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".quick-account-dialog")).toBeNull();
  });
});

describe("missing quota reports", () => {
  it.each([
    [
      "connected",
      "Usage data has not been reported yet.",
      "Refresh usage",
      false,
    ],
    ["failed", "Usage data has not been reported yet.", "Refresh usage", false],
    ["refreshing", "Receiving usage data…", "Receiving", true],
    ["idle", "Real usage appears after sign-in.", "Sign in", false],
    ["needsLogin", "Real usage appears after sign-in.", "Sign in", false],
    ["signingIn", "Waiting for sign-in to finish…", "Signing in", true],
  ] as const)(
    "explains the %s state",
    async (status, message, action, disabled) => {
      await renderCard(undefined, false, { status, snapshot: null });
      const empty = host.querySelector(".no-usage")!;
      expect(empty.textContent).toContain(message);
      const trigger = empty.querySelector("button")!;
      expect(trigger.textContent).toBe(action);
      expect(trigger.disabled).toBe(disabled);
      if (!disabled) {
        await click(trigger);
        if (action === "Sign in") {
          expect(login).toHaveBeenCalledOnce();
          expect(bridge.refresh).not.toHaveBeenCalled();
        } else {
          expect(bridge.refresh).toHaveBeenCalledWith(
            syntheticState().accounts[1].id,
          );
          expect(login).not.toHaveBeenCalled();
        }
      }
    },
  );
  it("explains credits-only reports while keeping the reported credit balance accessible", async () => {
    await renderCard(undefined, false, {
      status: "connected",
      snapshot: {
        rateLimits: { credits: { balance: "12.50" } },
      },
    });
    expect(host.querySelector(".no-usage")?.textContent).toContain(
      "Usage data has not been reported yet.",
    );
    expect(host.querySelectorAll(".quota")).toHaveLength(0);
    await click(button("Credits & limits"));
    expect(
      document.querySelector(".account-info-popover")?.textContent,
    ).toContain("12.50");
  });
});

it("offers the same account actions, subscription editing, alerts, and balances in list view", async () => {
  await click(host.querySelector<HTMLButtonElement>(".account-menu > button")!);
  const cardActions = Array.from(
    host.querySelectorAll(".account-action-popover > button"),
    (button) => button.textContent?.trim(),
  );
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  await settle();
  const source = syntheticState().accounts[1];
  await renderCard(
    undefined,
    false,
    {
      snapshot: {
        ...source.snapshot,
        rateLimitsByLimitId: {
          codex: {
            ...source.snapshot?.rateLimitsByLimitId?.codex,
            individualLimit: { remainingPercent: 42, resetsAt: 3000000 },
            credits: { balance: "12.50" },
          },
        },
      },
    },
    "list",
  );
  await click(
    host.querySelector<HTMLButtonElement>(".row-actions button:last-child")!,
  );
  await click(host.querySelector<HTMLButtonElement>(".account-menu > button")!);
  expect(
    Array.from(
      host.querySelectorAll(".account-action-popover > button"),
      (button) => button.textContent?.trim(),
    ),
  ).toEqual(cardActions);
  await click(button("Set quota alert"));
  expect(document.querySelector(".quick-account-dialog")).not.toBeNull();
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  await settle();
  await click(host.querySelector<HTMLButtonElement>(".account-more-trigger")!);
  const limits = host.querySelector(".account-info-popover")!;
  expect(limits.textContent).toContain("42%");
  expect(limits.textContent).toContain("12.50");
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  await settle();
  await click(host.querySelector<HTMLButtonElement>(".card-subscription-end")!);
  await click(button("Edit"));
  expect(edit).toHaveBeenCalledOnce();
  expect(host.querySelector(".account-info-popover")).toBeNull();
});

it("opens quota notifications from the collapsed list and saves the threshold", async () => {
  await renderCard(undefined, false, { alertThreshold: 20 }, "list");
  const alert = host.querySelector<HTMLButtonElement>(".row-notification")!;
  expect(alert.classList.contains("is-enabled")).toBe(true);
  expect(alert.title).toContain("20%");
  await click(alert);
  expect(
    host.querySelector(".account-disclosure")?.getAttribute("aria-hidden"),
  ).toBe("true");
  expect(document.querySelector(".quick-account-dialog")).not.toBeNull();
  await click(button("30%"));
  const form = document.querySelector<HTMLFormElement>(
    ".quick-account-dialog form",
  )!;
  await act(async () => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  await settle();
  expect(bridge.update).toHaveBeenCalledWith(syntheticState().accounts[1].id, {
    alertThreshold: 30,
  });
  expect(document.querySelector(".quick-account-dialog")).toBeNull();
});
