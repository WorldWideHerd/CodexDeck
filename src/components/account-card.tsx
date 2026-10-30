import { useManualRefresh } from "@/hooks/use-quiet-feedback";
import { AccountInfoPopover } from "./account-info-popover";
import { dateLocale } from "@/lib/dates";
import { LocalizedNumberInput } from "./localized-number-input";
import { ColorPicker, colors } from "./color-picker";
import { AccountRow } from "./account-row";
import { useEffect, useId, useState } from "react";
import { PopupMenu } from "./ui/popup-menu";
import "./account-popovers.css";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import {
  errorCode,
  type ErrorCode,
  presentError,
  capabilityMessage,
} from "@/lib/presentation";
import {
  ArrowRightLeft,
  Activity,
  SlidersHorizontal,
  Palette,
  CircleUserRound,
  Check,
  Bell,
  ChevronDown,
  RefreshCw,
  ArrowDown,
  ArrowUp,
  Gift,
  CalendarDays,
  LogIn,
  MoreHorizontal,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { bridge, native } from "@/lib/bridge";
import {
  buckets,
  countdown,
  remaining,
  deadline,
  nextResetCreditExpiry,
} from "@/lib/usage";
import type {
  Account,
  Settings,
  PlatformCapabilities,
  UsageWindow,
} from "@/lib/types";
interface Props {
  exiting?: boolean;
  entering?: boolean;
  expanded?: boolean;
  onExpandedChange?: () => void;
  a: Account;
  index: number;
  accounts: Account[];
  settings: Settings;
  caps: PlatformCapabilities;
  busy: boolean;
  now: number;
  fa: boolean;
  t: (fa: string, en: string) => string;
  num: (n: number) => string;
  date: (n: number) => string;
  move: (source: string, target: string) => Promise<void>;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  setEditor: (a: Account) => void;
  setDeleting: (a: Account) => void;
  startLogin: (a: Account) => Promise<void>;
  cancelLogin: (accountId: string) => Promise<void>;
}
export function AccountCard({
  exiting = false,
  entering = false,
  expanded: controlledExpanded,
  onExpandedChange,
  a,
  index,
  accounts,
  settings,
  caps,
  busy,
  now,
  fa,
  t,
  num,
  date,
  move,
  run,
  setEditor,
  setDeleting,
  startLogin,
  cancelLogin,
}: Props) {
  const manualRefresh = useManualRefresh([a], run, a.id);
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = controlledExpanded ?? localExpanded;
  const [disclosureSettled, setDisclosureSettled] = useState(false);
  useEffect(() => {
    setDisclosureSettled(false);
    if (!expanded) setMenuOpen(false);
  }, [expanded]);
  const detailsId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const detailBuckets = buckets(a.snapshot)
    .map(
      ([id, bucket], index) =>
        [
          id,
          settings.layout === "list" && index === 0
            ? {
                ...bucket,
                primary: [300, 10080].includes(
                  bucket.primary?.windowDurationMins ?? 0,
                )
                  ? null
                  : bucket.primary,
                secondary: [300, 10080].includes(
                  bucket.secondary?.windowDurationMins ?? 0,
                )
                  ? null
                  : bucket.secondary,
              }
            : bucket,
        ] as const,
    )
    .filter(([, bucket]) => bucket.primary || bucket.secondary);
  const hasQuotaWindows = buckets(a.snapshot).some(
    ([, bucket]) => bucket.primary || bucket.secondary,
  );
  const needsSignIn = ["idle", "needsLogin", "signingIn"].includes(a.status);
  const receivingUsage = a.status === "refreshing";
  const signingIn = a.status === "signingIn";
  const subscriptionUrgency = deadline(a.subscriptionEndsAt, now);
  const resetCount = a.snapshot?.rateLimitResetCredits?.availableCount;
  const giftExpiry = nextResetCreditExpiry(a.snapshot);
  const giftUrgency = deadline(giftExpiry, now);
  const giftWarning = ["soon", "urgent", "expired"].includes(giftUrgency);
  const hasAdditionalDetails = buckets(a.snapshot).some(
    ([, bucket]) =>
      bucket.individualLimit?.remainingPercent != null || !!bucket.credits,
  );
  const infoProps = {
    active: settings.layout !== "list" || expanded,
    account: a,
    settings,
    now,
    fa,
    num,
    date,
    canEdit: native && !busy,
    onEdit: () => setEditor(a),
    onOpen: closeMenu,
  };
  const [quickEditor, setQuickEditor] = useState<"color" | "alert" | null>(
    null,
  );
  const [quickColor, setQuickColor] = useState(a.color ?? colors[0]);
  const [alertEnabled, setAlertEnabled] = useState(a.alertThreshold !== null);
  const [quickAlert, setQuickAlert] = useState(
    a.alertThreshold?.toString() ?? "",
  );
  const [quickError, setQuickError] = useState<ErrorCode | null>(null);
  function closeMenu() {
    setMenuOpen(false);
  }
  function openQuick(mode: "color" | "alert") {
    closeMenu();
    setQuickError(null);
    setQuickColor(a.color ?? colors[0]);
    setQuickAlert(a.alertThreshold?.toString() ?? "20");
    setAlertEnabled(a.alertThreshold !== null);
    setQuickEditor(mode);
  }
  function quota(w: UsageWindow, key: string) {
    const r = remaining(w),
      expired = !!w.resetsAt && w.resetsAt <= now;
    const duration = w.windowDurationMins;
    const label =
      duration === 300
        ? t("۵ ساعته", "5-hour")
        : duration === 10080
          ? t("هفتگی", "Weekly")
          : duration
            ? t(`${num(duration)} دقیقه‌ای`, `${num(duration)}-minute`)
            : t("سهمیه", "Quota");
    return (
      <div className="quota" key={key}>
        <div className="quota-title">
          <span className="quota-label">
            {label}
            {duration === 300 && (
              <Button
                variant="ghost"
                size="icon"
                className={a.alertThreshold !== null ? "alert-enabled" : ""}
                aria-label={t("تنظیم هشدار سهمیه", "Configure quota alert")}
                title={
                  a.alertThreshold !== null
                    ? t(
                        `هشدار وقتی سهمیه کمتر از ${num(a.alertThreshold)}٪ شد`,
                        `Alert when remaining quota falls below ${num(a.alertThreshold)}%`,
                      )
                    : t("تنظیم هشدار", "Configure alert")
                }
                disabled={!native || busy}
                onClick={() => openQuick("alert")}
              >
                <Bell
                  size={14}
                  fill={a.alertThreshold !== null ? "currentColor" : "none"}
                />
              </Button>
            )}
          </span>
          <strong className={r <= 10 ? "critical" : ""}>
            <span>
              {num(r)}
              {fa ? "٪" : "%"}
            </span>
            <small>{t("باقی‌مانده", "left")}</small>
          </strong>
        </div>
        <Progress
          value={r}
          aria-label={label}
          className={r <= 10 ? "danger" : r <= 30 ? "warning" : ""}
        />
        <div className="quota-meta">
          <span title={w.resetsAt ? date(w.resetsAt) : undefined}>
            {countdown(w.resetsAt, now, fa)}
          </span>
          {expired && <TriangleAlert size={13} />}
        </div>
      </div>
    );
  }
  return (
    <>
      <Card
        className={`account ${expanded ? "is-expanded" : ""}`}
        key={a.id}
        style={
          {
            "--account-color": /^#[0-9a-f]{6}$/i.test(a.color ?? "")
              ? a.color
              : colors[index % colors.length],
          } as React.CSSProperties
        }
        data-account-id={a.id}
        data-exiting={exiting || undefined}
        data-entering={entering || undefined}
        inert={exiting || undefined}
        aria-hidden={exiting || undefined}
      >
        {settings.layout === "list" && (
          <AccountRow
            a={a}
            now={now}
            fa={fa}
            refreshMinutes={settings.refreshMinutes}
            calendar={settings.calendar}
            busy={busy}
            expanded={expanded}
            detailsId={detailsId}
            onDetails={onExpandedChange ?? (() => setLocalExpanded(!expanded))}
            onAlert={() => openQuick("alert")}
            caps={caps}
            run={run}
          />
        )}
        <div
          id={detailsId}
          className={
            settings.layout === "list" ? "account-disclosure" : undefined
          }
          data-state={expanded ? "open" : "closed"}
          data-settled={expanded && disclosureSettled}
          onTransitionEnd={(event) => {
            if (
              event.target === event.currentTarget &&
              event.propertyName === "grid-template-rows"
            )
              setDisclosureSettled(expanded);
          }}
          role={settings.layout === "list" ? "region" : undefined}
          aria-label={
            settings.layout === "list"
              ? `${t("جزئیات", "Details")} ${a.label}`
              : undefined
          }
          aria-hidden={
            settings.layout === "list" && !expanded ? true : undefined
          }
          inert={settings.layout === "list" && !expanded ? true : undefined}
        >
          <div
            className={
              settings.layout === "list"
                ? "account-disclosure-clip"
                : "contents"
            }
          >
            <CardContent className="account-content">
              <div className="account-header">
                {settings.layout === "list" && (
                  <h3 className="list-details-title">
                    {t("جزئیات", "Details")} <bdi>{a.label}</bdi>
                  </h3>
                )}
                <button
                  type="button"
                  className="account-avatar"
                  disabled={!native || busy}
                  aria-label={t("تغییر رنگ اکانت", "Change account color")}
                  onClick={() => openQuick("color")}
                >
                  {a.label.slice(0, 1).toUpperCase()}
                </button>
                <div className="account-identity">
                  <div className="account-name-line">
                    <h3 dir="auto" title={a.label}>
                      {a.label}
                    </h3>
                    <Badge className="plan-badge" variant="secondary">
                      {a.plan ?? t("طرح نامشخص", "Unknown plan")}
                    </Badge>
                  </div>
                  <span dir="ltr" title={a.email ?? undefined}>
                    {a.email ?? t("هنوز وارد نشده‌اید", "Not signed in yet")}
                  </span>
                </div>
                <PopupMenu
                  className="account-menu"
                  contentClassName="account-action-popover"
                  open={menuOpen}
                  onOpenChange={setMenuOpen}
                  label={t("عملیات حساب", "Account actions")}
                  trigger={<MoreHorizontal size={18} />}
                >
                  <div className="popover-heading">{a.label}</div>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => openQuick("alert")}
                  >
                    <Bell />
                    {t("تنظیم هشدار", "Set quota alert")}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      closeMenu();
                      setEditor(a);
                    }}
                  >
                    <SlidersHorizontal />
                    {t("ویرایش", "Edit")}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => openQuick("color")}
                  >
                    <Palette />
                    {t("رنگ کارت", "Card color")}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={!native || busy}
                    onClick={() => {
                      closeMenu();
                      void manualRefresh.refresh();
                    }}
                  >
                    <RefreshCw />
                    {t("تازه‌سازی", "Refresh")}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={!native || busy || a.status === "signingIn"}
                    onClick={() => {
                      closeMenu();
                      void startLogin(a);
                    }}
                  >
                    <CircleUserRound />
                    {t("ورود مجدد", "Sign in again")}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={
                      !native ||
                      busy ||
                      !caps.desktopSwitch ||
                      a.status !== "connected"
                    }
                    title={capabilityMessage(caps, fa)}
                    onClick={() => {
                      closeMenu();
                      void run(() => bridge.switch(a.id));
                    }}
                  >
                    <RefreshCw />
                    {t("استفاده در Codex", "Use in Codex")}
                  </Button>
                  {settings.sort === "manual" && (
                    <>
                      <div className="popover-divider" />
                      <Button
                        variant="ghost"
                        disabled={!native || busy || index === 0}
                        onClick={() => {
                          closeMenu();
                          void move(a.id, accounts[index - 1].id);
                        }}
                      >
                        <ArrowUp />
                        {t("انتقال به بالا", "Move up")}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={
                          !native || busy || index === accounts.length - 1
                        }
                        onClick={() => {
                          closeMenu();
                          void move(a.id, accounts[index + 1].id);
                        }}
                      >
                        <ArrowDown />
                        {t("انتقال به پایین", "Move down")}
                      </Button>
                    </>
                  )}
                  <div className="popover-divider" />
                  <Button
                    variant="ghost"
                    className="remove-connection"
                    disabled={!native || busy}
                    onClick={() => {
                      closeMenu();
                      setDeleting(a);
                    }}
                  >
                    <Trash2 />
                    {t("حذف اتصال…", "Remove connection…")}
                  </Button>
                </PopupMenu>
              </div>
              <div className="account-status-area">
                <div className="account-tags">
                  <span className={`status ${a.status}`}>
                    <i />
                    {
                      {
                        idle: t("آماده اتصال", "Ready to connect"),
                        connected: t("متصل", "Connected"),
                        refreshing: t("در حال دریافت", "Refreshing"),
                        signingIn: t("منتظر ورود", "Signing in"),
                        needsLogin: t("نیاز به ورود", "Sign in required"),
                        failed: t("خطای اتصال", "Connection failed"),
                      }[a.status]
                    }
                  </span>
                </div>
              </div>
              <div
                className="account-quotas"
                hidden={
                  settings.layout === "list" &&
                  detailBuckets.length === 0 &&
                  !!a.snapshot
                }
              >
                {detailBuckets.map(([id, b]) => (
                  <section key={id} className="bucket">
                    {(buckets(a.snapshot).length > 1 || id !== "codex") && (
                      <div className="bucket-label">{b.limitName ?? id}</div>
                    )}
                    {[b.primary, b.secondary]
                      .filter((w): w is UsageWindow => !!w)
                      .map((w, i) => quota(w, `${id}-${i}`))}
                  </section>
                ))}
                {!hasQuotaWindows && (
                  <div className="no-usage">
                    <Activity size={23} aria-hidden="true" />
                    <p role="status">
                      {receivingUsage
                        ? t(
                            "در حال دریافت اطلاعات سهمیه…",
                            "Receiving usage data…",
                          )
                        : signingIn
                          ? t(
                              "در انتظار تکمیل ورود…",
                              "Waiting for sign-in to finish…",
                            )
                          : needsSignIn
                            ? t(
                                "پس از ورود، مصرف واقعی نمایش داده می‌شود.",
                                "Real usage appears after sign-in.",
                              )
                            : t(
                                "اطلاعات سهمیه هنوز گزارش نشده است.",
                                "Usage data has not been reported yet.",
                              )}
                    </p>
                    <Button
                      variant="outline"
                      disabled={!native || busy || signingIn || receivingUsage}
                      onClick={() =>
                        needsSignIn
                          ? void startLogin(a)
                          : void manualRefresh.refresh()
                      }
                    >
                      {needsSignIn ? (
                        <LogIn />
                      ) : (
                        <RefreshCw
                          className={receivingUsage ? "spin" : undefined}
                        />
                      )}
                      {signingIn
                        ? t("در انتظار ورود", "Signing in")
                        : needsSignIn
                          ? t("ورود به حساب", "Sign in")
                          : receivingUsage
                            ? t("در حال دریافت", "Receiving")
                            : t("دریافت سهمیه", "Refresh usage")}
                    </Button>
                  </div>
                )}
              </div>
              <div className="card-subscription-summary">
                <AccountInfoPopover {...infoProps} section="subscription">
                  <button
                    type="button"
                    className={`card-summary-trigger card-subscription-end ${subscriptionUrgency}`}
                    title={
                      a.subscriptionEndsAt != null
                        ? date(a.subscriptionEndsAt)
                        : undefined
                    }
                  >
                    <span className="card-summary-label">
                      <CalendarDays size={14} aria-hidden="true" />
                      {t("پایان اشتراک", "Subscription end")}
                      <ChevronDown
                        size={12}
                        className="card-summary-chevron"
                        aria-hidden="true"
                      />
                    </span>
                    <span className="card-summary-value">
                      <bdi>
                        {a.subscriptionEndsAt != null
                          ? new Date(
                              a.subscriptionEndsAt * 1000,
                            ).toLocaleDateString(
                              dateLocale(fa, settings.calendar),
                              {
                                year: "numeric",
                                month: "2-digit",
                                day: "2-digit",
                              },
                            )
                          : t("ثبت نشده", "Not set")}
                      </bdi>
                    </span>
                    <small>
                      {subscriptionUrgency === "expired"
                        ? t("پایان یافته · ثبت دستی", "Ended · Manual")
                        : subscriptionUrgency === "urgent" ||
                            subscriptionUrgency === "soon"
                          ? t(
                              "نزدیک به پایان · ثبت دستی",
                              "Ending soon · Manual",
                            )
                          : t("ثبت دستی", "Set manually")}
                    </small>
                  </button>
                </AccountInfoPopover>
                <AccountInfoPopover {...infoProps} section="resets">
                  <button
                    type="button"
                    className={`card-summary-trigger card-reset-credits ${giftUrgency}`}
                    title={giftExpiry != null ? date(giftExpiry) : undefined}
                  >
                    <span className="card-summary-label">
                      <Gift size={14} aria-hidden="true" />
                      {t("ریست هدیه", "Reset credits")}
                      <ChevronDown
                        size={12}
                        className="card-summary-chevron"
                        aria-hidden="true"
                      />
                    </span>
                    <span className="card-summary-value">
                      <bdi>
                        {resetCount == null
                          ? t("نامشخص", "Unknown")
                          : num(resetCount)}
                      </bdi>
                    </span>
                    <small>
                      {settings.layout === "list" && giftExpiry != null
                        ? giftUrgency === "expired"
                          ? t("مهلت هدیه گذشته", "Credit expired")
                          : countdown(giftExpiry, now, fa)
                              .replace("بازنشانی در", "مهلت:")
                              .replace("Resets in", "Expires in")
                        : giftWarning
                          ? giftUrgency === "expired"
                            ? t("مهلت هدیه گذشته", "Credit expired")
                            : t("مهلت هدیه نزدیک است", "Credit expires soon")
                          : resetCount == null
                            ? t("گزارش نشده", "Not reported")
                            : t("در دسترس", "Available")}
                    </small>
                  </button>
                </AccountInfoPopover>
              </div>
              {a.error && (
                <p className="account-error" role="alert">
                  {presentError(a.error, fa)}
                </p>
              )}
              <div className="account-card-actions">
                {hasAdditionalDetails && (
                  <div className="account-more">
                    <AccountInfoPopover {...infoProps} section="limits">
                      <Button
                        type="button"
                        variant="ghost"
                        className="account-more-trigger"
                      >
                        <span>{t("اعتبار و سهمیه", "Credits & limits")}</span>
                        <ChevronDown size={14} />
                      </Button>
                    </AccountInfoPopover>
                  </div>
                )}
                {settings.layout !== "list" && (
                  <div className="account-switch-action">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        !native ||
                        busy ||
                        !caps.desktopSwitch ||
                        a.status !== "connected"
                      }
                      title={capabilityMessage(caps, fa)}
                      onClick={() => void run(() => bridge.switch(a.id))}
                    >
                      <ArrowRightLeft size={14} />
                      {t("استفاده در Codex", "Use in Codex")}
                    </Button>
                  </div>
                )}
              </div>
              <footer className="account-footer">
                <span
                  className="card-updated"
                  title={a.updatedAt ? date(a.updatedAt) : undefined}
                >
                  {t("آخرین به‌روزرسانی", "Updated")}
                  <span dir="auto">
                    {a.updatedAt
                      ? new Date(a.updatedAt * 1000).toLocaleTimeString(
                          fa ? "fa-IR" : "en-US",
                          { hour: "2-digit", minute: "2-digit" },
                        )
                      : "—"}
                  </span>
                </span>
                <div className="card-footer-actions">
                  {a.status === "signingIn" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void cancelLogin(a.id)}
                    >
                      {t("لغو ورود", "Cancel sign-in")}
                    </Button>
                  ) : (
                    a.status === "needsLogin" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!native || busy}
                        onClick={() => void startLogin(a)}
                      >
                        <LogIn />
                        {t("ورود مجدد", "Sign in")}
                      </Button>
                    )
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={!native || busy}
                    aria-label={t("تازه‌سازی حساب", "Refresh account")}
                    onClick={() => void manualRefresh.refresh()}
                  >
                    {manualRefresh.confirmed ? (
                      <Check size={15} className="quiet-confirmation" />
                    ) : (
                      <RefreshCw
                        className={
                          manualRefresh.pending || a.status === "refreshing"
                            ? "spin"
                            : ""
                        }
                        size={15}
                      />
                    )}
                    {manualRefresh.confirmed && (
                      <span className="sr-only" role="status">
                        {t("تازه شد", "Refreshed")}
                      </span>
                    )}
                  </Button>
                </div>
              </footer>
            </CardContent>
          </div>
        </div>
        <Dialog
          open={quickEditor !== null}
          onOpenChange={(open) => {
            if (!open && !busy) setQuickEditor(null);
          }}
        >
          <DialogContent
            dir={fa ? "rtl" : "ltr"}
            className="quick-account-dialog"
          >
            <DialogHeader>
              <DialogTitle>
                {quickEditor === "color"
                  ? t("رنگ کارت", "Card color")
                  : t("هشدار سهمیه", "Quota alert")}
              </DialogTitle>
              <DialogDescription>
                {quickEditor === "alert"
                  ? t(
                      `هشدار سهمیهٔ ۵ ساعته برای ${a.label}`,
                      `5-hour usage alert for ${a.label}`,
                    )
                  : a.label}
              </DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setQuickError(null);
                void (async () => {
                  if (
                    await run(() =>
                      bridge
                        .update(
                          a.id,
                          quickEditor === "color"
                            ? { color: quickColor }
                            : {
                                alertThreshold: alertEnabled
                                  ? Number(quickAlert)
                                  : null,
                              },
                        )
                        .catch((error) => {
                          setQuickError(errorCode(error));
                          throw error;
                        }),
                    )
                  )
                    setQuickEditor(null);
                })();
              }}
            >
              {quickEditor === "color" ? (
                <ColorPicker
                  value={quickColor}
                  onChange={setQuickColor}
                  fa={fa}
                  disabled={busy}
                />
              ) : (
                <div className="alert-editor">
                  <label className="alert-toggle">
                    <span>
                      <strong>
                        {t("هشدار کاهش سهمیه", "Low quota alert")}
                      </strong>
                      <small>
                        {t(
                          "وقتی سهمیهٔ باقی‌مانده کمتر از آستانه شد",
                          "When remaining usage falls below the threshold",
                        )}
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={alertEnabled}
                      disabled={busy}
                      onChange={(e) => {
                        setAlertEnabled(e.target.checked);
                        if (!quickAlert) setQuickAlert("20");
                      }}
                    />
                  </label>
                  <fieldset
                    className="alert-threshold"
                    disabled={!alertEnabled || busy}
                  >
                    <legend>{t("آستانهٔ هشدار", "Alert threshold")}</legend>
                    <div className="alert-presets">
                      {[10, 20, 30].map((value) => (
                        <Button
                          key={value}
                          type="button"
                          variant="ghost"
                          aria-pressed={Number(quickAlert) === value}
                          onClick={() => setQuickAlert(String(value))}
                        >
                          {num(value)}
                          {fa ? "٪" : "%"}
                        </Button>
                      ))}
                    </div>
                    <label className="alert-custom">
                      <span>{t("مقدار دلخواه", "Custom value")}</span>
                      <span className="alert-number">
                        <LocalizedNumberInput
                          fa={fa}
                          aria-label={t(
                            "آستانهٔ هشدار به درصد",
                            "Alert threshold percent",
                          )}
                          dir="ltr"
                          min={1}
                          max={100}
                          required={alertEnabled}
                          value={quickAlert}
                          onValueChange={setQuickAlert}
                        />
                        <span>{fa ? "٪" : "%"}</span>
                      </span>
                    </label>
                  </fieldset>
                  <p className="alert-help">
                    {t(
                      "اعلان‌ها به مجوز سیستم نیاز دارند و هنگام اجرای برنامه بررسی می‌شوند.",
                      "Notifications require system permission and are checked while the app is running.",
                    )}
                  </p>
                </div>
              )}
              {quickError && (
                <p role="alert" className="account-error">
                  {presentError(quickError, fa)}
                </p>
              )}
              <div className="form-actions">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setQuickEditor(null)}
                >
                  {t("انصراف", "Cancel")}
                </Button>
                <Button type="submit" disabled={!native || busy}>
                  {t("ذخیره", "Save")}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </Card>
    </>
  );
}
