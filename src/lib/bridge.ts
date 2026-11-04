import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { desktopSwitchPhases, type DesktopSwitchPhase } from "./presentation";
import type {
  AppState,
  RefreshResult,
  AccountPatch,
  LoginState,
  PlatformCapabilities,
  Settings,
  WarmupJob,
} from "./types";
export const native = isTauri();
export const emptyState: AppState = {
  accounts: [],
  settings: {
    language: "en",
    calendar: "persian",
    appearance: "system",
    refreshMinutes: 3,
    layout: "list",
    sort: "manual",
    pinned: false,
  },
  codexExecutable: null,
  lastError: null,
};
async function call<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!native)
    throw new Error(
      "این عملیات در برنامه دسکتاپ در دسترس است. / Open the desktop app to use this action.",
    );
  return invoke<T>(command, args);
}
export const bridge = {
  subscribeDesktopSwitch: (
    receive: (phase: DesktopSwitchPhase | null) => void,
  ) =>
    listen<unknown>("desktop-switch-progress", (event) => {
      const phase = event.payload;
      if (
        phase === null ||
        (typeof phase === "string" && Object.hasOwn(desktopSwitchPhases, phase))
      ) {
        receive(phase as DesktopSwitchPhase | null);
      }
    }),
  checkNotificationReadiness: () =>
    call<string | null>("check_notification_readiness"),
  openNotificationSettings: () => call<void>("open_notification_settings"),
  testNotification: () => call<string | null>("test_notification"),
  warmup: () => call<WarmupJob | null>("get_warmup"),
  startWarmup: (ids: string[], at: number | null) =>
    call<WarmupJob>("start_warmup", { ids, at }),
  cancelWarmup: () => call<void>("cancel_warmup"),
  subscribeWarmup: (receive: (job: WarmupJob) => void) =>
    listen<WarmupJob>("warmup-changed", (e) => receive(e.payload)),
  transfer: (password: string, importing: boolean) =>
    call<{ imported: number; skipped: number } | null>("transfer_accounts", {
      password,
      importing,
    }),
  state: () => call<AppState>("get_state"),
  quit: () => call<void>("quit_app"),
  capabilities: () => call<PlatformCapabilities>("get_platform_capabilities"),
  add: (label: string, workspaceId?: string) =>
    call<AppState>("add_account", { label, workspaceId }),
  update: (id: string, patch: AccountPatch) =>
    call<AppState>("update_account", { id, patch }),
  remove: (id: string) => call<AppState>("remove_account", { id }),
  reorder: (ids: string[]) => call<AppState>("reorder_accounts", { ids }),
  settings: (patch: Partial<Settings>) =>
    call<AppState>("save_settings", { patch }),
  refresh: (id?: string) => call<RefreshResult>("refresh_accounts", { id }),
  login: (id: string) => call<LoginState>("start_login", { id }),
  cancel: (id: string) => call<AppState>("cancel_login", { id }),
  openLogin: (id: string) => call<void>("open_login_url", { id }),
  pin: (pinned: boolean) => call<void>("set_pinned", { pinned }),
  choose: () => call<AppState>("choose_codex_executable"),
  switch: (id: string) => call<AppState>("switch_desktop_account", { id }),
  restore: () => call<AppState>("restore_desktop_account"),
  async subscribe(
    state: (s: AppState) => void,
    login: (l: LoginState) => void,
  ) {
    const offState = await listen<AppState>("state-changed", (e) =>
      state(e.payload),
    );
    try {
      const offLogin = await listen<LoginState>("login-changed", (e) =>
        login(e.payload),
      );
      return () => {
        offState();
        offLogin();
      };
    } catch (e) {
      offState();
      throw e;
    }
  },
};
export function syntheticState(reference = false): AppState {
  const now = Date.now() / 1000;
  return {
    ...emptyState,
    accounts: (reference
      ? [
          ["Studio", "Business", 100, 16],
          ["Design team", "Plus", 0, 16],
          ["Research", "Business", 96, 15],
          ["Workshop", "Plus", 35, 21],
          ["Catalog demo", "Business", 92, 14],
          ["Development", "Business", 0, 16],
        ]
      : [
          ["Personal studio", "pro", 22, 38],
          ["Work space", "business", 74, 53],
          ["Research", "plus", 94, 81],
        ]
    ).map(([label, plan, p, w], i) => ({
      id: `synthetic-${i}`,
      label: String(label),
      plan: String(plan),
      email: `preview-${i + 1}@example.invalid`,
      workspaceId: null,
      status: "connected",
      error: null,
      updatedAt: now,
      color: ["#58a6ff", "#ff6a27", "#55c4df"][i % 3],
      subscriptionEndsAt: now + (i + 1) * 86400 * 6,
      alertThreshold: i === 2 ? 20 : null,
      snapshot: {
        rateLimitsByLimitId: {
          codex: {
            limitName: "Codex",
            primary: {
              usedPercent: Number(p),
              windowDurationMins: 300,
              resetsAt: now + 7200,
            },
            secondary: {
              usedPercent: Number(w),
              windowDurationMins: 10080,
              resetsAt: now + 586800,
            },
          },
        },
        rateLimitResetCredits: {
          availableCount: 1,
          credits: [
            {
              id: "synthetic-gift",
              title: "Preview reset credit",
              status: "available",
              expiresAt: now + 86400 * (i === 1 ? 2 : i === 2 ? 0.5 : 4),
            },
          ],
        },
      },
    })),
  };
}
