import { dateLocale, type Calendar } from "@/lib/dates";
import { ArrowRightLeft, Bell, ChevronDown, Gift } from "lucide-react";
import type { Account, PlatformCapabilities, UsageWindow } from "@/lib/types";
import { capabilityMessage } from "@/lib/presentation";
import {
  buckets,
  countdown,
  isStale,
  remaining,
  nextResetCreditExpiry,
  deadline,
} from "@/lib/usage";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import { bridge, native } from "@/lib/bridge";

export function AccountRow({
  a,
  now,
  fa,
  refreshMinutes,
  calendar,
  busy,
  expanded,
  detailsId,
  onDetails,
  onAlert,
  caps,
  run,
}: {
  a: Account;
  now: number;
  fa: boolean;
  refreshMinutes: number;
  calendar?: Calendar;
  busy: boolean;
  expanded: boolean;
  detailsId: string;
  onDetails: () => void;
  onAlert: (trigger: HTMLButtonElement) => void;
  caps: PlatformCapabilities;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
}) {
  const t = (f: string, e: string) => (fa ? f : e);
  const detailsLabel = `${expanded ? t("بستن جزئیات", "Close details") : t("نمایش جزئیات", "Show details")} ${a.label}`;
  const giftExpiry = nextResetCreditExpiry(a.snapshot);
  const giftUrgency = deadline(giftExpiry, now);
  const giftWarning = ["soon", "urgent", "expired"].includes(giftUrgency);
  const giftLabel =
    giftUrgency === "expired"
      ? t("مهلت هدیه گذشته", "Reset credit expired")
      : `${t("مهلت هدیه", "Reset credit expires")}: ${countdown(
          giftExpiry,
          now,
          fa,
        )
          .replace(/^بازنشانی در /, "")
          .replace(/^Resets in /, "")}`;
  const main = buckets(a.snapshot)[0]?.[1];
  const stale = isStale(a, refreshMinutes, now);
  const healthy = a.status === "connected" && !stale;
  const n = (v: number) =>
    new Intl.NumberFormat(fa ? "fa-IR" : "en-US", {
      maximumFractionDigits: 0,
    }).format(v);
  const status =
    a.status === "refreshing"
      ? t("در حال دریافت", "Refreshing")
      : a.status === "signingIn"
        ? t("منتظر ورود", "Signing in")
        : a.status === "needsLogin"
          ? t("نیاز به ورود", "Sign in required")
          : a.status === "failed"
            ? t("خطا در دریافت", "Refresh failed")
            : stale
              ? t("اطلاعات قدیمی", "Cached data")
              : a.status === "connected"
                ? t("متصل", "Connected")
                : t("وارد نشده", "Not signed in");
  function quota(duration: number, label: string) {
    const w: UsageWindow | undefined | null = [
      main?.primary,
      main?.secondary,
    ].find((w) => w?.windowDurationMins === duration);
    const value = w ? remaining(w) : null;
    const resetLabel = w
      ? countdown(w.resetsAt, now, fa)
      : t("اطلاعاتی دریافت نشده", "No usage data");
    return (
      <div className={`row-quota ${stale ? "is-cached" : ""}`}>
        <div>
          <span className="row-quota-label">{label}</span>
          <strong className={value !== null && value <= 10 ? "critical" : ""}>
            {value === null ? (
              "—"
            ) : (
              <>
                {`${n(value)}${fa ? "٪" : "%"}`}
                <small className="quota-remaining-label">
                  {t("باقی‌مانده", "left")}
                </small>
              </>
            )}
          </strong>
        </div>
        {value !== null ? (
          <Progress
            value={value}
            aria-label={`${a.label} · ${label}`}
            className={value <= 10 ? "danger" : value <= 30 ? "warning" : ""}
          />
        ) : (
          <div className="unknown-track" />
        )}
        <small
          aria-label={resetLabel}
          title={
            w?.resetsAt
              ? `${resetLabel} · ${new Date(w.resetsAt * 1000).toLocaleString(
                  dateLocale(fa, calendar),
                )}`
              : resetLabel
          }
        >
          {resetLabel.replace(/^بازنشانی در /, "").replace(/^Resets in /, "")}
        </small>
      </div>
    );
  }
  return (
    <div className="account-row">
      <button
        className="row-identity"
        title={detailsLabel}
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={onDetails}
      >
        <span className="row-avatar" aria-hidden="true">
          {a.label.slice(0, 1).toUpperCase()}
          <i className={`row-status-dot ${healthy ? "is-connected" : ""}`} />
        </span>
        <span className="row-name">
          <span className="row-name-line">
            <strong title={a.label}>
              <bdi>{a.label}</bdi>
            </strong>
            <span className="row-plan">
              <bdi>{a.plan ?? "—"}</bdi>
            </span>
            {giftWarning && (
              <span
                className={`row-gift-warning ${giftUrgency}`}
                title={giftLabel}
              >
                <Gift size={13} aria-hidden="true" />
                <span className="sr-only">{giftLabel}</span>
              </span>
            )}
          </span>
          <span className="row-email" title={a.email ?? undefined}>
            <bdi>{a.email ?? t("هنوز وارد نشده‌اید", "Not signed in yet")}</bdi>
          </span>
          <small
            className={`row-status ${healthy ? "sr-only" : ""} ${
              a.status === "failed" || a.status === "needsLogin"
                ? "needs-attention"
                : ""
            }`}
          >
            {status}
          </small>
        </span>
      </button>
      {quota(300, t("۵ ساعته", "5-hour"))}
      {quota(10080, t("هفتگی", "Weekly"))}
      <div className="row-actions">
        <Button
          variant="ghost"
          size="icon"
          className={`row-notification ${a.alertThreshold !== null ? "is-enabled" : ""}`}
          disabled={busy}
          aria-label={`${t("اعلان سهمیه", "Quota notifications")} ${a.label}`}
          aria-haspopup="dialog"
          title={
            a.alertThreshold !== null
              ? t(
                  `اعلان وقتی سهمیه کمتر از ${n(a.alertThreshold)}٪ شد`,
                  `Notify below ${n(a.alertThreshold)}% remaining`,
                )
              : t("تنظیم اعلان سهمیه", "Configure quota notifications")
          }
          onClick={(event) => onAlert(event.currentTarget)}
        >
          <Bell />
          {a.alertThreshold !== null && <i aria-hidden="true" />}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="row-use-codex"
          disabled={
            !native || busy || !caps.desktopSwitch || a.status !== "connected"
          }
          title={capabilityMessage(caps, fa)}
          aria-label={`${t("استفاده در Codex", "Use in Codex")} · ${a.label}`}
          onClick={() => void run(() => bridge.switch(a.id))}
        >
          <ArrowRightLeft />
          <span>{t("استفاده در Codex", "Use in Codex")}</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={detailsLabel}
          title={detailsLabel}
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={onDetails}
        >
          <ChevronDown className={expanded ? "expanded-chevron" : ""} />
        </Button>
      </div>
    </div>
  );
}
