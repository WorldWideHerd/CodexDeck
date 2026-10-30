import type { Account, UsageSnapshot, UsageWindow, Settings } from "./types";
export function buckets(snapshot: UsageSnapshot | null) {
  const map = snapshot?.rateLimitsByLimitId;
  if (map && Object.keys(map).length)
    return Object.entries(map).sort(([a], [b]) =>
      a === "codex" ? -1 : b === "codex" ? 1 : a.localeCompare(b),
    );
  return snapshot?.rateLimits
    ? [[snapshot.rateLimits.limitId ?? "codex", snapshot.rateLimits] as const]
    : [];
}
export function windows(snapshot: UsageSnapshot | null) {
  return buckets(snapshot).flatMap(([, b]) =>
    [b.primary, b.secondary].filter((w): w is UsageWindow => !!w),
  );
}
export function remaining(w: UsageWindow) {
  return Math.min(100, Math.max(0, 100 - w.usedPercent));
}
export function ordered(
  accounts: Account[],
  sort: Settings["sort"],
  now = Date.now() / 1000,
) {
  const value = (a: Account) =>
    sort === "reset"
      ? Math.min(
          ...windows(a.snapshot)
            .map((w) => w.resetsAt ?? Infinity)
            .filter((t) => t > now),
        )
      : remainingOrUnknown(a, sort === "fiveHour" ? 300 : 10080);
  return sort === "manual"
    ? accounts
    : [...accounts].sort((a, b) => value(a) - value(b));
}
function remainingOrUnknown(a: Account, duration: number) {
  const main = buckets(a.snapshot)[0]?.[1];
  const w = [main?.primary, main?.secondary].find(
    (w) => w?.windowDurationMins === duration,
  );
  return w ? remaining(w) : Infinity;
}
export function reorder(ids: string[], source: string, target: string) {
  const result = [...ids];
  const from = result.indexOf(source),
    to = result.indexOf(target);
  if (from < 0 || to < 0) return result;
  result.splice(to, 0, result.splice(from, 1)[0]);
  return result;
}
export function countdown(
  timestamp: number | null | undefined,
  now: number,
  fa: boolean,
) {
  if (!timestamp) return fa ? "زمان بازنشانی نامشخص" : "Reset time unknown";
  const minutes = Math.ceil((timestamp - now) / 60);
  if (minutes <= 0)
    return fa ? "منتظر تأیید بازنشانی" : "Awaiting reset confirmation";
  const d = Math.floor(minutes / 1440),
    h = Math.floor((minutes % 1440) / 60),
    m = minutes % 60;
  const n = (v: number) =>
    new Intl.NumberFormat(fa ? "fa-IR" : "en-US").format(v);
  const parts = d
    ? ([
        [d, "روز", "d"],
        [h, "ساعت", "h"],
      ] as const)
    : h
      ? ([
          [h, "ساعت", "h"],
          [m, "دقیقه", "m"],
        ] as const)
      : ([[m, "دقیقه", "m"]] as const);
  const duration = parts
    .filter(([value]) => value > 0)
    .map(([value, persian, english]) =>
      fa ? `${n(value)} ${persian}` : `${value}${english}`,
    )
    .join(fa ? " و " : " ");
  return fa ? `بازنشانی در ${duration}` : `Resets in ${duration}`;
}

export function deadline(
  timestamp: number | null | undefined,
  now: number,
): "unknown" | "normal" | "soon" | "urgent" | "expired" {
  if (timestamp == null) return "unknown";
  const delta = timestamp - now;
  return delta <= 0
    ? "expired"
    : delta <= 86400
      ? "urgent"
      : delta <= 259200
        ? "soon"
        : "normal";
}

export function isStale(account: Account, refreshMinutes: number, now: number) {
  return (
    account.snapshot !== null &&
    (account.status === "failed" ||
      account.status === "needsLogin" ||
      account.status === "idle" ||
      account.updatedAt === null ||
      now - account.updatedAt > refreshMinutes * 60 + 120)
  );
}

export function nextResetCreditExpiry(
  snapshot: UsageSnapshot | null,
): number | null {
  const resets = snapshot?.rateLimitResetCredits;
  if (!resets || resets.availableCount === 0) return null;
  const expiries = (resets.credits ?? [])
    .filter((c) => !c.status || c.status.toLowerCase() === "available")
    .map((c) => c.expiresAt)
    .filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value) && value > 0,
    );
  return expiries.length ? Math.min(...expiries) : null;
}
