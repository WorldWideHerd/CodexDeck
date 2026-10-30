import type { LoginState } from "./types";
import { loginForPresentation } from "./presentation";

export interface LoginLifecycle {
  generation: number;
  accountId: string | null;
  loginId: string | null;
  login: LoginState | null;
  terminal: boolean;
  retiredLoginIds: string[];
}
export const initialLoginLifecycle: LoginLifecycle = {
  generation: 0,
  accountId: null,
  loginId: null,
  login: null,
  terminal: false,
  retiredLoginIds: [],
};
export type LoginAction =
  | { type: "begin"; generation: number; accountId: string }
  | { type: "response"; generation: number; value: LoginState }
  | { type: "event"; value: LoginState }
  | { type: "cancelled"; generation: number; accountId: string }
  | { type: "dismiss" };

export function loginReducer(
  state: LoginLifecycle,
  action: LoginAction,
): LoginLifecycle {
  if (action.type === "begin") {
    const retiredLoginIds = state.loginId
      ? [...state.retiredLoginIds, state.loginId]
      : state.retiredLoginIds;
    return {
      generation: action.generation,
      accountId: action.accountId,
      loginId: null,
      login: null,
      terminal: false,
      retiredLoginIds: retiredLoginIds.slice(-32),
    };
  }
  if (action.type === "dismiss") return { ...state, login: null };
  if (action.type === "cancelled") {
    if (
      action.generation !== state.generation ||
      action.accountId !== state.accountId ||
      state.terminal
    )
      return state;
    return { ...state, terminal: true, login: null };
  }
  if (action.type === "response" && action.generation !== state.generation)
    return state;
  const value = action.value;
  if (value.loginId && state.retiredLoginIds.includes(value.loginId))
    return state;
  if (state.accountId !== value.accountId) return state;
  if (state.loginId && value.loginId && state.loginId !== value.loginId)
    return state;
  // Completion/cancellation/timeout is final for an attempt, regardless of whether
  // its pending command response or another pending event is still in flight.
  if (state.terminal) return state;
  const terminal = value.status !== "pending";
  return {
    ...state,
    terminal,
    loginId: value.loginId ?? state.loginId,
    login: loginForPresentation({ ...value, url: terminal ? null : value.url }),
  };
}
