// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AccountReorder } from "./account-reorder";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => vi.restoreAllMocks());

async function setup(
  enabled = true,
  onCommit: (ids: string[]) => void | Promise<unknown> = () => {},
) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const commit = vi.fn(onCommit);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const index = Array.from(this.parentElement?.children ?? []).indexOf(
        this,
      );
      return {
        left: 0,
        right: 100,
        top: index * 120,
        bottom: index * 120 + 100,
        width: 100,
        height: 100,
        x: 0,
        y: index * 120,
        toJSON() {},
      };
    },
  );
  await act(async () =>
    root.render(
      <AccountReorder
        ids={["a", "b", "c"]}
        enabled={enabled}
        className="accounts cards"
        onCommit={commit}
      >
        {(id) => (
          <div key={id} data-account-id={id}>
            {id}
            <button>Action</button>
          </div>
        )}
      </AccountReorder>,
    ),
  );
  const dispatch = async (
    target: EventTarget,
    type: string,
    x: number,
    y: number,
  ) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: x,
      clientY: y,
    });
    Object.defineProperty(event, "pointerId", { value: 1 });
    await act(async () => {
      target.dispatchEvent(event);
    });
    return event;
  };
  const ids = () =>
    Array.from(host.querySelectorAll<HTMLElement>("[data-account-id]")).map(
      (node) => node.dataset.accountId,
    );
  return {
    host,
    commit,
    dispatch,
    ids,
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

it("fills the source slot live, follows the pointer into gaps, and saves once on release", async () => {
  const test = await setup();
  try {
    const source = test.host.querySelector<HTMLElement>(
      '[data-account-id="a"]',
    )!;
    await test.dispatch(source, "pointerdown", 25, 25);
    await test.dispatch(window, "pointermove", 30, 150);
    expect(test.ids()).toEqual(["b", "a", "c"]);
    expect(source.style.opacity).toBe("0");
    expect(test.commit).not.toHaveBeenCalled();
    await test.dispatch(window, "pointermove", 30, 235);
    expect(test.ids()).toEqual(["b", "c", "a"]);
    expect(
      test.host.querySelector<HTMLElement>(".account-drag-preview")?.style
        .transform,
    ).toBe("translate(5px, 210px)");
    await test.dispatch(window, "pointerup", 30, 235);
    expect(test.commit).toHaveBeenCalledExactlyOnceWith(["b", "c", "a"]);
    expect(test.host.querySelector(".account-drag-preview")).toBeNull();
    expect(source.style.opacity).toBe("");
  } finally {
    await test.close();
  }
});

it("prevents native selection before dragging and clears existing selection only on drag", async () => {
  const test = await setup();
  const previousSelection = document.body.style.userSelect;
  document.body.style.userSelect = "text";
  try {
    const source = test.host.querySelector('[data-account-id="a"]')!;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(source);
    selection.addRange(range);
    expect(
      (await test.dispatch(source, "pointerdown", 25, 25)).defaultPrevented,
    ).toBe(true);
    await test.dispatch(window, "pointermove", 27, 27);
    expect(selection.rangeCount).toBe(1);
    await test.dispatch(window, "pointermove", 25, 270);
    expect(selection.rangeCount).toBe(0);
    expect(document.body.style.userSelect).toBe("none");
    await test.dispatch(window, "pointerup", 25, 270);
    expect(document.body.style.userSelect).toBe("text");
    expect(
      (
        await test.dispatch(
          test.host.querySelector("button")!,
          "pointerdown",
          25,
          25,
        )
      ).defaultPrevented,
    ).toBe(false);
  } finally {
    document.body.style.userSelect = previousSelection;
    await test.close();
  }
});

it("restores order on Escape or pointer cancellation without saving", async () => {
  const test = await setup();
  try {
    for (const cancel of ["escape", "pointercancel"]) {
      await test.dispatch(
        test.host.querySelector('[data-account-id="a"]')!,
        "pointerdown",
        25,
        25,
      );
      await test.dispatch(window, "pointermove", 25, 270);
      expect(test.ids()).toEqual(["b", "c", "a"]);
      if (cancel === "escape")
        await act(async () => {
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        });
      else await test.dispatch(window, "pointercancel", 25, 270);
      expect(test.ids()).toEqual(["a", "b", "c"]);
    }
    expect(test.commit).not.toHaveBeenCalled();
  } finally {
    await test.close();
  }
});

it("leaves buttons and clicks alone and respects disabled sorting", async () => {
  for (const enabled of [true, false]) {
    const test = await setup(enabled);
    try {
      await test.dispatch(
        test.host.querySelector("button")!,
        "pointerdown",
        25,
        25,
      );
      await test.dispatch(window, "pointermove", 25, 270);
      await test.dispatch(window, "pointerup", 25, 270);
      await test.dispatch(
        test.host.querySelector('[data-account-id="a"]')!,
        "pointerdown",
        25,
        25,
      );
      await test.dispatch(window, "pointermove", 27, 27);
      await test.dispatch(window, "pointerup", 27, 27);
      expect(test.ids()).toEqual(["a", "b", "c"]);
      expect(test.commit).not.toHaveBeenCalled();
    } finally {
      await test.close();
    }
  }
});

it("animates authoritative sorting with stable nodes and focus, and skips motion when requested", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const cancel = vi.fn();
  const animate = vi.fn(
    () => ({ cancel, finished: Promise.resolve() }) as unknown as Animation,
  );
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: animate,
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const index = Array.from(this.parentElement?.children ?? []).indexOf(
        this,
      );
      return {
        left: 0,
        right: 100,
        top: index * 120,
        bottom: index * 120 + 100,
        width: 100,
        height: 100,
      } as DOMRect;
    },
  );
  const render = async (ids: string[], layout = "cards") =>
    act(async () =>
      root.render(
        <AccountReorder
          ids={ids}
          enabled={false}
          className={`accounts ${layout}`}
          onCommit={() => {}}
        >
          {(id) => (
            <div key={id} data-account-id={id}>
              <button>{id}</button>
            </div>
          )}
        </AccountReorder>,
      ),
    );
  try {
    await render(["a", "b"]);
    expect(animate).not.toHaveBeenCalled();
    const account = host.querySelector('[data-account-id="a"]')!;
    const button = account.querySelector("button")!;
    button.focus();
    await render(["b", "a"]);
    expect(host.querySelector('[data-account-id="a"]')).toBe(account);
    expect(document.activeElement).toBe(button);
    expect(animate).toHaveBeenCalledTimes(2);
    const calls = cancel.mock.calls.length;
    await render(["b", "a"]);
    expect(cancel).toHaveBeenCalledTimes(calls);
    expect(animate).toHaveBeenCalledTimes(2);
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    await render(["a", "b"]);
    await render(["a", "b"], "list");
    expect(animate).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[data-account-id="a"]')).toBe(account);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
    vi.unstubAllGlobals();
  }
});

