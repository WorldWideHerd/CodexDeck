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
  await click(button("Set up start"));
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
  await click(button("Send to 1 account"));
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
  await click(button("Schedule send"));
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
  await click(button("View results"));
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
  ).toContain("1 account");
  expect(
    host.querySelector('.warmup-toolbar [role="status"]')?.textContent,
  ).toContain("Scheduled");
  expect(button("View schedule")).toBeDefined();
  await act(async () => receive({ ...job, status: "running" }));
  expect(button("View progress")).toBeDefined();
});

it("shows the selected count and only shows scheduling guidance when needed", async () => {
  expect(button("Send to 2 accounts")).toBeDefined();
  expect(document.querySelector(".warmup-hint")).toBeNull();
  await click(
    document.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1],
  );
  expect(document.querySelector(".warmup-hint")?.textContent).toContain(
    "keep the app open",
  );
  expect(button("Schedule send")).toBeDefined();
});

it("opens completed results without exposing the send form or sending again", async () => {
  await act(async () =>
    receive({
      ...job,
      status: "complete",
      rows: [
        { ...job.rows[0], status: "confirmed" },
        { ...job.rows[0], accountId: "active", status: "alreadyActive" },
        { ...job.rows[0], accountId: "unknown", status: "uncertain" },
      ],
    }),
  );
  await click(button("View results"));
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.querySelector("h2")?.textContent).toBe("Run results");
  expect(dialog.querySelector('input[type="checkbox"]')).toBeNull();
  expect(dialog.textContent).not.toContain("Send to");
  expect(
    [...dialog.querySelectorAll(".warmup-result-counts strong")].map(
      (e) => e.textContent,
    ),
  ).toEqual(["1", "1", "1"]);
  expect(bridge.startWarmup).not.toHaveBeenCalled();
  await click(
    [...dialog.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "New run",
    )!,
  );
  expect(dialog.querySelector("h2")?.textContent).toBe("Set up start");
  expect(dialog.querySelector(".warmup-results")).toBeNull();
  expect(button("Send to 2 accounts")).toBeDefined();
  expect(bridge.startWarmup).not.toHaveBeenCalled();
});

it("keeps the result view when a live run completes and offers no new run while occupied", async () => {
  await click(button("Send to 2 accounts"));
  expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe(
    "Scheduled start",
  );
  expect(document.querySelector('input[type="checkbox"]')).toBeNull();
  expect(document.body.textContent).not.toContain("New run");
  await act(async () => receive({ ...job, status: "running" }));
  expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe(
    "Run progress",
  );
  expect(document.querySelector("progress")?.value).toBe(0);
  await act(async () =>
    receive({
      ...job,
      status: "complete",
      rows: [{ ...job.rows[0], status: "failed" }],
    }),
  );
  expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe(
    "Run results",
  );
  expect(document.querySelector('input[type="checkbox"]')).toBeNull();
  expect(
    document.querySelector('[data-tone="attention"]')?.textContent,
  ).toContain("failed");
  expect(bridge.startWarmup).toHaveBeenCalledTimes(1);
});

it("marks partial selection and disables sending with no accounts selected", async () => {
  const boxes = [
    ...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  ];
  await click(boxes[2]);
  expect(boxes[0].indeterminate).toBe(true);
  await click(boxes[1]);
  expect(button("Send to 0 accounts").disabled).toBe(true);
  expect(boxes[0].indeterminate).toBe(false);
});

it("shows an actionable send error without blaming the schedule", async () => {
  vi.mocked(bridge.startWarmup).mockRejectedValue(new Error("offline"));
  await click(button("Send to 2 accounts"));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Check your connection and the selected accounts",
  );
  expect(document.querySelector('[role="alert"]')?.textContent).not.toContain(
    "30 days",
  );
  expect(button("Send to 2 accounts").disabled).toBe(false);
});

it("uses Persian results copy and returns focus to the dashboard on close", async () => {
  await act(async () =>
    root.render(
      <WarmupPanel
        accounts={syntheticState().accounts}
        fa={true}
        calendar="persian"
      />,
    ),
  );
  await act(async () => receive({ ...job, status: "complete" }));
  const trigger = button("مشاهدهٔ نتیجه");
  await click(trigger);
  expect(document.querySelector('[role="dialog"]')?.getAttribute("dir")).toBe(
    "rtl",
  );
  expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe(
    "نتیجهٔ اجرا",
  );
  expect(document.querySelector('input[type="checkbox"]')).toBeNull();
  await click(button("بستن"));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  expect(document.activeElement).toBe(trigger);
});
