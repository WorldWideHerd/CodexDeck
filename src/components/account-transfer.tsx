import { useQuietFeedback } from "@/hooks/use-quiet-feedback";
import { useState } from "react";
import { Download, Upload, LoaderCircle, Check } from "lucide-react";
import { bridge, native } from "@/lib/bridge";
import { presentError } from "@/lib/presentation";
import { Button } from "@/components/ui/button";

export function AccountTransfer({
  fa,
  busy,
  run,
}: {
  fa: boolean;
  busy: boolean;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
}) {
  const saved = useQuietFeedback();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const t = (f: string, e: string) => (fa ? f : e);
  const valid =
    [...password].length >= 10 &&
    new TextEncoder().encode(password).length <= 1024;
  async function transfer(importing: boolean) {
    saved.clear();
    setWorking(true);
    setMessage("");
    setFailed(false);
    await run(async () => {
      try {
        const report = await bridge.transfer(password, importing);
        if (report) {
          if (!importing) saved.confirm();
          setMessage(
            importing
              ? t(
                  `${report.imported} حساب اضافه شد؛ ${report.skipped} حساب تکراری حفظ شد. تنظیمات بازیابی شدند.`,
                  `${report.imported} accounts imported; ${report.skipped} existing accounts kept. Settings restored.`,
                )
              : t(
                  "خروجی کامل و رمزگذاری‌شده ذخیره شد.",
                  "Full encrypted archive saved.",
                ),
          );
          setPassword("");
          setConfirmation("");
        }
      } catch (error) {
        setFailed(true);
        setMessage(presentError(error, fa));
      }
    });
    setWorking(false);
  }
  return (
    <div className="account-transfer">
      <p>
        {t(
          "همهٔ حساب‌ها، اطلاعات ورود، تنظیمات، ترتیب کارت‌ها و داده‌های مصرف در فایل JSON رمزگذاری می‌شوند. رمز فایل را نگه دار؛ قابل بازیابی نیست.",
          "All accounts, sign-in credentials, settings, card order and usage data are encrypted in a JSON file. Keep the password; it cannot be recovered.",
        )}
      </p>
      <label>
        {t(
          "رمز فایل (حداقل ۱۰ نویسه)",
          "Archive password (at least 10 characters)",
        )}
        <input
          type="password"
          autoComplete="off"
          value={password}
          disabled={working || busy}
          onChange={(e) => setPassword(e.target.value)}
          dir="auto"
        />
      </label>
      <label>
        {t("تکرار رمز برای خروجی", "Confirm password for export")}
        <input
          type="password"
          autoComplete="off"
          value={confirmation}
          disabled={working || busy}
          onChange={(e) => setConfirmation(e.target.value)}
          dir="auto"
        />
      </label>
      <div className="settings-choices">
        <Button
          variant="ghost"
          disabled={
            !native || busy || working || !valid || confirmation !== password
          }
          onClick={() => void transfer(false)}
        >
          {working ? (
            <LoaderCircle className="animate-spin" />
          ) : saved.confirmed ? (
            <Check className="quiet-confirmation" />
          ) : (
            <Download />
          )}
          {t("خروجی JSON", "Export JSON")}
        </Button>
        <Button
          variant="ghost"
          disabled={!native || busy || working || !valid}
          onClick={() => void transfer(true)}
        >
          {working ? <LoaderCircle className="animate-spin" /> : <Upload />}
          {t("ورود JSON", "Import JSON")}
        </Button>
      </div>
      <p>
        {t(
          "ایمپورت حساب‌ها را ادغام و تنظیمات برنامه را از فایل بازیابی می‌کند؛ حساب‌های تکراری تغییر نمی‌کنند. مسیر Codex روی همین دستگاه حفظ می‌شود. ورودهای منقضی نیاز به ورود دوباره دارند.",
          "Import merges accounts and restores app settings; existing duplicate accounts stay unchanged. This device’s Codex path is kept. Expired sessions require sign-in again.",
        )}
      </p>
      {message && <p role={failed ? "alert" : "status"}>{message}</p>}
    </div>
  );
}