it("retains submitted drag order during a slow save and rolls back rejected saves", async () => {
  let resolve!: (accepted: boolean) => void;
  const saving = new Promise<boolean>((done) => {
    resolve = done;
  });
  const test = await setup(true, () => saving);
  try {
    await test.dispatch(
      test.host.querySelector('[data-account-id="a"]')!,
      "pointerdown",
      25,
      25,
    );
    await test.dispatch(window, "pointermove", 25, 270);
    await test.dispatch(window, "pointerup", 25, 270);
    expect(test.ids()).toEqual(["b", "c", "a"]);
    await act(async () => {
      resolve(false);
      await saving;
    });
    expect(test.ids()).toEqual(["a", "b", "c"]);
    expect(test.commit).toHaveBeenCalledTimes(1);
  } finally {
    await test.close();
  }
});

it("reverses an unfinished reorder from current visible positions", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const offsets = new WeakMap<HTMLElement, number>();
  const frames = new Map<string, Keyframe[]>();
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: function (this: HTMLElement, keyframes: Keyframe[]) {
      frames.set(this.dataset.accountId!, keyframes);
      const dy = Number(
        String(keyframes[0].transform).match(/, ([-\d.]+)px/)?.[1] ?? 0,
      );
      offsets.set(this, dy / 2); // A subsequent update interrupts halfway through.
      return {
        cancel: () => offsets.delete(this),
        finished: Promise.resolve(),
      } as unknown as Animation;
    },
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const index = Array.from(this.parentElement?.children ?? []).indexOf(
        this,
      );
      const top = index * 120 + (offsets.get(this) ?? 0);
      return {
        left: 0,
        right: 100,
        top,
        bottom: top + 100,
        width: 100,
        height: 100,
      } as DOMRect;
    },
  );
  const render = async (ids: string[]) =>
    act(async () =>
      root.render(
        <AccountReorder
          ids={ids}
          enabled={false}
          className="accounts cards"
          onCommit={() => {}}
        >
          {(id) => (
            <div key={id} data-account-id={id}>
              {id}
            </div>
          )}
        </AccountReorder>,
      ),
    );
  try {
    await render(["a", "b"]);
    await render(["b", "a"]);
    expect(frames.get("a")?.[0].transform).toBe("translate(0px, -120px)");
    await render(["a", "b"]);
    expect(frames.get("a")?.[0].transform).toBe("translate(0px, 60px)");
    expect(frames.get("b")?.[0].transform).toBe("translate(0px, -60px)");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  }
});

it("removes and cancels a settling ghost before rolling back a fulfilled false save", async () => {
  let resolve!: (accepted: boolean) => void;
  const saving = new Promise<boolean>((done) => {
    resolve = done;
  });
  const cancelled = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: () =>
      ({
        cancel: cancelled,
        finished: new Promise(() => {}),
      }) as unknown as Animation,
  });
  const test = await setup(true, () => saving);
  try {
    const source = test.host.querySelector<HTMLElement>(
      '[data-account-id="a"]',
    )!;
    await test.dispatch(source, "pointerdown", 25, 25);
    await test.dispatch(window, "pointermove", 25, 270);
    await test.dispatch(window, "pointerup", 25, 270);
    expect(test.host.querySelector(".account-drag-preview")).not.toBeNull();
    expect(source.style.opacity).toBe("0");
    await act(async () => {
      resolve(false);
      await saving;
    });
    expect(test.host.querySelector(".account-drag-preview")).toBeNull();
    expect(source.style.opacity).toBe("");
    expect(cancelled).toHaveBeenCalled();
    expect(test.ids()).toEqual(["a", "b", "c"]);
  } finally {
    await test.close();
    delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  }
});
