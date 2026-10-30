import { describe, expect, it } from "vitest";
import { dateInput, dateLocale, parseDateInput } from "./dates";
describe("calendar dates", () => {
  it("defaults to Persian independently of language", () => {
    expect(dateLocale(false)).toBe("en-US-u-ca-persian");
    expect(dateLocale(true, "gregory")).toBe("fa-IR-u-ca-gregory");
  });
  it("converts the Persian new year to the same local timestamp", () => {
    const timestamp = new Date(2026, 2, 21, 14, 30).getTime() / 1000;
    expect(dateInput(timestamp, "persian")).toBe("1405-01-01T14:30");
    expect(parseDateInput("1405-01-01T14:30", "persian")).toBe(timestamp);
    expect(dateInput(timestamp, "gregory")).toBe("2026-03-21T14:30");
  });
  it("round-trips both calendars without shifting the stored date", () => {
    for (const calendar of ["persian", "gregory"] as const) {
      for (const date of [
        new Date(2024, 1, 29, 9, 45),
        new Date(2025, 11, 31, 0, 0),
      ]) {
        const timestamp = date.getTime() / 1000;
        expect(parseDateInput(dateInput(timestamp, calendar), calendar)).toBe(
          timestamp,
        );
      }
    }
  });
  it("rejects invalid dates rather than silently rolling into another month", () => {
    expect(parseDateInput("1405-07-31T12:00", "persian")).toBeNull();
    expect(parseDateInput("2026-02-30T12:00", "gregory")).toBeNull();
    expect(parseDateInput("1405-01-01T25:00", "persian")).toBeNull();
    expect(parseDateInput("", "persian")).toBeNull();
  });
});
