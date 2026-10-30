import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { normalizeDigits, localizeDigits, numericInputError } from "./numbers";
import { LocalizedNumberInput } from "@/components/localized-number-input";

describe("localized numeric presentation", () => {
  it("accepts Persian, Arabic and Latin input as the same stored value", () => {
    expect(normalizeDigits("۱۲٣۴۵٦۷۸۹۰")).toBe("1234567890");
    expect(normalizeDigits("۱۴:۳۰")).toBe("14:30");
    expect(localizeDigits("1405-08-07 14:30", true)).toBe("۱۴۰۵-۰۸-۰۷ ۱۴:۳۰");
    expect(localizeDigits("۱۴:۳۰", false)).toBe("14:30");
  });
  it("shows Persian digits in editable fields, including Gregorian years and time", () => {
    for (const value of ["2026", "1405", "20", "14:30"]) {
      const html = renderToStaticMarkup(
        <LocalizedNumberInput
          fa
          value={value}
          time={value.includes(":")}
          onValueChange={() => {}}
        />,
      );
      expect(html).toContain(`value="${localizeDigits(value, true)}"`);
      expect(html).not.toContain(`value="${value}"`);
    }
  });
  it("preserves integer bounds and time validation with text presentation", () => {
    expect(numericInputError("0", 1, 100)).toBe(true);
    expect(numericInputError("101", 1, 100)).toBe(true);
    expect(numericInputError("1.5", 1, 100)).toBe(true);
    expect(numericInputError("20", 1, 100)).toBe(false);
    expect(numericInputError("", 1, 100)).toBe(false);
    expect(numericInputError("24:30", undefined, undefined, true)).toBe(true);
    expect(numericInputError("23:60", undefined, undefined, true)).toBe(true);
    expect(numericInputError("23:59", undefined, undefined, true)).toBe(false);
  });
});
