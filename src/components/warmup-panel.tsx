import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Clock3,
  ListChecks,
  LoaderCircle,
  Play,
  Plus,
} from "lucide-react";
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
    complete: ["اجرا پایان یافت", "Run finished"],
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
    busy: ["حساب مشغول بود؛ اجرا نشد", "Account busy — skipped"],
    removed: ["حساب حذف شده؛ اجرا نشد", "Account removed — skipped"],
    unknown: [
      "وضعیت پنج‌ساعته مشخص نیست؛ ارسال نشد",
      "Five-hour state unknown — skipped",
    ],
  };
  return (labels[status] ?? ["وضعیت نامشخص", "Unknown status"])[fa ? 0 : 1];
}
function resultTone(status: string) {
  if (["confirmed", "alreadyActive"].includes(status)) return "success";
  if (["queued", "sending", "cancelled"].includes(status)) return "neutral";
  return "attention";
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
  const [view, setView] = useState<"setup" | "results">("setup");
  const opener = useRef<HTMLButtonElement | null>(null);
  const title = useRef<HTMLHeadingElement | null>(null);
  const [open, setOpen] = useState(false),
    [job, setJob] = useState<WarmupJob | null>(null);
  const [ids, setIds] = useState<string[]>([]),
    [scheduled, setScheduled] = useState(false);
  const [time, setTime] = useState(defaultTime),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<"load" | "time" | "start" | "cancel" | null>(
      null,
    );
  const available = accounts.filter((a) => a.status === "connected");
  const occupied = job?.status === "pending" || job?.status === "running";
  const showingResults = !!job && (view === "results" || occupied);
  const number = (n: number) =>
    new Intl.NumberFormat(fa ? "fa-IR" : "en-US").format(n);
  const accountCount = (n: number) =>
    t(`${number(n)} حساب`, `${number(n)} ${n === 1 ? "account" : "accounts"}`);
  const finished =
    job?.rows.filter((r) => !["queued", "sending"].includes(r.status)).length ??
    0;
  function setup() {
    setIds(available.map((a) => a.id));
    setScheduled(false);
    setTime(defaultTime());
    setError(null);
    setView("setup");
  }
  const resultTitle =
    job?.status === "pending"
      ? t("زمان‌بندی شروع", "Scheduled start")
      : job?.status === "running"
        ? t("پیشرفت اجرا", "Run progress")
        : t("نتیجهٔ اجرا", "Run results");
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
        if (!disposed) {
          setJob(j);
          if (["pending", "running"].includes(j.status)) setView("results");
        }
      })
      .then(async (cleanup) => {
        if (disposed) {
          cleanup();
          return;
        }
        off = cleanup;
        const j = await bridge.warmup();
        if (!disposed && !changed) {
          setJob(j);
          if (j && ["pending", "running"].includes(j.status))
            setView("results");
        }
      })
      .catch(() => {
        if (!disposed) setError("load");
      });
    return () => {
      disposed = true;
      off?.();
    };
  }, []);
  useEffect(() => {
    if (open) title.current?.focus();
  }, [view, open]);
  async function start() {
    const at = scheduled ? new Date(time).getTime() / 1000 : null;
    if (
      scheduled &&
      (at === null ||
        !Number.isFinite(at) ||
        at < Date.now() / 1000 + 5 ||
        at > Date.now() / 1000 + 30 * 86400)
    ) {
      setError("time");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setJob(await bridge.startWarmup(ids, at));
      setView("results");
    } catch {
      setError("start");
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await bridge.cancelWarmup();
      setJob(await bridge.warmup());
    } catch {
      setError("cancel");
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
      <div className="warmup-toolbar-copy">
        <span className="warmup-feature-icon" aria-hidden="true">
          <Clock3 size={20} />
        </span>
        <div>
          <strong>{t("پنجرهٔ پنج‌ساعته", "Five-hour window")}</strong>
          <p role="status" aria-live="polite">
            {job ? (
              <>
                {warmupLabel(job.status, fa)} · {accountCount(job.rows.length)}
                {occupied && job.at ? ` · ${date(job.at)}` : ""}
              </>
            ) : !available.length ? (
              t("ابتدا یک حساب متصل کنید", "Connect an account first")
            ) : (
              t(
                "شروع مصرف با یک پیام کوتاه، اکنون یا در زمان دلخواه",
                "Start with a short message, now or at a scheduled time",
              )
            )}
          </p>
        </div>
      </div>
      <div className="warmup-toolbar-actions">
        {job && (
          <Button
            variant="outline"
            aria-haspopup="dialog"
            onClick={(e) => {
              opener.current = e.currentTarget;
              setView("results");
              setError(null);
              setOpen(true);
            }}
          >
            <ListChecks size={16} />
            {job.status === "pending"
              ? t("مشاهدهٔ برنامه", "View schedule")
              : job.status === "running"
                ? t("مشاهدهٔ پیشرفت", "View progress")
                : t("مشاهدهٔ نتیجه", "View results")}
          </Button>
        )}
        {!occupied && (
          <Button
            disabled={!available.length}
            aria-haspopup="dialog"
            onClick={(e) => {
              opener.current = e.currentTarget;
              setup();
              setOpen(true);
            }}
          >
            <Plus size={16} />
            {job ? t("اجرای جدید", "New run") : t("تنظیم شروع", "Set up start")}
          </Button>
        )}
      </div>
      {error === "load" && !open && (
        <p className="warmup-error" role="alert">
          {t(
            "وضعیت اجرا دریافت نشد. اتصال را بررسی و برنامه را دوباره باز کنید.",
            "Could not load the run. Check your connection and reopen the app.",
          )}
        </p>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          dir={fa ? "rtl" : "ltr"}
          className="warmup-dialog"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            title.current?.focus();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            const target = opener.current?.isConnected
              ? opener.current
              : document.querySelector<HTMLButtonElement>(
                  ".warmup-toolbar-actions button",
                );
            target?.focus();
          }}
        >
          <DialogHeader className="warmup-header">
            <span className="warmup-eyebrow">
              {t("پنجرهٔ پنج‌ساعته", "Five-hour window")}
            </span>
            <DialogTitle ref={title} tabIndex={-1}>
              {showingResults ? resultTitle : t("تنظیم شروع", "Set up start")}
            </DialogTitle>
            <DialogDescription>
              {showingResults
                ? t(
                    "وضعیت هر حساب را در ادامه ببینید. دریافت پاسخ به‌تنهایی به معنی فعال‌شدن پنجره نیست.",
                    "Check each account below. A reply alone does not confirm an active window.",
                  )
                : t(
                    "حساب‌ها و زمان ارسال پیام را انتخاب کنید.",
                    "Choose the accounts and when to send a short message.",
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
          {!showingResults && (
            <>
              <p className="warmup-notice">
                {t(
                  "این پیام مقداری از سهمیه را مصرف می‌کند. برای حساب‌هایی که پنجرهٔ مصرفشان فعال است، پیامی ارسال نمی‌شود. شروع پنجره باید از سمت سرور تأیید شود.",
                  "This uses some quota. Accounts with an active usage window receive no message. The server must confirm the window has started.",
                )}
              </p>
              <fieldset className="warmup-accounts" disabled={busy || !native}>
                <legend>
                  {t("انتخاب حساب‌ها", "Select accounts")}{" "}
                  <span>
                    {t(
                      `${number(ids.length)} انتخاب‌شده`,
                      `${number(ids.length)} selected`,
                    )}
                  </span>
                </legend>
                <label className="warmup-select-all">
                  <input
                    ref={(node) => {
                      if (node)
                        node.indeterminate =
                          available.some((a) => ids.includes(a.id)) &&
                          !available.every((a) => ids.includes(a.id));
                    }}
                    disabled={!available.length}
                    type="checkbox"
                    checked={
                      available.length > 0 &&
                      available.every((a) => ids.includes(a.id))
                    }
                    onChange={(e) =>
                      setIds(e.target.checked ? available.map((a) => a.id) : [])
                    }
                  />
                  {t("همهٔ حساب‌های متصل", "All connected accounts")}
                </label>
                {accounts.map((a) => (
                  <label
                    key={a.id}
                    className="warmup-account"
                    data-disabled={a.status !== "connected"}
                  >
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
                    <span>
                      <bdi>{a.label}</bdi>
                      {a.email && (
                        <small>
                          <bdi>{a.email}</bdi>
                        </small>
                      )}
                    </span>
                    {a.status !== "connected" && (
                      <small>{t("ابتدا متصل شوید", "Connect first")}</small>
                    )}
                  </label>
                ))}
                {!available.length && (
                  <p className="warmup-hint">
                    {t(
                      "برای شروع، دست‌کم یک حساب متصل لازم است.",
                      "Connect at least one account to start.",
                    )}
                  </p>
                )}
              </fieldset>
              <fieldset className="warmup-timing" disabled={busy || !native}>
                <legend>{t("زمان اجرا", "When to run")}</legend>
                <label>
                  <input
                    type="radio"
                    name="warmup-time"
                    checked={!scheduled}
                    onChange={() => {
                      setScheduled(false);
                      setError(null);
                    }}
                  />
                  {t("همین حالا", "Now")}
                </label>
                <label>
                  <input
                    type="radio"
                    name="warmup-time"
                    checked={scheduled}
                    onChange={() => {
                      setScheduled(true);
                      setError(null);
                    }}
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
                      aria-invalid={error === "time"}
                      aria-describedby={
                        error === "time" ? "warmup-time-error" : undefined
                      }
                      onChange={(e) => {
                        setTime(e.target.value);
                        if (error === "time") setError(null);
                      }}
                    />
                  </label>
                )}
                {error === "time" && (
                  <p
                    id="warmup-time-error"
                    className="warmup-error"
                    role="alert"
                  >
                    {t(
                      "زمانی از ۵ ثانیه تا ۳۰ روز آینده انتخاب کنید.",
                      "Choose a time from 5 seconds to 30 days in the future.",
                    )}
                  </p>
                )}
              </fieldset>
              {scheduled && (
                <p className="warmup-hint">
                  {t(
                    "برای زمان‌بندی، اپ باید باز و سیستم بیدار و آنلاین باشد. موعدهای ازدست‌رفته و ارسال‌های نامشخص خودکار تکرار نمی‌شوند. زمان را حداکثر تا ۳۰ روز آینده انتخاب کنید.",
                    "For scheduled runs, keep the app open and the computer awake and online. Missed schedules and uncertain sends are not retried automatically. Choose a time within 30 days.",
                  )}
                </p>
              )}
              <div className="warmup-actions">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setOpen(false)}
                >
                  {t("بستن", "Close")}
                </Button>
                <Button
                  disabled={
                    busy ||
                    !native ||
                    ids.length === 0 ||
                    ids.some((id) => !available.some((a) => a.id === id))
                  }
                  onClick={() => void start()}
                >
                  {busy ? (
                    <LoaderCircle size={16} className="warmup-spinner" />
                  ) : (
                    <Play size={16} />
                  )}
                  {busy
                    ? t("در حال ثبت…", "Saving…")
                    : scheduled
                      ? t("زمان‌بندی ارسال", "Schedule send")
                      : t(
                          `ارسال به ${new Intl.NumberFormat("fa-IR").format(ids.length)} حساب`,
                          `Send to ${ids.length} ${ids.length === 1 ? "account" : "accounts"}`,
                        )}
                </Button>
              </div>
            </>
          )}
          {showingResults && job && (
            <>
              <section className="warmup-results" aria-live="polite">
                <div className="warmup-run-summary" role="status">
                  <strong>{warmupLabel(job.status, fa)}</strong>
                  <span>
                    {accountCount(job.rows.length)}
                    {job.at ? ` · ${date(job.at)}` : ""}
                  </span>
                  {job.status === "running" && (
                    <>
                      <progress
                        max={Math.max(1, job.rows.length)}
                        value={finished}
                        aria-label={t("حساب‌های بررسی‌شده", "Accounts checked")}
                      />
                      <small>
                        {t(
                          `${number(finished)} از ${number(job.rows.length)} حساب بررسی شده`,
                          `${number(finished)} of ${number(job.rows.length)} accounts checked`,
                        )}
                      </small>
                    </>
                  )}
                </div>
                <div className="warmup-result-counts">
                  <div>
                    <strong>
                      {number(
                        job.rows.filter((r) => r.status === "confirmed").length,
                      )}
                    </strong>
                    <span>{t("تأییدشده", "Confirmed")}</span>
                  </div>
                  <div>
                    <strong>
                      {number(
                        job.rows.filter((r) => r.status === "alreadyActive")
                          .length,
                      )}
                    </strong>
                    <span>{t("از قبل فعال", "Already active")}</span>
                  </div>
                  <div>
                    <strong>
                      {number(
                        job.rows.filter(
                          (r) => resultTone(r.status) === "attention",
                        ).length,
                      )}
                    </strong>
                    <span>{t("نیازمند بررسی", "Needs review")}</span>
                  </div>
                </div>
                <ul
                  className="warmup-result-list"
                  aria-label={t("وضعیت حساب‌ها", "Account results")}
                >
                  {job.rows.map((r) => (
                    <li key={r.accountId} data-tone={resultTone(r.status)}>
                      <span className="warmup-result-icon" aria-hidden="true">
                        {resultTone(r.status) === "success" ? (
                          <CheckCircle2 size={18} />
                        ) : resultTone(r.status) === "attention" ? (
                          <CircleAlert size={18} />
                        ) : r.status === "sending" ? (
                          <LoaderCircle size={18} className="warmup-spinner" />
                        ) : (
                          <Clock3 size={18} />
                        )}
                      </span>
                      <div>
                        <strong>
                          <bdi>{r.label}</bdi>
                        </strong>
                        <p>{warmupLabel(r.status, fa)}</p>
                        {r.resetsAt ? (
                          <small>
                            {t("بازنشانی سهمیه:", "Quota resets:")}{" "}
                            {date(r.resetsAt)}
                          </small>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
              <div className="warmup-actions">
                {job.status === "pending" && (
                  <Button
                    variant="outline"
                    disabled={busy || !native}
                    onClick={() => void cancel()}
                  >
                    {busy
                      ? t("در حال لغو…", "Cancelling…")
                      : t("لغو زمان‌بندی", "Cancel schedule")}
                  </Button>
                )}
                {!occupied && (
                  <Button
                    variant="outline"
                    disabled={!available.length || busy}
                    onClick={setup}
                  >
                    <Plus size={16} />
                    {t("اجرای جدید", "New run")}
                  </Button>
                )}
                <Button onClick={() => setOpen(false)}>
                  {t("بستن", "Close")}
                </Button>
              </div>
            </>
          )}
          {error && error !== "time" && (
            <p className="warmup-error" role="alert">
              {error === "load"
                ? t(
                    "وضعیت اجرا دریافت نشد. اتصال را بررسی و برنامه را دوباره باز کنید.",
                    "Could not load the run. Check your connection and reopen the app.",
                  )
                : error === "cancel"
                  ? t(
                      "زمان‌بندی لغو نشد. وضعیت اجرا و اتصال را بررسی و دوباره تلاش کنید.",
                      "Could not cancel. Check the run status and your connection, then try again.",
                    )
                  : t(
                      "درخواست ثبت نشد. اتصال و وضعیت حساب‌های انتخاب‌شده را بررسی کنید.",
                      "Could not save the run. Check your connection and the selected accounts.",
                    )}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
