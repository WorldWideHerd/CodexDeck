import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { bridge, native } from "@/lib/bridge";
import { presentError } from "@/lib/presentation";

export function NotificationSettingsLink({
  platform,
  fa,
  compact = false,
}: {
  platform: string;
  fa: boolean;
  compact?: boolean;
}) {
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  const supported = platform === "macos" || platform === "windows";
  return (
    <div className="notification-settings-link">
      {supported && (
        <Button
          variant={compact ? "ghost" : "outline"}
          disabled={!native || opening}
          onClick={async () => {
            setOpening(true);
            setFailed(false);
            try {
              await bridge.openNotificationSettings();
            } catch {
              setFailed(true);
            } finally {
              setOpening(false);
            }
          }}
        >
          <ArrowUpRight aria-hidden="true" />
          {opening
            ? fa
              ? "در حال باز کردن…"
              : "Opening…"
            : compact
              ? fa
                ? "تنظیمات اعلان سیستم"
                : "System notification settings"
              : fa
                ? "باز کردن تنظیمات اعلان سیستم"
                : "Open system notification settings"}
        </Button>
      )}
      {failed && (
        <p role="status">{presentError("notificationSettingsOpen", fa)}</p>
      )}
      {!supported && (
        <p>
          {fa
            ? "در تنظیمات سیستم، بخش اعلان‌ها، CodexDeck را انتخاب کنید."
            : "Open Notifications in system settings and select CodexDeck."}
        </p>
      )}
    </div>
  );
}
