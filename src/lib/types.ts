export interface UsageWindow {
  usedPercent: number;
  windowDurationMins?: number | null;
  resetsAt?: number | null;
}
export interface RateLimitBucket {
  limitId?: string | null;
  limitName?: string | null;
  primary?: UsageWindow | null;
  secondary?: UsageWindow | null;
  planType?: string | null;
  credits?: {
    hasCredits?: boolean;
    unlimited?: boolean;
    balance?: string | null;
  } | null;
  individualLimit?: {
    remainingPercent?: number | null;
    resetsAt?: number | null;
  } | null;
}
export interface ResetCredit {
  id: string;
  status?: string | null;
  grantedAt?: number | null;
  expiresAt?: number | null;
  title?: string | null;
  description?: string | null;
}
export interface UsageSnapshot {
  rateLimits?: RateLimitBucket | null;
  rateLimitsByLimitId?: Record<string, RateLimitBucket> | null;
  rateLimitResetCredits?: {
    availableCount?: number | null;
    credits?: ResetCredit[] | null;
  } | null;
  accountId?: string | null;
}
export interface Account {
  id: string;
  label: string;
  email: string | null;
  plan: string | null;
  workspaceId: string | null;
  snapshot: UsageSnapshot | null;
  updatedAt: number | null;
  color: string | null;
  subscriptionEndsAt: number | null;
  alertThreshold: number | null;
  status:
    "idle" | "refreshing" | "signingIn" | "connected" | "needsLogin" | "failed";
  error: string | null;
}
export interface Settings {
  calendar: "persian" | "gregory";
  language: "fa" | "en";
  appearance: "system" | "light" | "dark";
  refreshMinutes: number;
  layout: "cards" | "list";
  sort: "manual" | "fiveHour" | "weekly" | "reset";
  pinned: boolean;
  // Missing/null uses the enabled default; false preserves a saved opt-out.
  reportingConsent?: boolean | null;
}
export interface AppState {
  accounts: Account[];
  settings: Settings;
  codexExecutable: string | null;
  lastError: string | null;
}
export interface LoginState {
  accountId: string;
  loginId: string | null;
  url: string | null;
  status: "pending" | "complete" | "cancelled" | "failed";
  error: string | null;
}
export interface PlatformCapabilities {
  platform: string;
  desktopSwitch: boolean;
  desktopRestore: boolean;
  reason: string | null;
}
export type AccountPatch = Partial<
  Pick<Account, "label" | "color" | "subscriptionEndsAt" | "alertThreshold">
>;

export interface WarmupJob {
  id: string;
  at: number | null;
  status: string;
  rows: {
    accountId: string;
    label: string;
    status: string;
    resetsAt: number | null;
  }[];
}

// Present only on the command response, never on background state events.
export interface RefreshResult extends AppState {
  refreshedIds?: string[];
}
