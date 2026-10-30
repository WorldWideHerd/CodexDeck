import { useEffect, useRef, type InputHTMLAttributes } from "react";
import { Input } from "./ui/input";
import {
  localizeDigits,
  normalizeDigits,
  numericInputError,
} from "@/lib/numbers";

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "min" | "max" | "step"
> & {
  fa: boolean;
  value: string;
  onValueChange: (value: string) => void;
  min?: number;
  max?: number;
  time?: boolean;
};
// Native number/time fields cannot display Persian digits consistently across webviews.
// Keep a localized text presentation and send normalized values to form state.
export function LocalizedNumberInput({
  fa,
  value,
  onValueChange,
  min,
  max,
  time = false,
  ...props
}: Props) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.setCustomValidity(
      numericInputError(value, min, max, time)
        ? time
          ? fa
            ? "ساعت معتبر با قالب ۰۰:۰۰ وارد کنید."
            : "Enter a valid time in HH:MM format."
          : fa
            ? `یک عدد صحیح بین ${localizeDigits(String(min ?? 0), true)} و ${localizeDigits(String(max ?? 9999), true)} وارد کنید.`
            : `Enter a whole number between ${min ?? 0} and ${max ?? 9999}.`
        : "",
    );
  }, [value, min, max, time, fa]);
  return (
    <Input
      {...props}
      ref={ref}
      type="text"
      dir="ltr"
      inputMode={time ? "text" : "numeric"}
      value={localizeDigits(value, fa)}
      onChange={(event) => {
        const normalized = normalizeDigits(event.target.value);
        if ((time ? /^[0-9:]*$/ : /^\d*$/).test(normalized))
          onValueChange(normalized);
      }}
    />
  );
}
