import { AccountTransfer } from "@/components/account-transfer";
import { localizeDigits } from "@/lib/numbers";
import { capabilityMessage, presentError } from "@/lib/presentation";
import {
  Bell,
  CircleHelp,
  CalendarDays,
  Circle,
  Download,
  Globe,
  Hand,
  Moon,
  Power,
  RefreshCw,
  Settings as SettingsIcon,
  Sun,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { bridge, native } from "@/lib/bridge";
import type { AppState, Settings, PlatformCapabilities } from "@/lib/types";
import "./settings-popover.css";
interface Props {
  onClose?: () => void;
  state: AppState;
  caps: PlatformCapabilities;
  busy: boolean;
  fa: boolean;
  t: (f: string, e: string) => string;
  num: (n: number) => string;
  settings: (patch: Partial<Settings>) => Promise<void>;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
}
function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="settings-section">
      <h3>
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}
export function SettingsPanel({
  onClose,
  state,
  caps,
  busy,
  fa,
  t,
  num,
  settings,
  run,
}: Props) {
  const [transferOpen, setTransferOpen] = useState(false);
  const [notificationResult, setNotificationResult] = useState<string | null>(
    null,
  );
  const [testingNotification, setTestingNotification] = useState(false);
  const [notificationReady, setNotificationReady] = useState<boolean | null>(
    null,
  );
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    const recheck = async () => {
      setNotificationResult(null);
      try {
        const warning = await bridge.checkNotificationReadiness();
        if (!disposed)
          setNotificationReady(
            !warning ||
              warning ===
                "Notifications are enabled, but sound is disabled in OS settings." ||
              warning ===
                "Visual notifications are enabled, but sound readiness could not be verified.",
          );
      } catch {
        if (!disposed) setNotificationReady(false);
      }
    };
    void recheck();
    window.addEventListener("focus", recheck);
    return () => {
      disposed = true;
      window.removeEventListener("focus", recheck);
    };
  }, []);
  return (
    <div className="settings-popover" dir={fa ? "rtl" : "ltr"}>
      <header className="settings-popover-heading">
        <h2 id="settings-title">
          <SettingsIcon />
          {t("تنظیمات", "Settings")}
        </h2>
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("بستن", "Close")}
            onClick={onClose}
          >
            <X />
          </Button>
        )}
      </header>
      <div className="settings-scroll">
        <Section
          title={t("اعلان‌های سهمیه", "Quota notifications")}
          icon={<Bell />}
        >
          <div className="notification-preferences-row">
            <p className="notification-readiness" role="status">
              <span
                className="notification-readiness-dot"
                data-ready={notificationReady}
              />
              {!native
                ? t("در برنامهٔ دسکتاپ", "Desktop app only")
                : notificationReady === null
                  ? t("در حال بررسی…", "Checking…")
                  : notificationReady
                    ? t("فعال", "Enabled")
                    : t("نیاز به بررسی", "Needs attention")}
            </p>
            <Button
              variant="outline"
              disabled={!native || busy || testingNotification}
              onClick={async () => {
                setTestingNotification(true);
                setNotificationResult(null);
                try {
                  const warning = await bridge.testNotification();
                  setNotificationReady(true);
                  setNotificationResult(
                    warning
                      ? presentError(warning, fa)
                      : t(
                          "اعلان به سیستم ارسال شد.",
                          "Notification submitted to the OS.",
                        ),
                  );
                } catch (error) {
                  setNotificationResult(presentError(error, fa));
                } finally {
                  setTestingNotification(false);
                }
              }}
            >
              <Bell />
              {testingNotification
                ? t("در حال ارسال…", "Sending…")
                : t("تست اعلان", "Test notification")}
            </Button>
          </div>
          <p>
            {t(
              "هشدار هر حساب را جداگانه تنظیم کنید.",
              "Set alerts for each account separately.",
            )}
          </p>
          {notificationResult && (
            <p className="notification-result" role="status">
              {notificationResult}
            </p>
          )}
        </Section>
        <Section title={t("زبان برنامه", "App language")} icon={<Globe />}>
          <div
            className="settings-choices"
            role="group"
            aria-label={t("زبان برنامه", "App language")}
          >
            {(
              [
                ["fa", "فارسی"],
                ["en", "English"],
              ] as const
            ).map(([language, title]) => (
              <Button
                key={language}
                variant="ghost"
                disabled={busy}
                aria-pressed={state.settings.language === language}
                onClick={() => void settings({ language })}
              >
                {title}
              </Button>
            ))}
          </div>
        </Section>
        <Section title={t("تقویم", "Calendar")} icon={<CalendarDays />}>
          <div
            className="settings-choices"
            role="group"
            aria-label={t("تقویم", "Calendar")}
          >
            {(
              [
                ["persian", t("شمسی", "Persian")],
                ["gregory", t("میلادی", "Gregorian")],
              ] as const
            ).map(([calendar, title]) => (
              <Button
                key={calendar}
                variant="ghost"
                disabled={busy}
                aria-pressed={
                  (state.settings.calendar ?? "persian") === calendar
                }
                onClick={() => void settings({ calendar })}
              >
                {title}
              </Button>
            ))}
          </div>
        </Section>
        <Section title={t("ظاهر برنامه", "App appearance")} icon={<Circle />}>
          <div
            className="settings-choices"
            role="group"
            aria-label={t("ظاهر برنامه", "App appearance")}
          >
            {(
              [
                {
                  value: "system",
                  title: t("سیستم", "System"),
                  icon: <Circle />,
                },
                { value: "light", title: t("روشن", "Light"), icon: <Sun /> },
                { value: "dark", title: t("تاریک", "Dark"), icon: <Moon /> },
              ] as const
            ).map(({ value, title, icon }) => (
              <Button
                key={value}
                variant="ghost"
                disabled={busy}
                aria-pressed={state.settings.appearance === value}
                onClick={() => void settings({ appearance: value })}
              >
                {icon}
                {title}
              </Button>
            ))}
          </div>
        </Section>
        <Section
          title={t("به‌روزرسانی خودکار", "Automatic refresh")}
          icon={<RefreshCw />}
        >
          <div
            className="settings-choices"
            role="group"
            aria-label={t("به‌روزرسانی خودکار", "Automatic refresh")}
          >
            {[3, 5, 10, 30, 60].map((n) => (
              <Button
                key={n}
                variant="ghost"
                disabled={busy}
                aria-label={t(`هر ${num(n)} دقیقه`, `Every ${n} minutes`)}
                aria-pressed={state.settings.refreshMinutes === n}
                onClick={() => void settings({ refreshMinutes: n })}
              >
                {num(n)}
              </Button>
            ))}
          </div>
          <p>
            {t(
              "فاصلهٔ دریافت اطلاعات، به دقیقه",
              "Refresh interval in minutes",
            )}
          </p>
        </Section>

        <details className="settings-advanced">
          <summary>
            <Hand />
            {t("درباره و حریم خصوصی", "About & privacy")}
          </summary>
          <div>
            <div className="settings-version">
              <strong>CodexDeck</strong>
              <span>{localizeDigits("0.1.0", fa)}</span>
            </div>
            <p>
              {t(
                "سرویس بررسی به‌روزرسانی در این نسخه متصل نیست.",
                "The update service is not connected in this version.",
              )}
            </p>
            <p>
              {t(
                "هیچ گزارش عیب‌یابی یا دادهٔ تله‌متری ارسال نمی‌شود. سرویس گزارش اختیاری در این نسخه متصل نیست.",
                "No diagnostic reports or telemetry are sent. The optional reporting service is not connected in this version.",
              )}
            </p>
          </div>
        </details>
        <details className="settings-advanced">
          <summary>
            <SettingsIcon />
            {t("اتصال Codex", "Codex connection")}
          </summary>
          <div>
            <Button
              className="settings-action"
              variant="ghost"
              disabled={!native || busy}
              onClick={() => void run(() => bridge.choose())}
            >
              <Download />
              {t("انتخاب فایل اجرایی Codex CLI", "Choose Codex CLI executable")}
            </Button>
            <p className="settings-path" dir="auto">
              {state.codexExecutable ??
                t(
                  "هنوز انتخاب نشده؛ از PATH سیستم استفاده می‌شود.",
                  "Not selected; uses the system PATH.",
                )}
            </p>
            {caps.desktopRestore && (
              <Button
                className="settings-action"
                variant="ghost"
                disabled={!native || !caps.desktopRestore || busy}
                onClick={() => void run(() => bridge.restore())}
              >
                <RefreshCw />
                {t(
                  "بازیابی حساب اصلی دسکتاپ",
                  "Restore original desktop account",
                )}
              </Button>
            )}
            <p>{capabilityMessage(caps, fa)}</p>
            <p>
              <CircleHelp />
              {t(
                "آستانهٔ هشدار سهمیه را از ویرایش حساب تنظیم کنید.",
                "Set quota alert thresholds under Edit account.",
              )}
            </p>
          </div>
        </details>
      </div>
      <Dialog
        open={transferOpen}
        onOpenChange={(open) => {
          if (!busy) setTransferOpen(open);
        }}
      >
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            className="settings-action settings-transfer-link"
          >
            <Download />
            {t("انتقال و پشتیبان حساب‌ها", "Account transfer & backup")}
          </Button>
        </DialogTrigger>
        <DialogContent
          className="transfer-dialog"
          dir={fa ? "rtl" : "ltr"}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {t("انتقال و پشتیبان حساب‌ها", "Account transfer & backup")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "ذخیرهٔ امن حساب‌ها یا بازیابی از فایل پشتیبان",
                "Securely save accounts or restore a backup file",
              )}
            </DialogDescription>
          </DialogHeader>
          <AccountTransfer fa={fa} busy={busy} run={run} />
        </DialogContent>
      </Dialog>
      <div className="settings-quit">
        <Button
          variant="ghost"
          className="settings-action"
          disabled={!native || busy}
          title={t("اکانت‌ها ذخیره می‌مانند", "Accounts remain saved")}
          onClick={() => void run(() => bridge.quit())}
        >
          <Power />
          {t("خروج از اپ", "Quit app")}
        </Button>
      </div>
    </div>
  );
}
