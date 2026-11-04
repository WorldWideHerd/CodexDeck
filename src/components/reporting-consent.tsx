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

export function ReportingControl({ consent, fa, busy, onChoose }: Props) {
  return (
    <Button
      variant="outline"
      role="switch"
      aria-checked={consent !== false}
      disabled={busy}
      onClick={() => void onChoose(consent === false)}
    >
      {fa ? "ارسال آمار و خطاها" : "Send usage & error reports"}
      <span aria-hidden="true">
        {consent !== false ? (fa ? "روشن" : "On") : fa ? "خاموش" : "Off"}
      </span>
    </Button>
  );
}
