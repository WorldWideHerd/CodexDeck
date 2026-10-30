import { describe, it, expect } from "vitest";
import {
  buckets,
  windows,
  remaining,
  ordered,
  reorder,
  countdown,
  deadline,
  isStale,
  nextResetCreditExpiry,
} from "./usage";
import { emptyState, syntheticState } from "./bridge";
describe("quota presentation", () => {
  it("has no default synthetic accounts", () =>
    expect(emptyState.accounts).toEqual([]));
  it("clamps remaining usage without pretending a reset succeeded", () => {
    expect(remaining({ usedPercent: 105 })).toBe(0);
    expect(remaining({ usedPercent: -4 })).toBe(100);
    expect(countdown(10, 20, false)).toBe("Awaiting reset confirmation");
  });
  it("keeps additional buckets, credits, and unknown window durations", () => {
    const s = {
      rateLimits: { primary: { usedPercent: 7 } },
      rateLimitsByLimitId: {
        spark: {
          primary: { usedPercent: 4, windowDurationMins: 60 },
          credits: { balance: "5" },
        },
        codex: { secondary: { usedPercent: 15, windowDurationMins: 10080 } },
      },
    };
    expect(buckets(s).map(([id]) => id)).toEqual(["codex", "spark"]);
    expect(windows(s)).toHaveLength(2);
    expect(buckets(s)[1][1].credits?.balance).toBe("5");
  });
  it("supports a legacy main bucket and missing data", () => {
    expect(buckets(null)).toEqual([]);
    expect(
      windows({ rateLimits: { primary: { usedPercent: 20 } } }),
    ).toHaveLength(1);
    expect(countdown(null, 0, false)).toBe("Reset time unknown");
  });
  it("sorts lowest remaining first while preserving manual order and unknown last", () => {
    const accounts = syntheticState().accounts;
    const unknown = { ...accounts[0], id: "unknown", snapshot: null };
    const original = accounts.map((a) => a.id);
    expect(
      ordered([...accounts, unknown], "fiveHour").map((a) => a.id),
    ).toEqual([accounts[2].id, accounts[1].id, accounts[0].id, "unknown"]);
    expect(accounts.map((a) => a.id)).toEqual(original);
    expect(ordered(accounts, "manual")).toBe(accounts);
  });
  it("ignores past reset dates when sorting", () => {
    const a = syntheticState().accounts;
    const custom = a.map((x, i) => ({
      ...x,
      snapshot: {
        rateLimits: {
          primary: { usedPercent: 10, resetsAt: [10, 500, 200][i] },
        },
      },
    }));
    expect(ordered(custom, "reset", 100).map((a) => a.id)).toEqual([
      a[2].id,
      a[1].id,
      a[0].id,
    ]);
  });
  it("classifies manual and gift deadlines consistently", () => {
    expect(deadline(null, 0)).toBe("unknown");
    expect(deadline(0, 0)).toBe("expired");
    expect(deadline(86400, 0)).toBe("urgent");
    expect(deadline(259200, 0)).toBe("soon");
    expect(deadline(259201, 0)).toBe("normal");
  });
  it("localizes Persian countdown digits", () =>
    expect(countdown(7200, 0, true)).toContain("۲"));
  it("shows two meaningful countdown units and omits zero units", () => {
    expect(countdown(6 * 86400 + 19 * 3600 + 23 * 60, 0, false)).toBe(
      "Resets in 6d 19h",
    );
    expect(countdown(86400, 0, false)).toBe("Resets in 1d");
    expect(countdown(7200, 0, false)).toBe("Resets in 2h");
    expect(countdown(7260, 0, false)).toBe("Resets in 2h 1m");
    expect(countdown(1, 0, false)).toBe("Resets in 1m");
    expect(countdown(3600, 0, true)).toBe("بازنشانی در ۱ ساعت");
    expect(countdown(60, 0, true)).toBe("بازنشانی در ۱ دقیقه");
  });
  it("reorders by ID and safely ignores stale targets", () => {
    expect(reorder(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
    expect(reorder(["a", "b"], "missing", "b")).toEqual(["a", "b"]);
  });
});

describe("parity regressions", () => {
  it("only uses main bucket for quota sorting", () => {
    const [a, b] = syntheticState().accounts;
    const extra = {
      ...a,
      snapshot: {
        rateLimitsByLimitId: {
          codex: { primary: { usedPercent: 10, windowDurationMins: 60 } },
          spark: { primary: { usedPercent: 99, windowDurationMins: 300 } },
        },
      },
    };
    expect(ordered([extra, b], "fiveHour").map((a) => a.id)).toEqual([
      b.id,
      extra.id,
    ]);
  });
  it("marks failed cached data stale immediately and uses interval plus grace", () => {
    const a = {
      ...syntheticState().accounts[0],
      updatedAt: 100,
      status: "connected" as const,
    };
    expect(isStale(a, 3, 400)).toBe(false);
    expect(isStale(a, 3, 401)).toBe(true);
    expect(isStale({ ...a, status: "failed" }, 3, 101)).toBe(true);
    expect(isStale({ ...a, status: "needsLogin" }, 3, 101)).toBe(true);
    expect(isStale({ ...a, status: "idle" }, 3, 101)).toBe(true);
  });
});

describe("reset credit deadline indicator", () => {
  it("uses the nearest available deadline even when credits are unsorted", () => {
    const snapshot = {
      rateLimitResetCredits: {
        availableCount: 2,
        credits: [
          { id: "later", status: "available", expiresAt: 500 },
          { id: "used", status: "redeemed", expiresAt: 100 },
          { id: "nearest", status: "available", expiresAt: 300 },
        ],
      },
    };
    expect(nextResetCreditExpiry(snapshot)).toBe(300);
    expect(
      nextResetCreditExpiry({
        rateLimitResetCredits: {
          ...snapshot.rateLimitResetCredits,
          availableCount: 0,
        },
      }),
    ).toBeNull();
  });
  it("does not manufacture deadlines from missing or invalid timestamps", () => {
    expect(nextResetCreditExpiry(null)).toBeNull();
    expect(
      nextResetCreditExpiry({
        rateLimitResetCredits: {
          availableCount: 3,
          credits: [
            { id: "a" },
            { id: "b", expiresAt: NaN },
            { id: "c", expiresAt: -1 },
          ],
        },
      }),
    ).toBeNull();
  });
});
