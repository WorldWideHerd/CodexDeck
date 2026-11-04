import { useAccountPresence } from "@/hooks/use-account-presence";
import { useManualRefresh, useQuietFeedback } from "@/hooks/use-quiet-feedback";
import { PopupMenu } from "@/components/ui/popup-menu";
import { NotificationSettingsLink } from "@/components/notification-settings-link";
import { WarmupPanel } from "@/components/warmup-panel";
import { dateLocale } from "@/lib/dates";
import { initialLoginLifecycle, loginReducer } from "@/lib/login-lifecycle";
import {
  errorCode,
  isNotificationError,
  presentError,
  stateForPresentation,
  type ErrorCode,
  desktopSwitchPhaseText,
  type DesktopSwitchPhase,
} from "@/lib/presentation";
import { MenubarPanel } from "@/components/menubar-panel";
import { SettingsPanel } from "@/components/settings-panel";
import { useEffect, useReducer, useRef, useState } from "react";
import {
  ArrowDownUp,
  Activity,
  Check,
  ArrowUpRight,
  Copy,
  LayoutGrid,
  List,
  LoaderCircle,
  Monitor,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
  TriangleAlert,
  Wallet,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AccountReorder } from "@/components/account-reorder";
import { AccountCard } from "@/components/account-card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { bridge, emptyState, native, syntheticState } from "@/lib/bridge";
import { ordered, reorder } from "@/lib/usage";
import type {
  Account,
  AppState,
  PlatformCapabilities,
  Settings as AppSettings,
} from "@/lib/types";
import { AccountForm } from "@/components/account-form";
export default function App() {
  const [state, setState] = useState<AppState>(emptyState),
    [ready, setReady] = useState(!native),
    [error, setError] = useState<ErrorCode | null>(null),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(false),
    [settingsOpen, setSettingsOpen] = useState(false),
    [editor, setEditor] = useState<Account | "new" | null>(null),
    [deleting, setDeleting] = useState<Account | null>(null),
    [caps, setCaps] = useState<PlatformCapabilities>({
      platform: "browser",
      desktopSwitch: false,
      desktopRestore: false,
      reason: null,
    }),
    [now, setNow] = useState(Date.now() / 1000);
  const [loginLifecycle, dispatchLogin] = useReducer(
    loginReducer,
    initialLoginLifecycle,
  );
  const loginGeneration = useRef(0);
  const addAccountButton = useRef<HTMLButtonElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const focusAfterDeletion = useRef(false);
  const pendingRemoval = useRef<Account | null>(null);
  const [desktopPhase, setDesktopPhase] = useState<DesktopSwitchPhase | null>(
    null,
  );
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    let off: (() => void) | undefined;
    void bridge
      .subscribeDesktopSwitch((phase) => {
        if (!disposed) setDesktopPhase(phase);
      })
      .then((stop) => {
        if (disposed) stop();
        else off = stop;
      })
      .catch((e) => setError(errorCode(e)));
    return () => {
      disposed = true;
      off?.();
    };
  }, []);
  const [sortOpen, setSortOpen] = useState(false);
  const [expandedAccountId, setExpandedAccountId] = useState<string | null>(
    null,
  );
  const login = loginLifecycle.login;
  const fa = state.settings.language === "fa",
    t = (f: string, e: string) => (fa ? f : e);
  const num = (n: number) =>
    new Intl.NumberFormat(fa ? "fa-IR" : "en-US", {
      maximumFractionDigits: 0,
    }).format(n);
  const date = (n: number) =>
    new Date(n * 1000).toLocaleString(dateLocale(fa, state.settings.calendar), {
      dateStyle: "medium",
      timeStyle: "short",
    });
  useEffect(() => {
    if (!native) return;
    let disposed = false,
      off: (() => void) | undefined;
    void bridge
      .subscribe(
        (s) => {
          const removing = pendingRemoval.current;
          if (!disposed)
            setState((previous) => {
              const next = stateForPresentation(s);
              if (!removing || next.accounts.some((a) => a.id === removing.id))
                return next;
              // Native state can be emitted before persistence has succeeded. The
              // command response alone authorizes the visual exit.
              const accounts = [...next.accounts];
              const index = previous.accounts.findIndex(
                (a) => a.id === removing.id,
              );
              accounts.splice(Math.max(0, index), 0, removing);
              return { ...next, accounts };
            });
        },
        (l) => {
          if (!disposed) dispatchLogin({ type: "event", value: l });
        },
      )
      .then((f) => {
        if (disposed) f();
        else off = f;
      })
      .catch((e) => setError(errorCode(e)));
    void Promise.all([bridge.state(), bridge.capabilities()])
      .then(([s, c]) => {
        if (!disposed) {
          setState(stateForPresentation(s));
          setCaps(c);
        }
      })
      .catch((e) => setError(errorCode(e)))
      .finally(() => setReady(true));
    return () => {
      disposed = true;
      off?.();
    };
  }, []);
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen("open-settings", () => setSettingsOpen(true)),
      )
      .then((off) => {
        if (disposed) off();
        else unlisten = off;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    let checking = false;
    const recheck = async () => {
      if (checking) return;
      checking = true;
      try {
        await bridge.checkNotificationReadiness();
        if (!disposed)
          setError((previous) =>
            previous &&
            [
              "notificationUnavailable",
              "notificationPermission",
              "notificationQuiet",
              "notificationSilent",
              "notificationRequestFailed",
              "notificationAppChanged",
            ].includes(previous)
              ? null
              : previous,
          );
      } catch {
        // Keep the existing notice when the native check itself is unavailable.
      } finally {
        checking = false;
      }
    };
    window.addEventListener("focus", recheck);
    return () => {
      disposed = true;
      window.removeEventListener("focus", recheck);
    };
  }, []);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 30000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    document.documentElement.lang = fa ? "fa" : "en";
    document.documentElement.dir = fa ? "rtl" : "ltr";
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      document.documentElement.classList.toggle(
        "dark",
        state.settings.appearance === "dark" ||
          (state.settings.appearance === "system" && media.matches),
      );
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [fa, state.settings.appearance]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (result && typeof result === "object" && "accounts" in result)
        setState(stateForPresentation(result as AppState));
      return true;
    } catch (e) {
      setError(errorCode(e));
      return false;
    } finally {
      setBusy(false);
      setDesktopPhase(null);
    }
  }
  const manualRefresh = useManualRefresh(state.accounts, run);
  const copyFeedback = useQuietFeedback();
  useEffect(() => {
    copyFeedback.clear();
  }, [login?.url]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "r" && native) {
        event.preventDefault();
        if (!busy) void manualRefresh.refresh();
      }
      if (event.key === ",") {
        event.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [busy, state.accounts]);
  async function settings(patch: Partial<AppSettings>) {
    if (!native) {
      setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
      return;
    }
    await run(() => bridge.settings(patch));
  }
  async function startLogin(a: Account) {
    const generation = ++loginGeneration.current;
    dispatchLogin({ type: "begin", generation, accountId: a.id });
    const succeeded = await run(async () => {
      const value = await bridge.login(a.id);
      dispatchLogin({ type: "response", generation, value });
    });
    if (!succeeded)
      dispatchLogin({ type: "cancelled", generation, accountId: a.id });
  }
  async function cancelLogin(accountId: string) {
    const generation = loginGeneration.current;
    if (await run(() => bridge.cancel(accountId)))
      dispatchLogin({ type: "cancelled", generation, accountId });
  }
  async function move(source: string, target: string) {
    if (!native || state.settings.sort !== "manual") return;
    await run(() =>
      bridge.reorder(
        reorder(
          state.accounts.map((a) => a.id),
          source,
          target,
        ),
      ),
    );
  }
  const presence = useAccountPresence(state.accounts, ready && native);
  const accounts = ordered(presence.accounts, state.settings.sort, now),
    connected = state.accounts.filter(
      (a) => a.status === "connected" || a.status === "refreshing",
    ).length;
  const refreshing = state.accounts.some((a) => a.status === "refreshing");
  const latestUpdate = Math.max(
    0,
    ...state.accounts.map((a) => a.updatedAt ?? 0),
  );
  const sortLabel = t(
    {
      manual: "ترتیب دستی",
      fiveHour: "کمترین سهمیه ۵ ساعته",
      weekly: "کمترین سهمیه هفتگی",
      reset: "نزدیک‌ترین بازنشانی",
    }[state.settings.sort],
    {
      manual: "Manual order",
      fiveHour: "Lowest 5-hour quota",
      weekly: "Lowest weekly quota",
      reset: "Next reset",
    }[state.settings.sort],
  );
  if (new URLSearchParams(window.location.search).get("view") === "menubar")
    return <MenubarPanel state={state} busy={busy} now={now} run={run} />;
  return (
    <div className="app-shell">
      <Dialog open={desktopPhase !== null}>
        <DialogContent
          dir={fa ? "rtl" : "ltr"}
          className="[&>button]:hidden"
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>
              {t("تغییر حساب Codex", "Changing Codex account")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "Codex بسته می‌شود و با حساب تأییدشده دوباره باز می‌شود. اگر درخواست تأیید مک باز است، آن را تأیید یا لغو کن.",
                "Codex will close and reopen using the confirmed account. Approve or cancel any macOS authentication prompt.",
              )}
            </DialogDescription>
          </DialogHeader>
          <p role="status" aria-live="polite">
            <span key={desktopPhase} className="desktop-phase-feedback">
              <LoaderCircle className="animate-spin inline-block" size={18} />{" "}
              {desktopPhase && desktopSwitchPhaseText(desktopPhase, fa)}
            </span>
          </p>
        </DialogContent>
      </Dialog>
      <main>
        <header className="deck-header">
          <div className="header-row">
            <a
              className="deck-brand"
              href="#"
              onClick={() => setSettingsOpen(false)}
            >
              <img
                className="deck-logo"
                src="/app-logo.png"
                alt={t("لوگوی CodexDeck", "CodexDeck logo")}
              />
              <span>
                <strong>CodexDeck</strong>
              </span>
            </a>
            <div className="header-controls">
              <Button
                className="add-account"
                disabled={!native || busy}
                ref={addAccountButton}
                onClick={() => setEditor("new")}
              >
                <Plus />
                {t("افزودن حساب", "Add account")}
              </Button>
            </div>
          </div>
        </header>
        <div className="page-content">
          {!native && (
            <div className="notice">
              <Monitor size={18} />
              <span>
                {preview
                  ? t(
                      "داده‌های ساختگی برای بررسی ظاهر؛ هیچ حساب واقعی متصل نیست.",
                      "Synthetic preview data. No real accounts are connected.",
                    )
                  : t(
                      "برای ورود و دریافت مصرف واقعی، برنامه دسکتاپ را اجرا کنید.",
                      "Run the desktop app to sign in and load real usage.",
                    )}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPreview(!preview);
                  setState((s) => ({
                    ...(!preview ? syntheticState(true) : emptyState),
                    settings: s.settings,
                  }));
                }}
              >
                {preview
                  ? t("خروج از نمونه", "Exit preview")
                  : t("نمایش داده نمونه", "Show sample data")}
              </Button>
            </div>
          )}
          <WarmupPanel
            accounts={state.accounts}
            fa={fa}
            calendar={state.settings.calendar}
          />
          {(error || state.lastError) && (
            <div className="error-banner" role="alert">
              <TriangleAlert size={18} />
              <div className="error-banner-content">
                <span>{presentError(error || state.lastError, fa)}</span>
                {isNotificationError(error || state.lastError) && (
                  <NotificationSettingsLink platform={caps.platform} fa={fa} />
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("بستن خطا", "Dismiss error")}
                onClick={() => {
                  setError(null);
                  setState((s) => ({ ...s, lastError: null }));
                }}
              >
                <X />
              </Button>
            </div>
          )}
          {accounts.length > 0 && (
            <>
              <div className="workspace-heading">
                <div>
                  <h1>{t("حساب‌های شما", "Your accounts")}</h1>
                  <p>
                    {t(
                      "مقایسهٔ سهمیه‌ها و زمان بازنشانی؛ برای جزئیات روی حساب بزنید.",
                      "Compare quotas and reset times. Open an account for details.",
                    )}
                  </p>
                </div>
                <span className="connection-summary">
                  <Activity size={15} />
                  {num(connected)} {t("متصل", "connected")}
                  <span>/ {num(accounts.length)}</span>
                </span>
              </div>
              <div className="deck-toolbar">
                <div className="sort-control">
                  <ArrowDownUp size={17} />
                  <PopupMenu
                    className="sort-popover"
                    contentClassName="sort-options"
                    open={sortOpen}
                    onOpenChange={setSortOpen}
                    title={sortLabel}
                    label={`${t("مرتب‌سازی", "Sort accounts")}: ${sortLabel}`}
                    trigger={t(
                      {
                        manual: "ترتیب دستی",
                        fiveHour: "کمترین سهمیه ۵ ساعته",
                        weekly: "کمترین سهمیه هفتگی",
                        reset: "نزدیک‌ترین بازنشانی",
                      }[state.settings.sort],
                      {
                        manual: "Manual order",
                        fiveHour: "Lowest 5-hour quota",
                        weekly: "Lowest weekly quota",
                        reset: "Next reset",
                      }[state.settings.sort],
                    )}
                  >
                    <strong>{t("مرتب‌سازی", "Sort accounts")}</strong>
                    {(
                      [
                        ["manual", "ترتیب دستی", "Manual order"],
                        [
                          "fiveHour",
                          "کمترین سهمیه ۵ ساعته",
                          "Lowest 5-hour quota",
                        ],
                        ["weekly", "کمترین سهمیه هفتگی", "Lowest weekly quota"],
                        ["reset", "نزدیک‌ترین بازنشانی", "Next reset"],
                      ] as const
                    ).map(([value, f, e]) => (
                      <Button
                        key={value}
                        variant="ghost"
                        aria-pressed={state.settings.sort === value}
                        onClick={() => {
                          void settings({ sort: value });
                          setSortOpen(false);
                        }}
                      >
                        {t(f, e)}
                        <Check
                          size={13}
                          style={{
                            opacity: state.settings.sort === value ? 1 : 0,
                          }}
                        />
                      </Button>
                    ))}
                  </PopupMenu>
                </div>
                <div className="layout-switch">
                  <Button
                    variant={
                      state.settings.layout === "cards" ? "secondary" : "ghost"
                    }
                    aria-pressed={state.settings.layout === "cards"}
                    aria-label={t("نمای کارت", "Card view")}
                    onClick={() => void settings({ layout: "cards" })}
                  >
                    <LayoutGrid />
                    {t("کارتی", "Cards")}
                  </Button>
                  <Button
                    variant={
                      state.settings.layout === "list" ? "secondary" : "ghost"
                    }
                    aria-pressed={state.settings.layout === "list"}
                    aria-label={t("نمای فهرست", "List view")}
                    onClick={() => void settings({ layout: "list" })}
                  >
                    <List />
                    {t("فهرستی", "List")}
                  </Button>
                </div>
              </div>
            </>
          )}
          {
            <>
              {!ready ? (
                <div className="empty" role="status" aria-live="polite">
                  <LoaderCircle className="spin" />
                  <h2>{t("در حال بارگذاری…", "Loading…")}</h2>
                </div>
              ) : !accounts.length ? (
                <Card className="empty">
                  <div className="empty-icon">
                    <Wallet size={30} />
                  </div>
                  <h2>
                    {t(
                      "اولین حساب خود را متصل کنید",
                      "Connect your first account",
                    )}
                  </h2>
                  <p>
                    {t(
                      "با ورود امن در مرورگر، سهمیه‌ها و زمان بازنشانی اینجا نمایش داده می‌شوند.",
                      "Sign in securely through your browser to see quotas and reset times here.",
                    )}
                  </p>
                  <Button
                    disabled={!native || busy}
                    onClick={() => setEditor("new")}
                  >
                    <Plus />
                    {t("افزودن حساب", "Add account")}
                  </Button>
                </Card>
              ) : (
                <div className={`account-collection ${state.settings.layout}`}>
                  {state.settings.layout === "list" && (
                    <div className="account-list-heading" aria-hidden="true">
                      <span>{t("حساب", "Account")}</span>
                      <span>{t("سهمیهٔ ۵ ساعته", "5-hour quota")}</span>
                      <span>{t("سهمیهٔ هفتگی", "Weekly quota")}</span>
                      <span className="list-actions-heading">
                        {t("عملیات", "Actions")}
                      </span>
                    </div>
                  )}
                  <AccountReorder
                    className={`accounts ${state.settings.layout}`}
                    ids={accounts.map((a) => a.id)}
                    enabled={
                      !busy &&
                      !presence.exiting.length &&
                      state.settings.sort === "manual"
                    }
                    onCommit={(ids) => {
                      if (native) return run(() => bridge.reorder(ids));
                      else
                        setState((s) => ({
                          ...s,
                          accounts: ids.flatMap((id) =>
                            s.accounts.filter((a) => a.id === id),
                          ),
                        }));
                    }}
                  >
                    {(id, index) => {
                      const a = accounts.find((account) => account.id === id)!;
                      return (
                        <AccountCard
                          key={a.id}
                          a={a}
                          exiting={presence.exiting.includes(a.id)}
                          entering={presence.entering.includes(a.id)}
                          expanded={expandedAccountId === a.id}
                          onExpandedChange={() =>
                            setExpandedAccountId((current) =>
                              current === a.id ? null : a.id,
                            )
                          }
                          index={index}
                          accounts={accounts}
                          settings={state.settings}
                          caps={caps}
                          busy={busy}
                          now={now}
                          fa={fa}
                          t={t}
                          num={num}
                          date={date}
                          move={move}
                          run={run}
                          setEditor={setEditor}
                          setDeleting={setDeleting}
                          startLogin={startLogin}
                          cancelLogin={cancelLogin}
                        />
                      );
                    }}
                  </AccountReorder>
                </div>
              )}
            </>
          }
        </div>
        <footer className="deck-footer">
          <div>
            <Button
              variant="outline"
              disabled={!native || busy}
              onClick={() => void manualRefresh.refresh()}
            >
              {manualRefresh.confirmed ? (
                <Check className="quiet-confirmation" />
              ) : (
                <RefreshCw className={manualRefresh.pending ? "spin" : ""} />
              )}
              {manualRefresh.confirmed
                ? t("تازه شد", "Refreshed")
                : t("تازه‌سازی", "Refresh")}
            </Button>
            <span role="status" aria-live="polite">
              {!busy && !refreshing && latestUpdate > 0 && (
                <span>
                  {t("آخرین دریافت", "Last received")}:{" "}
                  {new Date(latestUpdate * 1000).toLocaleTimeString(
                    fa ? "fa-IR" : "en-US",
                    { hour: "2-digit", minute: "2-digit" },
                  )}{" "}
                  ·{" "}
                </span>
              )}
              {refreshing
                ? t("در حال تازه‌سازی حساب‌ها…", "Refreshing accounts…")
                : busy
                  ? t("در حال انجام…", "Working…")
                  : state.settings.refreshMinutes
                    ? t(
                        `خودکار: هر ${num(state.settings.refreshMinutes)} دقیقه`,
                        `Automatic: every ${num(state.settings.refreshMinutes)} minutes`,
                      )
                    : t("دریافت خودکار خاموش", "Automatic refresh off")}
            </span>
          </div>
          <div>
            <Button
              variant="ghost"
              size="icon"
              className="footer-settings"
              ref={settingsButton}
              aria-label={t("تنظیمات", "Settings")}
              aria-haspopup="dialog"
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen(true)}
            >
              <Settings />
              {t("تنظیمات", "Settings")}
            </Button>
          </div>
        </footer>
      </main>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent
          className="settings-dialog"
          overlayClassName="settings-dialog-overlay"
          dir={fa ? "rtl" : "ltr"}
          aria-labelledby="settings-title"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            settingsButton.current?.focus({ preventScroll: true });
          }}
        >
          <SettingsPanel
            state={state}
            caps={caps}
            busy={busy}
            fa={fa}
            t={t}
            num={num}
            settings={settings}
            run={run}
            onClose={() => setSettingsOpen(false)}
          />
        </DialogContent>
      </Dialog>
      <Dialog
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setEditor(null);
        }}
      >
        <DialogContent dir={fa ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle>
              {editor === "new"
                ? t("افزودن حساب", "Add account")
                : t("ویرایش حساب", "Edit account")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "نام و تنظیمات حساب؛ اطلاعات ورود در مرورگر وارد می‌شوند.",
                "Account details and preferences. Sign-in happens in your browser.",
              )}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="account-error">
              {presentError(error, fa)}
            </p>
          )}
          {editor && (
            <AccountForm
              key={editor === "new" ? "new" : editor.id}
              account={editor === "new" ? null : editor}
              busy={busy}
              fa={fa}
              calendar={state.settings.calendar}
              submit={async (label, workspaceId, subscriptionEndsAt) => {
                const ok = await run(() =>
                  editor === "new"
                    ? bridge.add(label, workspaceId || undefined)
                    : bridge.update(editor!.id, {
                        label,
                        subscriptionEndsAt,
                      }),
                );
                if (ok) setEditor(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!deleting}
        onOpenChange={(v) => {
          if (!v && !busy) setDeleting(null);
        }}
      >
        <DialogContent
          dir={fa ? "rtl" : "ltr"}
          onCloseAutoFocus={(event) => {
            if (focusAfterDeletion.current) {
              event.preventDefault();
              focusAfterDeletion.current = false;
              addAccountButton.current?.focus();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("حذف حساب؟", "Remove account?")}</DialogTitle>
            <DialogDescription>
              {t(
                `حساب «${deleting?.label}»و ورود ذخیره‌شده آن حذف می‌شوند. برای اتصال دوباره باید وارد شوید.`,
                `Remove “${deleting?.label}” and its saved sign-in. You will need to sign in again to reconnect.`,
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="confirmation-actions">
            <Button
              variant="outline"
              disabled={busy}
              autoFocus
              onClick={() => setDeleting(null)}
            >
              {t("انصراف", "Cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void (async () => {
                  if (!deleting) return;
                  pendingRemoval.current = deleting;
                  try {
                    if (await run(() => bridge.remove(deleting.id))) {
                      focusAfterDeletion.current = true;
                      setDeleting(null);
                    }
                  } finally {
                    pendingRemoval.current = null;
                  }
                })()
              }
            >
              {busy ? <LoaderCircle className="spin" /> : <Trash2 />}
              {busy
                ? t("در حال حذف…", "Removing…")
                : t("حذف حساب", "Remove account")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={login?.status === "pending"}
        onOpenChange={(v) => {
          if (!v && login && !busy)
            void (async () => {
              await cancelLogin(login.accountId);
            })();
        }}
      >
        <DialogContent dir={fa ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle>
              {t("ورود در مرورگر", "Sign in through your browser")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "پس از تأیید ورود، وضعیت حساب به‌صورت خودکار به‌روز می‌شود.",
                "After you finish signing in, your account updates automatically.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="login-progress">
            <LoaderCircle className="spin" />
            <span>{t("منتظر تأیید ورود…", "Waiting for sign-in…")}</span>
          </div>
          {login?.url && (
            <p className="path" dir="ltr">
              {login.url}
            </p>
          )}
          <Button
            variant="outline"
            disabled={!login?.url || busy}
            onClick={() =>
              void run(async () => {
                copyFeedback.clear();
                await navigator.clipboard.writeText(login!.url!);
                copyFeedback.confirm();
              })
            }
          >
            {copyFeedback.confirmed ? (
              <Check className="quiet-confirmation" />
            ) : (
              <Copy />
            )}
            {copyFeedback.confirmed
              ? t("کپی شد", "Copied")
              : t("کپی لینک ورود", "Copy sign-in link")}
          </Button>
          <Button
            onClick={() =>
              login && void run(() => bridge.openLogin(login.accountId))
            }
            disabled={busy || !login?.url}
          >
            <ArrowUpRight />
            {t("بازکردن صفحه ورود", "Open sign-in page")}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              login &&
              void (async () => {
                await cancelLogin(login.accountId);
              })()
            }
          >
            {t("لغو ورود", "Cancel sign-in")}
          </Button>
        </DialogContent>
      </Dialog>
      {login?.status === "failed" && (
        <div className="toast" role="alert">
          {presentError(login.error ?? "loginFailed", fa)}
          <Button
            size="icon"
            variant="ghost"
            onClick={() => dispatchLogin({ type: "dismiss" })}
            aria-label={t("بستن", "Close")}
          >
            <X />
          </Button>
        </div>
      )}
    </div>
  );
}
