import { useState } from "react";
import type { Calendar } from "@/lib/dates";
import { LocalizedNumberInput } from "./localized-number-input";
import { localizeDigits } from "@/lib/numbers";
import { Button } from "./ui/button";
export function CalendarDateField({
  value,
  onChange,
  calendar,
  fa,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  calendar: Calendar;
  fa: boolean;
  disabled?: boolean;
}) {
  const [parts, setParts] = useState(() => {
    const [date, time] = value.split("T");
    const [year = "", month = "", day = ""] = date.split("-");
    return { year, month, day, time: time || "00:00" };
  });
  const months =
    calendar === "persian"
      ? fa
        ? [
            "فروردین",
            "اردیبهشت",
            "خرداد",
            "تیر",
            "مرداد",
            "شهریور",
            "مهر",
            "آبان",
            "آذر",
            "دی",
            "بهمن",
            "اسفند",
          ]
        : [
            "Farvardin",
            "Ordibehesht",
            "Khordad",
            "Tir",
            "Mordad",
            "Shahrivar",
            "Mehr",
            "Aban",
            "Azar",
            "Dey",
            "Bahman",
            "Esfand",
          ]
      : fa
        ? [
            "ژانویه",
            "فوریه",
            "مارس",
            "آوریل",
            "مه",
            "ژوئن",
            "ژوئیه",
            "اوت",
            "سپتامبر",
            "اکتبر",
            "نوامبر",
            "دسامبر",
          ]
        : [
            "January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
            "November",
            "December",
          ];
  function change(key: keyof typeof parts, v: string) {
    const next = { ...parts, [key]: v };
    setParts(next);
    onChange(
      !next.year && !next.month && !next.day
        ? ""
        : `${next.year}-${next.month.padStart(2, "0")}-${next.day.padStart(2, "0")}T${next.time}`,
    );
  }
  return (
    <fieldset className="calendar-date-field" disabled={disabled}>
      <legend>
        {fa
          ? `پایان اشتراک · ${calendar === "persian" ? "شمسی" : "میلادی"}`
          : `Subscription end · ${calendar === "persian" ? "Persian" : "Gregorian"}`}
      </legend>
      <div className="date-parts">
        <label>
          {fa ? "سال" : "Year"}
          <LocalizedNumberInput
            fa={fa}
            dir="ltr"
            min={1000}
            max={3000}
            required={!!value}
            value={parts.year}
            placeholder={localizeDigits(
              calendar === "persian" ? "1405" : "2026",
              fa,
            )}
            onValueChange={(value) => change("year", value)}
          />
        </label>
        <label>
          {fa ? "ماه" : "Month"}
          <select
            required={!!value}
            value={Number(parts.month) || ""}
            onChange={(e) => change("month", e.target.value)}
          >
            <option value="">—</option>
            {months.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label>
          {fa ? "روز" : "Day"}
          <LocalizedNumberInput
            fa={fa}
            dir="ltr"
            min={1}
            max={31}
            required={!!value}
            value={parts.day}
            placeholder="—"
            onValueChange={(value) => change("day", value)}
          />
        </label>
      </div>
      <div className="date-time">
        <label>
          {fa ? "ساعت محلی" : "Local time"}
          <LocalizedNumberInput
            fa={fa}
            time
            dir="ltr"
            required={!!value}
            value={parts.time}
            onValueChange={(value) => change("time", value)}
          />
        </label>
        <Button
          type="button"
          variant="ghost"
          disabled={!value}
          onClick={() => {
            setParts({ year: "", month: "", day: "", time: "00:00" });
            onChange("");
          }}
        >
          {fa ? "پاک‌کردن تاریخ" : "Clear date"}
        </Button>
      </div>
      <small>
        {fa
          ? "تاریخ اختیاری و دستی است؛ از زمان ریست سهمیه محاسبه نمی‌شود."
          : "Optional manual date, separate from quota resets."}
      </small>
    </fieldset>
  );
}
