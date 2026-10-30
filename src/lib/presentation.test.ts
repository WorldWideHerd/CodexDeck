import { describe, it, expect } from "vitest";
import {
  errorCode,
  presentError,
  capabilityMessage,
  stateForPresentation,
  loginForPresentation,
} from "./presentation";
import { emptyState, syntheticState } from "./bridge";
const unsupported = {
  platform: "macos",
  desktopSwitch: false,
  desktopRestore: true,
  reason: "Internal XPC broker ACL implementation details",
};
describe("safe localized presentation", () => {
  it("presents expired login in Persian and English", () => {
    const message = "Your sign-in expired. Sign in again.";
    expect(errorCode(message)).toBe("loginExpired");
    expect(presentError(message, true)).toBe(
      "ورود حساب منقضی شده است. دوباره وارد شوید.",
    );
    expect(presentError(message, false)).toBe(message);
  });
  it("presents missing CLI with an actionable settings instruction", () => {
    const message =
      "Codex CLI was not found. Choose its executable in settings.";
    expect(presentError(message, true)).toContain("تنظیمات");
    expect(presentError(message, false)).toContain("Settings");
    expect(errorCode("The selected Codex executable is unavailable.")).toBe(
      "cliMissing",
    );
  });
  it("replaces unknown technical capability reasons with product language", () => {
    expect(capabilityMessage(unsupported, true)).toContain("مک");
    expect(
      capabilityMessage({ ...unsupported, reason: null }, false),
    ).toContain("macOS");
    expect(capabilityMessage(unsupported, false)).not.toMatch(/XPC|broker|ACL/);
    expect(
      capabilityMessage(
        { ...unsupported, desktopSwitch: true, desktopRestore: true },
        true,
      ),
    ).toContain("حساب پنجرهٔ اصلی");
    expect(
      capabilityMessage({ ...unsupported, reason: "desktopMissing" }, false),
    ).toContain("Applications");
  });
  it("uses a fixed fallback without echoing raw values or object details", () => {
    expect(presentError("arbitrary value /private/account-data", true)).toBe(
      presentError(null, true),
    );
    expect(presentError(new Error("unknown raw error"), false)).not.toContain(
      "unknown raw error",
    );
    expect(errorCode({ message: "Your sign-in expired." })).toBe("unknown");
  });
  it("discards raw errors before they are retained in application state", () => {
    const account = syntheticState().accounts[0];
    const state = stateForPresentation({
      ...emptyState,
      lastError: "private raw failure",
      accounts: [{ ...account, error: "Your sign-in expired. Sign in again." }],
    });
    expect(state.lastError).toBe("unknown");
    expect(state.accounts[0].error).toBe("loginExpired");
    expect(JSON.stringify(state)).not.toContain("private raw failure");
    expect(
      loginForPresentation({
        accountId: "a",
        loginId: null,
        url: null,
        status: "failed",
        error: "private raw failure",
      }).error,
    ).toBe("unknown");
  });
  it("supports notification permission and readiness messages through the same presenter", () => {
    expect(
      presentError(
        "OS notification permission is denied. Enable CodexDeck notifications in system settings and retry.",
        true,
      ),
    ).toContain("اجازه اعلان");
    expect(
      errorCode(
        "Notifications are enabled, but sound is disabled in OS settings.",
      ),
    ).toBe("notificationSilent");
    expect(errorCode("Notification readiness could not be verified.")).toBe(
      "notificationUnavailable",
    );
  });
});

describe("archive error privacy", () => {
  it("explains password, compatibility and cleanup failures in both languages", () => {
    for (const code of [
      "transferDecrypt",
      "transferVersion",
      "transferCredentials",
      "transferCleanup",
      "transferFile",
    ] as const) {
      expect(errorCode(code)).toBe(code);
      expect(presentError(code, true)).not.toBe(presentError(code, false));
      expect(presentError(code, false)).not.toContain("synthetic-refresh");
    }
    expect(presentError("transferDecrypt", false)).toContain("password");
    expect(presentError("transferCleanup", false)).toContain(
      "Existing accounts were preserved",
    );
  });
});

it("distinguishes blocked banners and uncertain delivery from permission denial", () => {
  expect(errorCode("Visual notifications are disabled or provisional.")).toBe(
    "notificationQuiet",
  );
  expect(
    presentError("Visual notifications are disabled or provisional.", false),
  ).toContain("disabled");
  expect(
    errorCode(
      "Quota notification could not be confirmed. Check OS permissions; the next refresh will retry.",
    ),
  ).toBe("notificationDelivery");
});

it("explains native switch authorization and recovery without exposing credential details", () => {
  expect(presentError("desktopCancelled", true)).toContain("حساب تغییر نکرد");
  expect(presentError("desktopRecovery", false)).toContain(
    "backup is preserved",
  );
  expect(presentError("desktopBroker", true)).toContain("امضاشده");
  expect(presentError("desktopActive", false)).toContain("restore");
});
