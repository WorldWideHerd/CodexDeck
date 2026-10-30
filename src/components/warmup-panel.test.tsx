// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { bridge, syntheticState } from "@/lib/bridge";
import { WarmupPanel, warmupLabel } from "./warmup-panel";
import type { WarmupJob } from "@/lib/types";
vi.mock("@/lib/bridge", async (original) => ({
  ...(await original<object>()),
  native: true,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
let receive: (j: WarmupJob) => void;
const job: WarmupJob = {
  id: "test",
  status: "pending",
  at: Date.now() / 1000 + 3600,
  rows: [
    {
      accountId: "synthetic-0",
      label: "Personal studio",
      status: "queued",
      resetsAt: null,
    },
  ],
};
function button(text: string) {
  const b = [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === text,
  );
  if (!b) throw Error(text);
  return b;
}
async function click(e: HTMLElement) {
  await act(async () => e.click());
}
beforeEach(async () => {
  vi.spyOn(bridge, "warmup").mockResolvedValue(null);
  vi.spyOn(bridge, "subscribeWarmup").mockImplementation(async (fn) => {
    receive = fn;
    return () => {};
  });
  vi.spyOn(bridge, "startWarmup").mockResolvedValue(job);
  vi.spyOn(bridge, "cancelWarmup").mockResolvedValue();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const accounts = syntheticState().accounts;
  accounts[2].status = "needsLogin";
  await act(async () =>
    root.render(
      <WarmupPanel accounts={accounts} fa={false} calendar="gregory" />,
    ),
  );
  await click(button("Start / schedule"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
it("sends only the selected connected accounts, then exposes cancellation", async () => {
  const boxes = [
    ...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  ];
  expect(boxes[3].disabled).toBe(true);
  await click(boxes[2]);
  await click(button("Send to selected accounts"));
  expect(bridge.startWarmup).toHaveBeenCalledExactlyOnceWith(
    ["synthetic-0"],
    null,
  );
  vi.mocked(bridge.warmup).mockResolvedValue({ ...job, status: "cancelled" });
  await click(button("Cancel schedule"));
  expect(bridge.cancelWarmup).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).toContain("Cancelled");
});
it("rejects a past schedule before invoking native transport", async () => {
  await click(
    document.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1],
  );
  const input = document.querySelector<HTMLInputElement>(
    'input[type="datetime-local"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "2020-01-01T10:00");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click(button("Schedule"));
  expect(bridge.startWarmup).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
});
it("keeps send success separate from quota activation and preserves native progress", async () => {
  await act(async () =>
    receive({
      ...job,
      status: "complete",
      rows: [{ ...job.rows[0], status: "sent" }],
    }),
  );
  expect(document.body.textContent).toContain(
    "Reply received — window not yet confirmed",
  );
  expect(warmupLabel("confirmed", false)).toBe("Five-hour window confirmed");
  expect(warmupLabel("uncertain", true)).toContain("خودکار تکرار نمی‌شود");
});

it("exposes the schedule and account count on the dashboard", async () => {
  await act(async () => receive(job));
  expect(
    host.querySelector('.warmup-toolbar [role="status"]')?.textContent,
  ).toContain("1 accounts");
  expect(
    host.querySelector('.warmup-toolbar [role="status"]')?.textContent,
  ).toContain("Scheduled");
  expect(button("View schedule")).toBeDefined();
  await act(async () => receive({ ...job, status: "running" }));
  expect(button("View progress")).toBeDefined();
});
