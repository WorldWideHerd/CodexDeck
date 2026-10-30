import { native } from "@/lib/bridge";
import { CalendarDateField } from "./calendar-date-field";
import { dateInput, parseDateInput, type Calendar } from "@/lib/dates";
import { useId, useState, type FormEvent } from "react";
import { localizeDigits } from "@/lib/numbers";
import "./account-popovers.css";
import {
  CalendarDays,
  ChevronDown,
  LoaderCircle,
  Plus,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Account } from "@/lib/types";
export function AccountForm({
  account,
  busy,
  fa,
  calendar = "persian",
  submit,
}: {
  account: Account | null;
  busy: boolean;
  fa: boolean;
  calendar?: Calendar;
  submit: (
    label: string,
    workspaceId: string,
    subscriptionEndsAt: number | null,
  ) => Promise<void>;
}) {
  const t = (f: string, e: string) => (fa ? f : e);
  const [label, setLabel] = useState(account?.label ?? ""),
    [workspace, setWorkspace] = useState(""),
    [end, setEnd] = useState(
      dateInput(account?.subscriptionEndsAt ?? null, calendar),
    );
  const [dateError, setDateError] = useState(false);
  const [dateExpanded, setDateExpanded] = useState(false);
  const datePanelId = useId();
  function save(e: FormEvent) {
    e.preventDefault();
    const timestamp = end ? parseDateInput(end, calendar) : null;
    setDateError(!!end && timestamp === null);
    if (end && timestamp === null) {
      setDateExpanded(true);
      return;
    }
    void submit(label.trim(), workspace.trim(), timestamp);
  }
  return (
    <form onSubmit={save} className="account-form">
      <label>
        {t("نام دلخواه", "Account name")}
        <Input
          autoFocus
          required
          maxLength={80}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t("مثلاً: حساب شخصی", "e.g. Personal account")}
        />
      </label>
      {!account ? (
        <label>
          {t("شناسه فضای کار (اختیاری)", "Workspace ID (optional)")}
          <Input
            value={workspace}
            maxLength={200}
            onChange={(e) => setWorkspace(e.target.value)}
            dir="ltr"
          />
          <small>
            {t(
              "در صورت نیاز به اتصال به فضای کار مشخص، شناسه را وارد کنید.",
              "Use this when connecting a specific workspace.",
            )}
          </small>
        </label>
      ) : (
        <>
          <div className="subscription-date-section">
            <button
              type="button"
              className="subscription-date-toggle"
              aria-expanded={dateExpanded}
              aria-controls={datePanelId}
              disabled={busy}
              onClick={() => setDateExpanded((expanded) => !expanded)}
            >
              <CalendarDays aria-hidden="true" />
              <span>{t("پایان اشتراک", "Subscription end")}</span>
              <small>
                {end
                  ? localizeDigits(end.split("T")[0].replaceAll("-", "/"), fa)
                  : t("تنظیم تاریخ", "Set date")}
              </small>
              <ChevronDown aria-hidden="true" className="date-chevron" />
            </button>
            <div id={datePanelId} hidden={!dateExpanded}>
              {dateExpanded && (
                <CalendarDateField
                  value={end}
                  onChange={(v) => {
                    setEnd(v);
                    setDateError(false);
                  }}
                  calendar={calendar}
                  fa={fa}
                  disabled={busy}
                />
              )}
              {dateError && (
                <p role="alert" className="account-error">
                  {t(
                    "تاریخ معتبر وارد کنید؛ تعداد روزهای ماه را بررسی کنید.",
                    "Enter a valid date; check the number of days in the month.",
                  )}
                </p>
              )}
            </div>
          </div>
        </>
      )}
      <Button type="submit" disabled={!native || busy || !label.trim()}>
        {busy ? (
          <LoaderCircle className="spin" />
        ) : account ? (
          <Save />
        ) : (
          <Plus />
        )}
        {account
          ? t("ذخیره تغییرات", "Save changes")
          : t("افزودن حساب", "Add account")}
      </Button>
    </form>
  );
}
