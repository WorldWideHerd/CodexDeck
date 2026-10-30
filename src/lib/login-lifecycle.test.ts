import { describe, it, expect, vi } from "vitest";
import {
  initialLoginLifecycle,
  loginReducer,
  type LoginAction,
} from "./login-lifecycle";
import type { LoginState } from "./types";
const pending: LoginState = {
  accountId: "a",
  loginId: "attempt-1",
  url: "https://example.invalid/synthetic-login",
  status: "pending",
  error: null,
};
function harness() {
  let state = initialLoginLifecycle;
  return {
    dispatch(action: LoginAction) {
      state = loginReducer(state, action);
    },
    get state() {
      return state;
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
describe("login event/command ordering", () => {
  it.each(["complete", "cancelled", "failed"] as const)(
    "does not reopen pending dialog when %s event precedes command resolution",
    async (status) => {
      const ui = harness();
      const command = deferred<LoginState>();
      const mockStartLogin = vi.fn(() => command.promise);
      ui.dispatch({ type: "begin", generation: 1, accountId: "a" });
      const inFlight = mockStartLogin().then((value) =>
        ui.dispatch({ type: "response", generation: 1, value }),
      );
      ui.dispatch({
        type: "event",
        value: {
          ...pending,
          status,
          error:
            status === "failed" ? "Your sign-in expired. Sign in again." : null,
        },
      });
      command.resolve(pending);
      await inFlight;
      expect(mockStartLogin).toHaveBeenCalledOnce();
      expect(ui.state.login?.status).toBe(status);
      expect(ui.state.login?.url).toBeNull();
      expect(ui.state.terminal).toBe(true);
      if (status === "failed")
        expect(ui.state.login?.error).toBe("loginExpired");
    },
  );
  it("does not reopen after a successful local cancellation when pending response arrives late", async () => {
    const ui = harness();
    const command = deferred<LoginState>();
    ui.dispatch({ type: "begin", generation: 1, accountId: "a" });
    const inFlight = command.promise.then((value) =>
      ui.dispatch({ type: "response", generation: 1, value }),
    );
    ui.dispatch({ type: "cancelled", generation: 1, accountId: "a" });
    command.resolve(pending);
    await inFlight;
    expect(ui.state.login).toBeNull();
    expect(ui.state.terminal).toBe(true);
  });
  it("ignores a pending event after completion and after dismissing a failure", () => {
    const ui = harness();
    ui.dispatch({ type: "begin", generation: 1, accountId: "a" });
    ui.dispatch({
      type: "event",
      value: { ...pending, status: "failed", error: "login expired" },
    });
    ui.dispatch({ type: "dismiss" });
    ui.dispatch({ type: "event", value: pending });
    expect(ui.state.login).toBeNull();
    expect(ui.state.terminal).toBe(true);
  });
  it("allows a fresh attempt but ignores previous command responses and retired events", () => {
    const ui = harness();
    ui.dispatch({ type: "begin", generation: 1, accountId: "a" });
    ui.dispatch({ type: "event", value: { ...pending, status: "complete" } });
    ui.dispatch({ type: "dismiss" });
    ui.dispatch({ type: "begin", generation: 2, accountId: "a" });
    ui.dispatch({ type: "response", generation: 1, value: pending });
    ui.dispatch({ type: "event", value: { ...pending, status: "failed" } });
    expect(ui.state.login).toBeNull();
    const next = { ...pending, loginId: "attempt-2" };
    ui.dispatch({ type: "response", generation: 2, value: next });
    expect(ui.state.login?.status).toBe("pending");
    ui.dispatch({ type: "event", value: { ...next, status: "complete" } });
    expect(ui.state.login?.status).toBe("complete");
  });
  it("ignores another account and cancellation from an older generation", () => {
    const ui = harness();
    ui.dispatch({ type: "begin", generation: 2, accountId: "a" });
    ui.dispatch({
      type: "event",
      value: { ...pending, accountId: "b", status: "failed" },
    });
    ui.dispatch({ type: "cancelled", generation: 1, accountId: "a" });
    ui.dispatch({ type: "response", generation: 2, value: pending });
    expect(ui.state.login?.status).toBe("pending");
  });
  it("accepts a normal pending response followed by terminal event with no login ID", () => {
    const ui = harness();
    ui.dispatch({ type: "begin", generation: 1, accountId: "a" });
    ui.dispatch({ type: "response", generation: 1, value: pending });
    ui.dispatch({
      type: "event",
      value: { ...pending, loginId: null, status: "cancelled", url: null },
    });
    expect(ui.state.terminal).toBe(true);
    expect(ui.state.loginId).toBe("attempt-1");
  });
});
