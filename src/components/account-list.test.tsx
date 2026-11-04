// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AccountCard } from "./account-card";
import { syntheticState } from "@/lib/bridge";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("opens flat list details without duplicating the main quotas and collapses again", async () => {
  const state = syntheticState();
  const a = state.accounts[1];
  a.snapshot!.rateLimitResetCredits = {
    availableCount: 12,
    credits: Array.from({ length: 12 }, (_, index) => ({
      id: `credit-${index}`,
      title: "A long reset credit title ".repeat(15),
      description: "A long reset credit explanation ".repeat(30),
      expiresAt: Date.now() / 1000 + 3600,
    })),
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const noop = () => {};
  try {
    await act(async () =>
      root.render(
        <AccountCard
          a={a}
          index={1}
          accounts={state.accounts}
          settings={{ ...state.settings, layout: "list" }}
          caps={{
            platform: "browser",
            desktopSwitch: false,
            desktopRestore: false,
            reason: null,
          }}
          busy={false}
          now={Date.now() / 1000}
          fa={false}
          t={(_f, e) => e}
          num={String}
          date={String}

          move={async () => {}}
          run={async () => true}
          setEditor={noop}
          setDeleting={noop}
          startLogin={async () => {}}
          cancelLogin={async () => {}}
        />,
      ),
    );
    const trigger = host.querySelector<HTMLButtonElement>(
      ".row-actions button:last-child",
    )!;
    const region = host.querySelector<HTMLElement>('[role="region"]')!;
    expect(region.getAttribute("aria-hidden")).toBe("true");
    expect(region.hasAttribute("inert")).toBe(true);
    await act(async () => trigger.click());
    expect(region.hasAttribute("aria-hidden")).toBe(false);
    expect(region.hasAttribute("inert")).toBe(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(
      region.querySelector(".card-subscription-summary")?.textContent,
    ).toContain("Subscription end");
    expect(
      region.querySelector(".card-subscription-summary")?.textContent,
    ).toContain("Reset credits");
    expect(region.querySelectorAll('[role="progressbar"]')).toHaveLength(0);
    // Long reset-credit copy must not be rendered into the expanding row.
    expect(region.querySelector(".reset-credit-list")).toBeNull();
    expect(region.textContent).not.toContain("A long reset credit");
    const resetTrigger = region.querySelector<HTMLButtonElement>(
      ".card-reset-credits",
    )!;
    await act(async () => resetTrigger.click());
    expect(
      region.querySelector(".account-info-popover .reset-credit-list"),
    ).not.toBeNull();
    // Closing a row also dismisses its nested panel without stealing focus.

    await act(async () => trigger.click());
    expect(region.getAttribute("aria-hidden")).toBe("true");
    expect(region.hasAttribute("inert")).toBe(true);
    expect(region.querySelector(".account-info-popover")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("keeps only one account expanded in the dashboard and supports rapid toggling", async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const { default: App } = await import("@/App");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<App />));
    const preview = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("نمایش داده نمونه"),
    )!;
    await act(async () => preview.click());
    const cards = host.querySelectorAll<HTMLElement>("[data-account-id]");
    const toggle = (index: number) =>
      cards[index].querySelector<HTMLButtonElement>(
        ".row-actions button:last-child",
      )!;
    const panels = () =>
      host.querySelectorAll('.account-disclosure[data-state="open"]');
    expect(panels()).toHaveLength(0);
    await act(async () => toggle(0).click());
    expect(panels()).toHaveLength(1);
    expect(toggle(0).getAttribute("aria-expanded")).toBe("true");
    await act(async () => toggle(1).click());
    expect(panels()).toHaveLength(1);
    expect(toggle(0).getAttribute("aria-expanded")).toBe("false");
    expect(
      cards[0].querySelector('[role="region"]')?.hasAttribute("inert"),
    ).toBe(true);
    expect(toggle(1).getAttribute("aria-expanded")).toBe("true");
    // Reopen during the previous closing animation, then close everything.
    await act(async () => toggle(0).click());
    expect(panels()).toHaveLength(1);
    expect(toggle(1).getAttribute("aria-expanded")).toBe("false");
    await act(async () => toggle(0).click());
    expect(panels()).toHaveLength(0);
    expect(
      host.querySelectorAll(".account-disclosure:not([inert])"),
    ).toHaveLength(0);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("restores focus to settings after closing, including when opened by shortcut", async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const { default: App } = await import("@/App");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const settle = async () => {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
  };
  try {
    await act(async () => root.render(<App />));
    const opener = host.querySelector<HTMLButtonElement>(".footer-settings")!;
    expect(opener.getAttribute("aria-haspopup")).toBe("dialog");
    await act(async () => opener.click());
    await settle();
    expect(document.querySelector(".settings-dialog")).not.toBeNull();
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(".settings-popover-heading button")!
        .click(),
    );
    await settle();
    expect(document.activeElement).toBe(opener);
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: ",",
          ctrlKey: true,
          bubbles: true,
        }),
      ),
    );
    await settle();
    expect(document.querySelector(".settings-dialog")).not.toBeNull();
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    await settle();
    expect(document.querySelector(".settings-dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
