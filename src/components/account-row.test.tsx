import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountRow } from "./account-row";
import { syntheticState } from "@/lib/bridge";
import type { Account } from "@/lib/types";
const now = Date.now() / 1000;
function render(a: Account) {
  return renderToStaticMarkup(
    <AccountRow
      a={a}
      now={now}
      fa={false}
      refreshMinutes={3}
      busy={false}
      expanded={false}
      detailsId="details"
      onDetails={() => {}}
      onAlert={() => {}}
      caps={{
        platform: "browser",
        desktopSwitch: false,
        desktopRestore: false,
        reason: null,
      }}
      run={async () => true}
    />,
  );
}
describe("compact account usage", () => {
  it("keeps missing quota windows unknown", () => {
    const a = syntheticState().accounts[0];
    a.snapshot = null;
    const html = render(a);
    expect(html).toContain("No usage data");
    expect(html).not.toContain('role="progressbar"');
    expect(html).toContain('aria-controls="details"');
  });
  it("distinguishes cached quotas and required sign-in", () => {
    const a = syntheticState().accounts[0];
    a.status = "needsLogin";
    const html = render(a);
    expect(html).toContain("Sign in required");
    expect(html).toContain("is-cached");
    expect(html).not.toContain(">Connected<");
  });
  it("does not treat a passed reset time as replenished quota", () => {
    const a = syntheticState().accounts[0];
    a.snapshot = {
      rateLimits: {
        primary: {
          usedPercent: 100,
          windowDurationMins: 300,
          resetsAt: now - 60,
        },
      },
    };
    const html = render(a);
    expect(html).toContain("0%");
    expect(html).toContain("Awaiting reset confirmation");
  });
});

it("shows expiring reset credits even when details are closed", () => {
  const a = syntheticState().accounts[0];
  a.snapshot = {
    rateLimitResetCredits: {
      availableCount: 1,
      credits: [{ id: "gift", expiresAt: now + 3600 }],
    },
  };
  const html = render(a);
  expect(html).toContain("row-gift-warning");
  expect(html).toContain("Reset credit");
  expect(html).toContain(`Show details ${a.label}`);
});
