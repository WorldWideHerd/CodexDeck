import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountDetails } from "./account-details";
import { emptyState, syntheticState } from "@/lib/bridge";
import type { Account } from "@/lib/types";
function render(account: Account) {
  return renderToStaticMarkup(
    <AccountDetails
      account={account}
      settings={emptyState.settings}
      now={1000}
      fa={false}
      num={String}
      date={(v) => `date:${v}`}
      canEdit={false}
      onEdit={() => {}}
    />,
  );
}
describe("supplementary account information", () => {
  it("preserves individual limits and credits for each bucket", () => {
    const a = syntheticState().accounts[0];
    a.snapshot = {
      rateLimitsByLimitId: {
        codex: {
          limitName: "Codex",
          individualLimit: { remainingPercent: 42, resetsAt: 3000 },
          credits: { balance: "12.50" },
        },
        extra: { limitName: "Extra", credits: { unlimited: true } },
      },
    };
    const html = render(a);
    expect(html).toContain("Codex");
    expect(html).toContain("42%");
    expect(html).toContain("12.50");
    expect(html).toContain("Extra");
    expect(html).toContain("Unlimited");
  });
  it("uses the reported available count, preserving missing expiry and manual-date states", () => {
    const a = syntheticState().accounts[0];
    a.subscriptionEndsAt = null;
    a.snapshot = {
      rateLimitResetCredits: {
        availableCount: 7,
        credits: [{ id: "one", title: "Gift", expiresAt: null }],
      },
    };
    const html = render(a);
    expect(html).toMatch(/class="detail-count"[^>]*>7<\/span>/);
    expect(html).toContain("Expires: Unknown");
    expect(html).toContain("No date set");
  });
});
