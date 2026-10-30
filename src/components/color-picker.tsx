import { useEffect, useState } from "react";
import { Check, Palette } from "lucide-react";
import { Input } from "./ui/input";
export const colors = ["#24b59b", "#7585f8", "#e8aa4d", "#e2799d", "#6ea9d9"];
export function ColorPicker({
  value,
  onChange,
  fa,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  fa: boolean;
  disabled?: boolean;
}) {
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  const names = fa
    ? ["سبز", "بنفش", "طلایی", "صورتی", "آبی"]
    : ["Green", "Violet", "Gold", "Pink", "Blue"];
  return (
    <fieldset className="account-color-field" disabled={disabled}>
      <legend>{fa ? "رنگ حساب" : "Account color"}</legend>
      <div className="color-presets">
        {colors.map((c, i) => (
          <button
            key={c}
            type="button"
            aria-label={names[i]}
            aria-pressed={value.toLowerCase() === c}
            style={{ background: c }}
            onClick={() => onChange(c)}
          >
            {value.toLowerCase() === c && <Check size={16} />}
          </button>
        ))}
      </div>
      <div className="custom-color-row">
        <label className="custom-color-control">
          <span
            className="custom-color-preview"
            style={{ background: value }}
          />
          <span>{fa ? "انتخاب رنگ دلخواه" : "Choose custom color"}</span>
          <Palette size={15} />
          <input
            type="color"
            aria-label={fa ? "انتخاب رنگ دلخواه" : "Choose custom color"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
        <Input
          aria-label={fa ? "کد رنگ HEX" : "HEX color code"}
          dir="ltr"
          value={hex}
          pattern="#[0-9a-fA-F]{6}"
          maxLength={7}
          required
          onChange={(e) => {
            setHex(e.target.value);
            if (/^#[0-9a-f]{6}$/i.test(e.target.value))
              onChange(e.target.value);
          }}
        />
      </div>
      <small>
        {fa
          ? "رنگ فقط برای شناسایی حساب استفاده می‌شود."
          : "Color helps you identify this account."}
      </small>
    </fieldset>
  );
}
