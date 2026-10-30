import { CalendarDays, Gift, Pencil, Wallet } from "lucide-react";
import {
  buckets,
  countdown,
  deadline,
  nextResetCreditExpiry,
} from "@/lib/usage";
import { dateLocale } from "@/lib/dates";
import { localizeDigits } from "@/lib/numbers";
import type { Account, Settings } from "@/lib/types";
import { Button } from "./ui/button";

export function AccountDetails({
  account,
  settings,
  now,
  fa,
  num,
  date,
  canEdit,
  onEdit,
  section = "all",
}: {
  section?: "all" | "resets" | "subscription" | "limits";
  account: Account;
  settings: Settings;
  now: number;
  fa: boolean;
  num: (value: number) => string;
  date: (value: number) => string;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const t = (f: string, e: string) => (fa ? f : e);
  const groups = buckets(account.snapshot);
  const credits = account.snapshot?.rateLimitResetCredits;
  const expiry = nextResetCreditExpiry(account.snapshot);
  const urgency = deadline(expiry, now);
  return (
    <div className="account-detail-sections">
      {(section === "all" || section === "limits") &&
        groups
          .filter(
            ([, b]) => b.individualLimit?.remainingPercent != null || b.credits,
          )
          .map(([id, bucket]) => (
            <section className="account-detail-section" key={id}>
              <h4>
                <Wallet size={15} aria-hidden="true" />
                <span dir="auto">
                  {bucket.limitName ??
                    (groups.length > 1
                      ? id
                      : t("اعتبار و سهمیه", "Credits & limits"))}
                </span>
              </h4>
              <dl className="account-detail-values">
                {bucket.individualLimit?.remainingPercent != null && (
                  <div>
                    <dt>{t("سهمیه فردی", "Individual limit")}</dt>
                    <dd>
                      <bdi>
                        {num(bucket.individualLimit.remainingPercent)}
                        {fa ? "٪" : "%"}
                      </bdi>
                      <small>
                        {countdown(bucket.individualLimit.resetsAt, now, fa)}
                      </small>
                    </dd>
                  </div>
                )}
                {bucket.credits && (
                  <div>
                    <dt>{t("اعتبار", "Credits")}</dt>
                    <dd>
                      {bucket.credits.unlimited
                        ? t("نامحدود", "Unlimited")
                        : localizeDigits(
                            bucket.credits.balance ?? t("نامشخص", "Unknown"),
                            fa,
                          )}
                    </dd>
                  </div>
                )}
              </dl>
            </section>
          ))}
      {(section === "all" || section === "resets") && (
        <section className="account-detail-section">
          <h4>
            <Gift size={15} />
            <span>{t("ریست هدیه", "Reset credits")}</span>
            <span
              className="detail-count"
              aria-label={t("هدیه‌های در دسترس", "Available reset credits")}
            >
              {credits?.availableCount == null
                ? t("نامشخص", "Unknown")
                : num(credits.availableCount)}
            </span>
          </h4>
          {expiry && (
            <p className={`detail-expiry ${urgency}`} title={date(expiry)}>
              {urgency === "expired"
                ? t("مهلت گذشته", "Deadline passed")
                : countdown(expiry, now, fa)
                    .replace("بازنشانی در", "مهلت:")
                    .replace("Resets in", "Expires in")}
            </p>
          )}
          {expiry != null && (
            <small className="detail-note">
              {t("نزدیک‌ترین انقضا", "Next expiry")}: {date(expiry)}
            </small>
          )}
          {!credits?.credits?.length && (
            <p className="detail-empty">
              {t(
                "جزئیات هدیه‌ها گزارش نشده است.",
                "Credit details have not been reported.",
              )}
            </p>
          )}
          {!!credits?.credits?.length && (
            <ul className="reset-credit-list">
              {credits?.credits?.map((c) => (
                <li key={c.id}>
                  <strong dir="auto">
                    {localizeDigits(c.title ?? t("هدیه", "Credit"), fa)}
                  </strong>
                  {c.description && (
                    <p dir="auto">{localizeDigits(c.description, fa)}</p>
                  )}
                  <small
                    className={`detail-expiry ${deadline(c.expiresAt, now)}`}
                  >
                    {t("مهلت", "Expires")}:{" "}
                    {c.expiresAt ? date(c.expiresAt) : t("نامشخص", "Unknown")}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {(section === "all" || section === "subscription") && (
        <section className="account-detail-section subscription-detail">
          <div>
            <h4>
              <CalendarDays size={15} />
              {t("پایان اشتراک", "Subscription end")}
            </h4>
            <p
              className={`detail-expiry ${deadline(account.subscriptionEndsAt, now)}`}
              title={
                account.subscriptionEndsAt
                  ? date(account.subscriptionEndsAt)
                  : undefined
              }
            >
              {account.subscriptionEndsAt
                ? new Date(
                    account.subscriptionEndsAt * 1000,
                  ).toLocaleDateString(dateLocale(fa, settings.calendar), {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })
                : t("تاریخ ثبت نشده", "No date set")}
            </p>
            <small className="detail-note">
              {t(
                "این تاریخ دستی ثبت می‌شود.",
                "This date is entered manually.",
              )}
            </small>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!canEdit}
            onClick={onEdit}
          >
            <Pencil size={13} />
            {account.subscriptionEndsAt
              ? t("ویرایش", "Edit")
              : t("افزودن", "Add")}
          </Button>
        </section>
      )}
    </div>
  );
}
