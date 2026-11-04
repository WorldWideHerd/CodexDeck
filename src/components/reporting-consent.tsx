import { useState } from "react";
import { Button } from "@/components/ui/button";
import "./reporting-consent.css";

interface Props {
  consent?: boolean | null;
  fa: boolean;
  busy: boolean;
  onChoose: (enabled: boolean) => Promise<void>;
}

export function ReportingDetails({ fa }: { fa: boolean }) {
  return (
    <details className="reporting-details">
      <summary>{fa ? "چه چیزی ارسال می‌شود؟" : "What is shared?"}</summary>
      <p>
        {fa
          ? "وضعیت بازبودن اپ، نسخه و کد خطا با یک شناسهٔ موقت ارسال می‌شود؛ بدون اطلاعات اکانت یا متن گفتگو."
          : "We send app presence, version and error codes with a temporary ID, without account details or chat content."}
      </p>
      <p>
        {fa
          ? "آنلاین یعنی اپ باز است، حتی در پس‌زمینه. IP اتصال برای سرور قابل مشاهده است."
          : "Online means the app is running, including in the background. The server can see your connection IP."}
      </p>
    </details>
  );
}

export function ReportingConsent({ consent, fa, busy, onChoose }: Props) {
  const [saving, setSaving] = useState(false);
  if (consent != null) return null;
  const choose = async (enabled: boolean) => {
    setSaving(true);
    try {
      await onChoose(enabled);
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="reporting-consent" aria-labelledby="reporting-title">
      <div className="reporting-copy">
        <h2 id="reporting-title">
          {fa
            ? "به بهتر شدن CodexDeck کمک می‌کنید؟"
            : "Help improve CodexDeck?"}
        </h2>
        <p>
          {fa
            ? "با ارسال وضعیت آنلاین و کد خطاها به بهبود اپ کمک کنید. فقط با اجازهٔ شما؛ قابل خاموش‌کردن در تنظیمات."
            : "Help improve the app by sharing online status and error codes. Nothing is sent until you choose; turn it off anytime in Settings."}
        </p>
        <ReportingDetails fa={fa} />
      </div>
      <div className="reporting-actions">
        <Button
          size="sm"
          disabled={busy || saving}
          onClick={() => void choose(true)}
        >
          {fa ? "فعال‌کردن گزارش اختیاری" : "Enable optional reporting"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || saving}
          onClick={() => void choose(false)}
        >
          {fa ? "نه، ممنون" : "No thanks"}
        </Button>
      </div>
    </section>
  );
}

export function ReportingControl({ consent, fa, busy, onChoose }: Props) {
  return (
    <Button
      variant="outline"
      role="switch"
      aria-checked={consent === true}
      disabled={busy}
      onClick={() => void onChoose(consent !== true)}
    >
      {fa ? "گزارش اختیاری استفاده و خطا" : "Optional usage & error reporting"}
      <span aria-hidden="true">
        {consent === true ? (fa ? "روشن" : "On") : fa ? "خاموش" : "Off"}
      </span>
    </Button>
  );
}
