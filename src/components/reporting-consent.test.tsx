// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ReportingConsent, ReportingControl } from "./reporting-consent";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const host = document.createElement("div");
let root = createRoot(host);
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
});

it("sends no consent choice until clicked, saves refusal and hides a decided prompt", async () => {
  const choose = vi.fn(async () => {});
  await act(async () =>
    root.render(<ReportingConsent fa={false} busy={false} onChoose={choose} />),
  );
  expect(choose).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Nothing is sent until you choose");
  expect(host.textContent).toContain("The server can see your connection IP");
  const buttons = Array.from(host.querySelectorAll("button"));
  await act(async () =>
    buttons.find((button) => button.textContent === "No thanks")!.click(),
  );
  expect(choose).toHaveBeenCalledWith(false);
  for (const consent of [false, true]) {
    await act(async () =>
      root.render(
        <ReportingConsent
          fa={false}
          busy={false}
          consent={consent}
          onChoose={choose}
        />,
      ),
    );
    expect(host.querySelector("section")).toBeNull();
  }
});

it("keeps the explicit enable choice disabled during saving", async () => {
  let finish = () => {};
  const choose = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () =>
    root.render(
      <ReportingConsent fa busy={false} consent={null} onChoose={choose} />,
    ),
  );
  await act(async () => host.querySelector("button")!.click());
  expect(choose).toHaveBeenCalledWith(true);
  expect(
    Array.from(host.querySelectorAll("button")).every(
      (button) => button.disabled,
    ),
  ).toBe(true);
  await act(async () => finish());
  expect(host.querySelector("button")!.disabled).toBe(false);
});

it("lets the user switch reporting off and back on without resetting the choice", async () => {
  const choose = vi.fn(async () => {});
  await act(async () =>
    root.render(
      <ReportingControl
        fa={false}
        busy={false}
        consent={true}
        onChoose={choose}
      />,
    ),
  );
  expect(
    host.querySelector('[role="switch"]')!.getAttribute("aria-checked"),
  ).toBe("true");
  await act(async () => host.querySelector("button")!.click());
  expect(choose).toHaveBeenLastCalledWith(false);
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
  await act(async () => host.querySelector("button")!.click());
  expect(choose).toHaveBeenLastCalledWith(true);
});
