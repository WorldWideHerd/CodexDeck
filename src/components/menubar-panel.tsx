import { dateLocale } from "@/lib/dates";
import { CircleAlert, Maximize2, Power, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "./ui/button";
import { bridge, native } from "@/lib/bridge";
import { buckets, countdown, isStale, ordered, remaining } from "@/lib/usage";
import type { AppState, UsageWindow } from "@/lib/types";
import "./menubar-panel.css";
export function MenubarPanel({
  state,
  busy,
  now,
  run,
}: {
  state: AppState;
  busy: boolean;
  now: number;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [keyboardNavigation, setKeyboardNavigation] = useState(false);
  useEffect(() => {
    // A newly focused webview can give its first button :focus-visible.
    // Show control focus only after deliberate keyboard navigation.
    const reset = () => setKeyboardNavigation(false);
    const navigate = (event: KeyboardEvent) => {
      if (event.key === "Tab" || event.key.startsWith("Arrow"))
        setKeyboardNavigation(true);
    };
    window.addEventListener("focus", reset);
    window.addEventListener("blur", reset);
    window.addEventListener("pointerdown", reset, true);
    window.addEventListener("keydown", navigate, true);
    return () => {
      window.removeEventListener("focus", reset);
      window.removeEventListener("blur", reset);
      window.removeEventListener("pointerdown", reset, true);
      window.removeEventListener("keydown", navigate, true);
    };
  }, []);
  const fa = state.settings.language === "fa";
  const t = (f: string, e: string) => (fa ? f : e);
  const num = (v: number) =>
    new Intl.NumberFormat(fa ? "fa-IR" : "en-US", {
      maximumFractionDigits: 0,
    }).format(v);
  return (
    <section
      className="menubar-panel"
      dir={fa ? "rtl" : "ltr"}
      data-keyboard-navigation={keyboardNavigation}
    >
      <header>
        <div className="menubar-brand">
          <img src="/app-logo.png" alt="" />
          <div>
            <strong>CodexDeck</strong>
            <small>
              {t("سهمیهٔ باقی‌مانده", "Remaining usage")} ·{" "}
              {num(state.accounts.length)} {t("حساب", "accounts")}
            </small>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          disabled={!native || busy}
          aria-label={t("تازه‌سازی", "Refresh")}
          onClick={() => void run(() => bridge.refresh())}
        >
          <RefreshCw className={busy ? "spin" : ""} />
        </Button>
      </header>
      <div className="menubar-columns">
        <span>{t("حساب", "Account")}</span>
        <span>{t("۵ ساعته", "5-hour")}</span>
        <span>{t("هفتگی", "Weekly")}</span>
      </div>
      <div className="menubar-accounts">
        {ordered(state.accounts, state.settings.sort, now).map((a) => {
          const main = buckets(a.snapshot)[0]?.[1];
          const windows = [main?.primary, main?.secondary];
          const stale = isStale(a, state.settings.refreshMinutes, now);
          const accountNotice =
            a.status === "needsLogin" || a.status === "idle"
              ? t(
                  "نیاز به ورود؛ برنامه را باز کنید.",
                  "Sign in required; open the app.",
                )
              : a.status === "failed"
                ? t(
                    "خطا در دریافت؛ برنامه را برای بررسی باز کنید.",
                    "Refresh failed; open the app for details.",
                  )
                : stale
                  ? t(
                      "اطلاعات قدیمی؛ تازه‌سازی کنید.",
                      "Cached data; refresh to update.",
                    )
                  : null;
          function percentage(w: UsageWindow | undefined | null) {
            const value = w ? remaining(w) : null;
            return (
              <span
                className={
                  stale
                    ? "menubar-quota cached"
                    : value !== null && value <= 10
                      ? "menubar-quota critical"
                      : "menubar-quota"
                }
                title={
                  stale
                    ? t(
                        "اطلاعات قدیمی؛ تازه‌سازی کن",
                        "Cached data; refresh to update",
                      )
                    : undefined
                }
              >
                {value === null ? "—" : `${num(value)}${fa ? "٪" : "%"}`}
                {value !== null && (
                  <span className="menubar-meter" aria-hidden="true">
                    <span style={{ width: `${value}%` }} />
                  </span>
                )}
                {w && (
                  <small
                    aria-label={countdown(w.resetsAt, now, fa)}
                    title={
                      w.resetsAt
                        ? new Date(w.resetsAt * 1000).toLocaleString(
                            dateLocale(fa, state.settings.calendar),
                          )
                        : undefined
                    }
                  >
                    {countdown(w.resetsAt, now, fa).replace(
                      fa ? "بازنشانی در " : "Resets in ",
                      "",
                    )}
                  </small>
                )}
              </span>
            );
          }
          return (
            <div className="menubar-account" key={a.id}>
              <span className="menubar-name" title={a.label}>
                <i
                  style={{
                    background: /^#[0-9a-f]{6}$/i.test(a.color ?? "")
                      ? a.color!
                      : "#79dbca",
                  }}
                />
                <span className="menubar-account-label">
                  <span className="menubar-name-line">
                    <span className="menubar-label-text" dir="auto">
                      {a.label}
                    </span>
                    {accountNotice && (
                      <span
                        className="menubar-account-status"
                        role="img"
                        aria-label={accountNotice}
                        title={accountNotice}
                      >
                        <CircleAlert size={12} aria-hidden="true" />
                      </span>
                    )}
                  </span>
                  <small>{a.plan ?? "—"}</small>
                </span>
              </span>
              {percentage(windows.find((w) => w?.windowDurationMins === 300))}
              {percentage(windows.find((w) => w?.windowDurationMins === 10080))}
            </div>
          );
        })}
        {!state.accounts.length && (
          <p>{t("هنوز حسابی اضافه نشده", "No accounts yet")}</p>
        )}
      </div>
      {state.lastError && (
        <p className="menubar-error" role="alert">
          {t(
            "دریافت اطلاعات انجام نشد؛ برنامه را باز کنید.",
            "Unable to refresh; open the app for details.",
          )}
        </p>
      )}
      <footer>
        <Button
          className="menubar-open"
          variant="outline"
          disabled={!native}
          onClick={() => void run(() => invoke("show_dashboard"))}
        >
          <Maximize2 />
          {t("بازکردن اپ", "Open app")}
        </Button>

        <Button
          className="menubar-quit"
          variant="ghost"
          disabled={!native || busy}
          onClick={() => void run(() => bridge.quit())}
        >
          <Power />
          {t("خروج از اپ", "Quit app")}
        </Button>
      </footer>
    </section>
  );
}
