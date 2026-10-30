import { useEffect, useState } from "react";
import { Clock3, Play } from "lucide-react";
import { bridge, native } from "@/lib/bridge";
import { dateLocale } from "@/lib/dates";
import type { Account, Settings, WarmupJob } from "@/lib/types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import "./warmup-panel.css";

export function warmupLabel(status: string, fa: boolean) {
  const labels: Record<string, [string, string]> = {
    pending: ["در انتظار اجرا", "Scheduled"],
    running: ["در حال اجرا", "Running"],
    complete: [
      "پایان بررسی؛ نتیجهٔ هر اکانت را ببینید",
      "Finished — check each account’s result",
    ],
    cancelled: ["لغو شد", "Cancelled"],
    missed: ["موعد گذشت؛ اجرا نشد", "Missed — no catch-up send"],
    interrupted: [
      "اجرا قطع شد؛ خودکار تکرار نمی‌شود",
      "Interrupted — not retried automatically",
    ],
    queued: ["در صف", "Queued"],
    sending: ["در حال بررسی و ارسال", "Checking and sending"],
    confirmed: ["پنجرهٔ پنج‌ساعته تأیید شد", "Five-hour window confirmed"],
    alreadyActive: [
      "از قبل فعال بود؛ پیامی ارسال نشد",
      "Already active — no message sent",
    ],
    sent: [
      "پاسخ دریافت شد؛ شروع پنجره هنوز تأیید نشده",
      "Reply received — window not yet confirmed",
    ],
    uncertain: [
      "نتیجهٔ ارسال نامشخص؛ خودکار تکرار نمی‌شود",
      "Send outcome unknown — not retried",
    ],
    failed: ["بررسی یا درخواست ناموفق بود", "Check or request failed"],
    needsLogin: ["نیازمند ورود", "Sign in required"],
    busy: ["اکانت مشغول بود؛ اجرا نشد", "Account busy — skipped"],
    removed: ["اکانت حذف شده؛ اجرا نشد", "Account removed — skipped"],
    unknown: [
      "وضعیت پنج‌ساعته مشخص نیست؛ ارسال نشد",
      "Five-hour state unknown — skipped",
    ],
  };
  return (labels[status] ?? ["وضعیت نامشخص", "Unknown status"])[fa ? 0 : 1];
}
function defaultTime() {
  const date = new Date(Date.now() + 5 * 60_000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}
export function WarmupPanel({
  accounts,
  fa,
  calendar,
}: {
  accounts: Account[];
  fa: boolean;
  calendar: Settings["calendar"];
}) {
  const t = (f: string, e: string) => (fa ? f : e);
  const [open, setOpen] = useState(false),
    [job, setJob] = useState<WarmupJob | null>(null);
  const [ids, setIds] = useState<string[]>([]),
    [scheduled, setScheduled] = useState(false);
  const [time, setTime] = useState(defaultTime),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const available = accounts.filter((a) => a.status === "connected");
  const occupied = job?.status === "pending" || job?.status === "running";
  const date = (n: number) =>
    new Date(n * 1000).toLocaleString(dateLocale(fa, calendar), {
      dateStyle: "medium",
      timeStyle: "short",
    });
  useEffect(() => {
    if (!native) return;
    let disposed = false,
      changed = false;
    let off: (() => void) | undefined;
    void bridge
      .subscribeWarmup((j) => {
        changed = true;
        if (!disposed) setJob(j);
      })
      .then(async (cleanup) => {
        if (disposed) {
          cleanup();
          return;
        }
        off = cleanup;
        const j = await bridge.warmup();
        if (!disposed && !changed) setJob(j);
      })
      .catch(() => {
        if (!disposed) setError(true);
      });
    return () => {
      disposed = true;
      off?.();
    };
  }, []);
  async function start() {
    const at = scheduled ? new Date(time).getTime() / 1000 : null;
    if (
      scheduled &&
      (at === null ||
        !Number.isFinite(at) ||
        at < Date.now() / 1000 + 5 ||
        at > Date.now() / 1000 + 30 * 86400)
    ) {
      setError(true);
      return;
    }
    setBusy(true);
    setError(false);
    try {
      setJob(await bridge.startWarmup(ids, at));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    setBusy(true);
    setError(false);
    try {
      await bridge.cancelWarmup();
      setJob(await bridge.warmup());
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  if (!accounts.length && !job) return null;
  return (
    <section
      className="warmup-toolbar"
      aria-label={t("شروع پنجرهٔ مصرف", "Start usage window")}
    >
      <div>
        <strong>{t("شروع پنجرهٔ مصرف", "Start usage window")}</strong>
        <p role="status" aria-live="polite">
          {job
            ? warmupLabel(job.status, fa)
            : !available.length
              ? t("ابتدا یک حساب متصل کنید", "Connect an account first")
              : t(
                  "ارسال یک پیام کوتاه، همین حالا یا در زمان مشخص",
                  "Send a short message now or at a scheduled time",
                )}
          {occupied && job && (
            <>
              {" "}
              · {job.at ? date(job.at) : t("همین حالا", "Now")} ·{" "}
              {new Intl.NumberFormat(fa ? "fa-IR" : "en-US").format(
                job.rows.length,
              )}{" "}
              {t("حساب", "accounts")}
            </>
          )}
        </p>
      </div>
      <Button
        disabled={!job && !available.length}
        variant="outline"
        onClick={() => {
          setIds(available.map((a) => a.id));
          setOpen(true);
        }}
      >
        <Clock3 size={16} />
        {job?.status === "pending"
          ? t("مشاهدهٔ برنامه", "View schedule")
          : job?.status === "running"
            ? t("مشاهدهٔ پیشرفت", "View progress")
            : job
              ? t("مشاهدهٔ نتیجه", "View results")
              : t("شروع / زمان‌بندی", "Start / schedule")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir={fa ? "rtl" : "ltr"} className="warmup-dialog">
          <DialogHeader>
            <DialogTitle>
              {t("شروع پنجرهٔ پنج‌ساعته", "Start five-hour window")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "برای هر اکانت انتخاب‌شده یک پیام «فقط بنویس OK» ارسال می‌شود و مقداری سهمیه مصرف می‌کند. اکانت‌های از قبل فعال رد می‌شوند؛ شروع پنجره به تأیید سرور بستگی دارد.",
                "Each selected account receives ‘Reply only OK.’ This consumes some quota. Already-active accounts are skipped; activation depends on server confirmation.",
              )}
            </DialogDescription>
          </DialogHeader>
          {!native && (
            <p role="status">
              {t(
                "ارسال و زمان‌بندی فقط در اپ دسکتاپ در دسترس است.",
                "Sending and scheduling are available in the desktop app.",
              )}
            </p>
          )}
          {!occupied && (
            <>
              <fieldset className="warmup-accounts" disabled={busy || !native}>
                <legend>{t("انتخاب اکانت‌ها", "Select accounts")}</legend>
                <label>
                  <input
                    type="checkbox"
                    checked={
                      available.length > 0 &&
                      available.every((a) => ids.includes(a.id))
                    }
                    onChange={(e) =>
                      setIds(e.target.checked ? available.map((a) => a.id) : [])
                    }
                  />
                  {t("همهٔ اکانت‌های متصل", "All connected accounts")}
                </label>
                {accounts.map((a) => (
                  <label key={a.id}>
                    <input
                      type="checkbox"
                      disabled={a.status !== "connected"}
                      checked={ids.includes(a.id)}
                      onChange={(e) =>
                        setIds((previous) =>
                          e.target.checked
                            ? [...previous, a.id]
                            : previous.filter((id) => id !== a.id),
                        )
                      }
                    />
                    <span>{a.label}</span>
                    {a.status !== "connected" && (
                      <small>{t("ابتدا متصل شوید", "Connect first")}</small>
                    )}
                  </label>
                ))}
              </fieldset>
              <fieldset className="warmup-timing" disabled={busy || !native}>
                <legend>{t("زمان اجرا", "When to run")}</legend>
                <label>
                  <input
                    type="radio"
                    name="warmup-time"
                    checked={!scheduled}
                    onChange={() => setScheduled(false)}
                  />
                  {t("همین حالا", "Now")}
                </label>
                <label>
                  <input
                    type="radio"
                    name="warmup-time"
                    checked={scheduled}
                    onChange={() => setScheduled(true)}
                  />
                  {t("یک‌بار در زمان مشخص", "Once at a scheduled time")}
                </label>
                {scheduled && (
                  <label className="warmup-date">
                    {t(
                      "تاریخ میلادی و ساعت محلی این دستگاه",
                      "Gregorian date and this device’s local time",
                    )}
                    <Input
                      dir="ltr"
                      type="datetime-local"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                    />
                  </label>
                )}
              </fieldset>
              <p className="warmup-hint">
                {t(
                  "برای زمان‌بندی، اپ باید باز و سیستم بیدار و آنلاین باشد. موعدهای ازدست‌رفته و ارسال‌های نامشخص خودکار تکرار نمی‌شوند. زمان را حداکثر تا ۳۰ روز آینده انتخاب کنید.",
                  "For scheduled runs, keep the app open and the computer awake and online. Missed schedules and uncertain sends are not retried automatically. Choose a time within 30 days.",
                )}
              </p>
              <Button
                disabled={
                  busy ||
                  !native ||
                  ids.length === 0 ||
                  ids.some((id) => !available.some((a) => a.id === id))
                }
                onClick={() => void start()}
              >
                <Play size={16} />
                {busy
                  ? t("در حال ثبت…", "Saving…")
                  : scheduled
                    ? t("ثبت زمان‌بندی", "Schedule")
                    : t(
                        "ارسال به اکانت‌های انتخاب‌شده",
                        "Send to selected accounts",
                      )}
              </Button>
            </>
          )}
          {job && (
            <section className="warmup-results" aria-live="polite">
              <strong>{warmupLabel(job.status, fa)}</strong>
              {job.at && <p>{date(job.at)}</p>}
              {job.rows.map((r) => (
                <div key={r.accountId}>
                  <span>{r.label}</span>
                  <small>
                    {warmupLabel(r.status, fa)}
                    {r.resetsAt
                      ? ` · ${t("ریست:", "Reset:")} ${date(r.resetsAt)}`
                      : ""}
                  </small>
                </div>
              ))}
              {job.status === "pending" && (
                <Button
                  variant="outline"
                  disabled={busy || !native}
                  onClick={() => void cancel()}
                >
                  {t("لغو زمان‌بندی", "Cancel schedule")}
                </Button>
              )}
            </section>
          )}
          {error && (
            <p role="alert">
              {t(
                "عملیات انجام نشد. اتصال و وضعیت اکانت‌ها را بررسی کنید و زمان معتبر تا ۳۰ روز آینده انتخاب کنید.",
                "Could not complete the action. Check your connection and accounts, and choose a valid time within 30 days.",
              )}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
