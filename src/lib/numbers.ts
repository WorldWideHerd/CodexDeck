export function normalizeDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code - (code >= 0x06f0 ? 0x06f0 : 0x0660));
  });
}
export function localizeDigits(value: string, fa: boolean): string {
  const normalized = normalizeDigits(value);
  return fa
    ? normalized.replace(/[0-9]/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)])
    : normalized;
}
export function numericInputError(
  value: string,
  min?: number,
  max?: number,
  time = false,
): boolean {
  if (!value) return false; // required is handled by the browser.
  if (time) return !/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  return (
    !/^\d+$/.test(value) ||
    (min !== undefined && Number(value) < min) ||
    (max !== undefined && Number(value) > max)
  );
}
