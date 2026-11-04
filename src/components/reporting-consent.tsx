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
          ? "فقط وضعیت باز بودن برنامه، شناسهٔ موقت، نسخهٔ برنامه و کدهای مشخص خطای فنی. اطلاعات حساب، توکن، متن گفتگو، مسیر فایل و متن خام خطا ارسال نمی‌شود."
          : "Only app presence, a temporary identifier, app version, and predefined technical error codes. Account details, tokens, chats, file paths and raw error messages are not sent."}
      </p>
      <p>
        {fa
          ? "آمار آنلاین شامل برنامه‌های باز در پس‌زمینه هم هست و بر اساس پیام ۳ دقیقهٔ اخیر محاسبه می‌شود. آدرس IP هنگام اتصال برای زیرساخت قابل مشاهده است."
          : "Online counts include apps running in the background and use signals received in the last 3 minutes. Your IP address is visible to the infrastructure when connecting."}
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
            ? "اختیاری: تعداد برنامه‌های فعال و خطاهای فنی مشخص را به سرور CodexDeck بفرستید. تا انتخاب شما چیزی ارسال نمی‌شود؛ هر زمان از تنظیمات قابل تغییر است."
            : "Optionally share app presence and predefined technical errors with the CodexDeck server. Nothing is sent until you choose; you can change this in Settings anytime."}
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
