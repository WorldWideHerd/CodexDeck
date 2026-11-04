// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ReportingControl } from "./reporting-consent";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const host = document.createElement("div");
let root = createRoot(host);
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
});

it.each([undefined, null, true])(
  "shows reporting on for preference %s without asking for permission",
  async (consent) => {
    const choose = vi.fn(async () => {});
    await act(async () =>
      root.render(
        <ReportingControl
          fa={false}
          busy={false}
          consent={consent}
          onChoose={choose}
        />,
      ),
    );
    expect(choose).not.toHaveBeenCalled();
    expect(
      host.querySelector('[role="switch"]')!.getAttribute("aria-checked"),
    ).toBe("true");
    expect(host.textContent).not.toContain("Enable optional reporting");
    await act(async () => host.querySelector("button")!.click());
    expect(choose).toHaveBeenLastCalledWith(false);
  },
);

it("keeps an existing opt-out off and lets the user re-enable reporting", async () => {
  const choose = vi.fn(async () => {});
  await act(async () =>
    root.render(
      <ReportingControl
        fa={false}
        busy={false}
        consent={false}
        onChoose={choose}
      />,
    ),
  );
  expect(
    host.querySelector('[role="switch"]')!.getAttribute("aria-checked"),
  ).toBe("false");
  await act(async () => host.querySelector("button")!.click());
  expect(choose).toHaveBeenLastCalledWith(true);
});
