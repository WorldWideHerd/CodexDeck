export type Calendar = "persian" | "gregory";
export function dateLocale(fa: boolean, calendar: Calendar = "persian") {
  return `${fa ? "fa-IR" : "en-US"}-u-ca-${calendar}`;
}
// Editing uses calendar dates in local time; storage always remains Unix seconds.
export function dateInput(
  timestamp: number | null,
  calendar: Calendar,
): string {
  if (timestamp === null) return "";
  const d = new Date(timestamp * 1000);
  const parts = new Intl.DateTimeFormat(`en-US-u-ca-${calendar}-nu-latn`, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (key: string) => parts.find((p) => p.type === key)!.value;
  return `${get("year")}-${get("month")}-${get("day")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
export function parseDateInput(
  value: string,
  calendar: Calendar,
): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (
    year < 1000 ||
    year > 3000 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59
  )
    return null;
  let d: Date;
  if (calendar === "gregory") d = new Date(year, month - 1, day, hour, minute);
  else {
    const fmt = new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      timeZone: "UTC",
    });
    let low = Math.floor(Date.UTC(year + 620, 0, 1) / 86400000);
    let high = Math.floor(Date.UTC(year + 623, 0, 1) / 86400000);
    const target = year * 10000 + month * 100 + day;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const parts = fmt.formatToParts(new Date(mid * 86400000));
      const n = (key: string) =>
        Number(parts.find((p) => p.type === key)!.value);
      if (n("year") * 10000 + n("month") * 100 + n("day") < target)
        low = mid + 1;
      else high = mid;
    }
    const utc = new Date(low * 86400000);
    d = new Date(
      utc.getUTCFullYear(),
      utc.getUTCMonth(),
      utc.getUTCDate(),
      hour,
      minute,
    );
  }
  const result = d.getTime() / 1000;
  return dateInput(result, calendar) === value ? result : null;
}
