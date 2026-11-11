import type { AppState, LoginState, PlatformCapabilities } from "./types";

// Only allowlisted summaries reach the UI. Never echo or persist native error text.
const messages = {
  desktopNoBackup: [
    "پشتیبانی برای بازگردانی حساب قبلی وجود ندارد. پس از تغییر حساب، این گزینه قابل استفاده است.",
    "There is no previous-account backup. This action becomes usable after switching an account.",
  ],
  desktopBroker: [
    "ویجت را از منو کامل ببند و نسخهٔ جدید امضاشدهٔ مک را دوباره اجرا کن.",
    "Quit CodexDeck from its menu and reopen the latest signed Mac build.",
  ],
  desktopBusy: [
    "تغییر حساب در جریان است؛ تا پایان عملیات صبر کن.",
    "An account change is in progress. Wait for it to finish.",
  ],
  desktopOtherWidget: [
    "نسخهٔ قدیمی ویجت را کامل ببند، سپس دوباره تغییر حساب را انجام بده.",
    "Quit the older Swift widget before switching the original app account.",
  ],
  desktopRecovery: [
    "بازیابی قبلی کامل نشده؛ از تنظیمات، «بازیابی حساب اصلی دسکتاپ» را بزن. پشتیبان ورود قبلی حفظ شده است.",
    "Recovery is incomplete. Use Restore original desktop account in Settings. The previous login backup is preserved.",
  ],
  desktopReview: [
    "پشتیبان قبلی به بررسی نیاز دارد. از تنظیمات، «بازیابی حساب اصلی دسکتاپ» را بزن.",
    "The previous backup needs review. Use Restore original desktop account in Settings.",
  ],
  desktopStorage: [
    "روش نگهداری ورود یا محدودیت‌های اپ اصلی پشتیبانی نمی‌شود. حساب اصلی تغییر نکرده است.",
    "The original app’s credential storage or login restrictions are unsupported. Its account was not changed.",
  ],
  desktopQuit: [
    "Codex یا تسک‌های آن هنوز باز است. کارها را ذخیره کن، Codex و تسک‌هایش را ببند و دوباره تلاش کن.",
    "Codex or its tasks are still running. Save your work, close Codex and its tasks, then retry.",
  ],
  desktopChanged: [
    "ورود اپ اصلی بیرون از ویجت تغییر کرده است. این حساب را دوباره متصل کن.",
    "The original app’s sign-in changed outside CodexDeck. Reconnect this account.",
  ],
  desktopCancelled: [
    "تأیید لغو شد؛ حساب تغییر نکرد.",
    "Authorization was cancelled. The account was not changed.",
  ],
  transferCancelled: [
    "تأیید لغو شد؛ فایل خروجی ذخیره نشد.",
    "Authorization was cancelled. No export was saved.",
  ],
  desktopAuthorization: [
    "تأیید هویت انجام نشد. Touch ID یا رمز ورود مک را بررسی و دوباره تلاش کن.",
    "Authentication did not complete. Check Touch ID or your Mac password and retry.",
  ],
  desktopVerification: [
    "تأیید حساب کامل نشد. اتصال و ورود حساب را بررسی و دوباره تلاش کن.",
    "Account verification did not complete. Check the connection and sign-in, then retry.",
  ],
  desktopActive: [
    "این حساب در اپ اصلی فعال است. ابتدا حساب دیگری را در Codex فعال کن یا از تنظیمات حساب قبلی را بازیابی کن.",
    "This account is active in the original app. Switch to another account or restore the previous one in Settings first.",
  ],
  desktopActiveTransfer: [
    "برای انتقال حساب‌ها، ابتدا از تنظیمات حساب قبلی Codex را بازیابی کن تا آخرین ورود در نسخهٔ پشتیبان قرار بگیرد.",
    "Restore the previous Codex account in Settings before transferring accounts, so the archive includes the latest saved sign-in.",
  ],

  desktopMissing: [
    "برنامهٔ رسمی Codex را نصب کنید (در مک داخل Applications)، سپس CodexDeck را دوباره باز کنید.",
    "Install the official Codex app (in Applications on macOS), then restart CodexDeck.",
  ],
  desktopUnsupported: [
    "تغییر حساب Codex در مک و ویندوز در دسترس است.",
    "Codex account switching is available on macOS and Windows.",
  ],
  desktopLaunch: [
    "پنجرهٔ Codex باز نشد. نصب برنامه و دسترسی‌های آن را بررسی و دوباره تلاش کنید.",
    "The Codex window could not be opened. Check the installed app and its permissions, then retry.",
  ],
  desktopConfig: [
    "تنظیمات Codex این حساب قابل آماده‌سازی نیست. فایل تنظیمات حساب را بررسی کنید؛ اطلاعات ورود تغییر نکرد.",
    "This account’s Codex settings could not be prepared. Check its configuration file. Credentials were not changed.",
  ],
  desktopNeedsLogin: [
    "ابتدا این حساب را دوباره متصل و اطلاعات آن را تازه‌سازی کنید.",
    "Reconnect this account and refresh its information first.",
  ],
  desktopCloseFirst: [
    "ابتدا پنجرهٔ مستقل Codex این حساب را با Quit ببندید، سپس دوباره تلاش کنید.",
    "Quit this account’s separate Codex instance, then retry.",
  ],
  projectsCloseApp: [
    "برنامهٔ اصلی Codex را با ⌘Q ببند، سپس دوباره تلاش کن.",
    "Quit the original Codex app with ⌘Q, then retry.",
  ],
  projectsNoAccount: [
    "ابتدا در برنامهٔ اصلی Codex به حساب مقصد وارد شو و برنامه را ببند.",
    "Sign in to the destination account in the original Codex app, then quit it.",
  ],
  projectsNoSource: [
    "یک فهرست مبدأ مشخص پیدا نشد. حساب قبلی باید فهرست پروژه‌های محلی ذخیره‌شده داشته باشد.",
    "No single source list was found. A previous account needs a saved local project list.",
  ],
  projectsChanged: [
    "فهرست Codex هنگام کپی تغییر کرد. برنامهٔ اصلی را ببند و دوباره تلاش کن.",
    "Codex project settings changed during the copy. Quit the original app and retry.",
  ],
  projectsCopyFailed: [
    "کپی فهرست پروژه‌ها کامل نشد. نسخهٔ Codex و پوشه‌ها را بررسی کن و دوباره تلاش کن.",
    "The project copy did not finish. Check the Codex version and project folders, then retry.",
  ],
  transferInvalid: [
    "فایل انتقال نامعتبر یا ناقص است؛ حساب‌ها تغییر نکردند.",
    "The archive is invalid or incomplete. Accounts were not changed.",
  ],
  transferVersion: [
    "نسخه یا قابلیت‌های این فایل پشتیبانی نمی‌شود؛ برنامه را به‌روز کنید.",
    "This archive version or its required features are unsupported. Update the app.",
  ],
  transferPassword: [
    "رمز فایل باید بین ۱۰ نویسه و ۱۰۲۴ بایت باشد.",
    "Use an archive password of at least 10 characters and at most 1024 bytes.",
  ],
  transferDecrypt: [
    "رمز اشتباه است یا فایل دست‌کاری شده؛ حساب‌ها تغییر نکردند.",
    "The password is incorrect or the file was altered. Accounts were not changed.",
  ],
  transferCredentials: [
    "اطلاعات ورود یک حساب موجود نیست یا با هویت آن مطابقت ندارد. حساب را دوباره متصل کنید؛ خروجی ناقص ساخته نمی‌شود.",
    "An account’s credentials are missing or do not match its identity. Reconnect it; incomplete archives are not created.",
  ],
  transferFile: [
    "خواندن یا ذخیره فایل انجام نشد؛ مسیر و دسترسی را بررسی کنید.",
    "The archive could not be read or saved. Check the location and permissions.",
  ],
  transferFailed: [
    "انتقال کامل نشد. دوباره تلاش کنید.",
    "The transfer could not be completed. Retry.",
  ],
  transferCleanup: [
    "ایمپورت کامل نشد و پاک‌سازی اطلاعات ورود موقت با خطا روبه‌رو شد. حساب‌های قبلی حفظ شدند؛ دسترسی مخزن امن را بررسی کنید.",
    "Import failed and temporary credential cleanup was incomplete. Existing accounts were preserved. Check secure store access.",
  ],
  unknown: [
    "عملیات انجام نشد. دوباره تلاش کنید؛ اگر مشکل ادامه داشت برنامه را باز و بسته کنید.",
    "The action could not be completed. Retry, or restart the app if the problem continues.",
  ],
  loginExpired: [
    "ورود حساب منقضی شده است. دوباره وارد شوید.",
    "Your sign-in expired. Sign in again.",
  ],
  cliMissing: [
    "Codex CLI پیدا نشد یا قابل اجرا نیست. فایل اجرایی آن را در تنظیمات انتخاب کنید.",
    "Codex CLI is missing or cannot run. Choose its executable in Settings.",
  ],
  credentialStore: [
    "ذخیره‌ساز امن سیستم در دسترس نیست یا قفل است. آن را فعال کنید و دوباره تلاش کنید.",
    "The system credential store is unavailable or locked. Enable it and retry.",
  ],
  access: [
    "دسترسی حساب به فضای کار را بررسی کنید.",
    "Check account and workspace access.",
  ],
  rateLimit: [
    "درخواست‌ها بیش از حد شده‌اند. کمی بعد دوباره تلاش کنید.",
    "Too many requests. Try again later.",
  ],
  connection: [
    "اطلاعات حساب دریافت نشد. اتصال اینترنت را بررسی و دوباره تلاش کنید.",
    "Account information could not be read. Check your connection and retry.",
  ],
  timeout: [
    "زمان انتظار تمام شد. اتصال را بررسی و دوباره تلاش کنید.",
    "The request timed out. Check your connection and retry.",
  ],
  pendingLogin: [
    "ابتدا ورود در حال انجام را تکمیل یا لغو کنید.",
    "Finish or cancel the pending sign-in first.",
  ],
  noLogin: [
    "ورودی در حال انجام نیست. دوباره ورود به حساب را شروع کنید.",
    "No sign-in is pending. Start signing in again.",
  ],
  loginFailed: [
    "ورود کامل نشد. دوباره ورود به حساب را شروع کنید.",
    "Sign-in did not complete. Start signing in again.",
  ],
  browser: [
    "مرورگر باز نشد. دوباره دکمه ورود را بزنید یا لینک ورود را کپی کنید.",
    "The browser could not open. Retry the sign-in button or copy the sign-in link.",
  ],
  unsafeLogin: [
    "لینک ورود تأیید نشد. Codex CLI را به‌روز و دوباره وارد شوید.",
    "The sign-in link could not be verified. Update Codex CLI and retry sign-in.",
  ],
  duplicate: [
    "این حساب و فضای کار قبلاً متصل شده‌اند. با حساب دیگری وارد شوید.",
    "This account and workspace are already connected. Use another sign-in.",
  ],
  workspaceMismatch: [
    "فضای کار واردشده با فضای کار این حساب مطابقت ندارد. ورود را بررسی کنید.",
    "The signed-in workspace does not match this account. Check your sign-in.",
  ],
  chatgptRequired: [
    "برای دریافت سهمیه اشتراک، با حساب ChatGPT وارد شوید.",
    "Sign in with a ChatGPT account to read subscription quotas.",
  ],
  updateCli: [
    "پاسخ سهمیه پشتیبانی نمی‌شود. Codex CLI را به‌روز کنید و دوباره تلاش کنید.",
    "This quota response is unsupported. Update Codex CLI and retry.",
  ],
  invalidInput: [
    "اطلاعات واردشده معتبر نیست. نام حساب و تنظیمات را بررسی کنید.",
    "The entered information is invalid. Check the account name and settings.",
  ],
  accountMissing: [
    "حساب پیدا نشد. فهرست حساب‌ها را به‌روز کنید.",
    "Account not found. Refresh the account list.",
  ],
  storage: [
    "ذخیره یا خواندن تنظیمات انجام نشد. دسترسی برنامه به پوشه داده‌ها را بررسی کنید.",
    "Settings could not be read or saved. Check the app data folder permissions.",
  ],
  metadata: [
    "اطلاعات ذخیره‌شده قابل خواندن نیست. از نسخه پشتیبان معتبر بازیابی کنید.",
    "Saved metadata cannot be read. Restore a known-good backup.",
  ],
  newerBuild: [
    "برای خواندن اطلاعات ذخیره‌شده، نسخه جدیدتر CodexDeck لازم است.",
    "A newer CodexDeck version is required to read the saved metadata.",
  ],
  removeFiles: [
    "خروج انجام شد، اما حذف فایل‌های حساب کامل نشد. حذف حساب را دوباره انجام دهید.",
    "Signed out, but account files could not be removed. Retry removal.",
  ],
  pin: [
    "ثابت نگه‌داشتن پنجره انجام نشد. دوباره تلاش کنید.",
    "The window could not be pinned. Retry.",
  ],
  desktopOnly: [
    "این عملیات در برنامه دسکتاپ در دسترس است.",
    "Open the desktop app to use this action.",
  ],
  notificationDelivery: [
    "ارسال اعلان تأیید نشد؛ تنظیمات اعلان سیستم را بررسی کنید. هشدار سهمیه در دریافت بعدی دوباره تلاش می‌شود و ممکن است اعلان دیرتر برسد.",
    "Notification submission was not confirmed. Check system settings. Quota alerts retry on the next refresh; a delayed notification may still arrive.",
  ],
  notificationPermission: [
    "اجازه اعلان‌های CodexDeck را در تنظیمات سیستم فعال کنید و دوباره تلاش کنید.",
    "Enable CodexDeck notifications in system settings and retry.",
  ],
  notificationAppChanged: [
    "نسخهٔ اجراشده معتبر نیست یا هنگام اجرا تغییر کرده است. برنامه را کامل ببندید و نسخهٔ جدید را از پوشهٔ output اجرا کنید.",
    "The running app identity is invalid or changed during use. Quit the app and open the new version from the output folder.",
  ],
  notificationRequestFailed: [
    "درخواست اجازهٔ اعلان در مک انجام نشد. برنامه را کامل ببندید و نسخهٔ امضاشدهٔ جدید را اجرا کنید؛ روشن بودن اعلان نسخهٔ قبلی برای این نسخه کافی نیست.",
    "macOS could not request notification permission. Quit and run the new signed app; permission for the older app does not apply to this version.",
  ],
  notificationSettingsOpen: [
    "تنظیمات باز نشد. از تنظیمات سیستم، بخش اعلان‌ها را باز و CodexDeck را انتخاب کنید.",
    "Could not open settings. Open Notifications in system settings and select CodexDeck.",
  ],
  notificationUnavailable: [
    "وضعیت اعلان‌ها مشخص نیست. در تنظیمات اعلان سیستم، CodexDeck را بررسی کنید. اگر در فهرست نیست، نسخهٔ نصب‌شده را اجرا و یک اعلان آزمایشی ارسال کنید.",
    "Notification status is unknown. Check CodexDeck in system notification settings. If it is missing, run the installed app and send a test notification.",
  ],
  notificationSoundUnknown: [
    "اعلان‌ها فعال‌اند؛ وضعیت صدا از داخل برنامه قابل بررسی نیست.",
    "Notifications are enabled; the app cannot verify the sound setting.",
  ],
  notificationWindowsReadinessFailed: [
    "ویندوز وضعیت اعلان CodexDeck را برنگرداند. تست اعلان را بزنید تا ارسال مستقیم بررسی شود.",
    "Windows could not return CodexDeck notification status. Send a test notification to check submission directly.",
  ],
  notificationWindowsSendFailed: [
    "ویندوز اعلان آزمایشی را نپذیرفت. کد خطا را برای بررسی ارسال کنید.",
    "Windows did not accept the notification. Share the error code for diagnosis.",
  ],
  notificationWindowsSubmittedUnverified: [
    "وضعیت اعلان هنوز قابل بررسی نیست؛ نمایش آن را در مرکز اعلان‌های ویندوز بررسی کنید.",
    "Notification status is still unverified; check for the notification in Windows Notification Center.",
  ],
  notificationSilent: [
    "اعلان‌ها فعال‌اند، اما صدای آن‌ها در تنظیمات سیستم خاموش است.",
    "Notifications are enabled, but sound is disabled in system settings.",
  ],
  notificationQuiet: [
    "نمایش اعلان‌ها غیرفعال یا محدود است؛ بنرهای CodexDeck را در تنظیمات سیستم فعال کنید.",
    "Visual notifications are disabled or restricted. Enable CodexDeck banners in system settings.",
  ],
} as const;
export type ErrorCode = keyof typeof messages;

export function errorCode(error: unknown): ErrorCode {
  const text =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : "";
  if (Object.hasOwn(messages, text)) return text as ErrorCode;
  const windowsFailure =
    /^(notificationWindows(?:Readiness|Send)Failed):0x[0-9a-f]{8}$/i.exec(text);
  if (windowsFailure && Object.hasOwn(messages, windowsFailure[1]))
    return windowsFailure[1] as ErrorCode;

  const s = text.toLowerCase();
  if (
    s.includes("notification") &&
    (s.includes("could not be confirmed") ||
      s.includes("did not accept") ||
      s.includes("retry state"))
  )
    return "notificationDelivery";
  if (
    s.includes("visual notifications are disabled") ||
    s.includes("banner or sound")
  )
    return "notificationQuiet";
  if (
    s.includes("visual notifications are enabled") &&
    s.includes("sound readiness could not be verified")
  )
    return "notificationSoundUnknown";
  if (s.includes("sound is disabled")) return "notificationSilent";
  if (s.includes("banner or sound")) return "notificationQuiet";
  if (
    s.includes("notification") &&
    (s.includes("permission") ||
      s.includes("could not be delivered") ||
      s.includes("did not accept"))
  )
    return "notificationPermission";
  if (s.includes("notification")) return "notificationUnavailable";
  if (s.includes("sign-in expired") || s.includes("login expired"))
    return "loginExpired";
  if (
    s.includes("codex cli was not found") ||
    s.includes("executable") ||
    s.includes("could not start codex")
  ) {
    if (s.includes("finish or cancel")) return "pendingLogin";
    return "cliMissing";
  }
  if (s.includes("credential store")) return "credentialStore";
  if (s.includes("finish or cancel")) return "pendingLogin";
  if (s.includes("already connected")) return "duplicate";
  if (s.includes("does not match")) return "workspaceMismatch";
  if (s.includes("chatgpt account to read")) return "chatgptRequired";
  if (s.includes("unsupported quota response")) return "updateCli";
  if (s.includes("untrusted sign-in") || s.includes("invalid sign-in url"))
    return "unsafeLogin";
  if (
    s.includes("no sign-in is pending") ||
    s.includes("no sign-in url is available")
  )
    return "noLogin";
  if (
    s.includes("sign-in did not complete") ||
    s.includes("returned no sign-in")
  )
    return "loginFailed";
  if (s.includes("could not open your browser")) return "browser";
  if (s.includes("account and workspace access")) return "access";
  if (s.includes("too many requests")) return "rateLimit";
  if (s.includes("connection") || s.includes("disconnected"))
    return "connection";
  if (s.includes("timed out") || s.includes("timeout")) return "timeout";
  if (s.includes("account not found")) return "accountMissing";
  if (s.includes("metadata version requires")) return "newerBuild";
  if (
    (s.includes("invalid") && s.includes("metadata")) ||
    s.includes("metadata is too large")
  )
    return "metadata";
  if (s.includes("could not remove isolated")) return "removeFiles";
  if (s.includes("could not pin")) return "pin";
  if (
    s.includes("metadata") ||
    s.includes("app storage") ||
    s.includes("symbolic link")
  )
    return "storage";
  if (
    s.includes("invalid") ||
    s.includes("valid hex") ||
    s.includes("must contain") ||
    s.includes("unsupported app setting") ||
    s.includes("unsupported account setting")
  )
    return "invalidInput";
  if (s.includes("desktop app to use")) return "desktopOnly";
  return "unknown";
}
export function presentError(error: unknown, fa: boolean): string {
  const message = messages[errorCode(error)][fa ? 0 : 1];
  const text =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : "";
  const windowsFailure =
    /^notificationWindows(?:Readiness|Send)Failed:(0x[0-9a-f]{8})$/i.exec(text);
  return windowsFailure ? `${message} (${windowsFailure[1]})` : message;
}
export function capabilityMessage(
  caps: PlatformCapabilities,
  fa: boolean,
): string {
  if (!caps.desktopSwitch)
    return presentError(
      caps.reason === "desktopMissing"
        ? "desktopMissing"
        : caps.reason === "desktopBroker"
          ? "desktopBroker"
          : "desktopUnsupported",
      fa,
    );
  if (caps.platform === "windows")
    return fa
      ? "پیش از «استفاده در Codex»، کارها را ذخیره کن و Codex و تسک‌هایش را ببند. حساب تغییر می‌کند و Codex دوباره باز می‌شود. بازگردانی حساب قبلی از همین تنظیمات در دسترس است."
      : "Before Use in Codex, save your work and close Codex and its tasks. The account changes and Codex reopens. Restore the previous account here.";
  return fa
    ? "«استفاده در Codex» حساب پنجرهٔ اصلی را با تأیید Touch ID یا رمز مک تغییر می‌دهد و Codex را دوباره باز می‌کند. بازگردانی حساب قبلی از همین تنظیمات در دسترس است؛ پیش از تأیید کارهای باز را تمام کن."
    : "Use in Codex changes the original app’s account using Touch ID or your Mac password. Codex will close and reopen. Restore the previous account here; finish open work before approving.";
}

export const desktopSwitchPhases = {
  authorizing: [
    "تأیید با Touch ID یا رمز مک",
    "Confirm with Touch ID or Mac password",
  ],
  checkingAccount: ["بررسی حساب انتخابی", "Checking selected account"],
  checkingApp: ["بررسی Codex", "Checking Codex"],
  quitting: ["بستن Codex", "Closing Codex"],
  saving: ["پشتیبان‌گیری و تغییر حساب", "Backing up and changing account"],
  verifying: ["تأیید حساب جدید", "Verifying the new account"],
  opening: ["بازکردن دوبارهٔ Codex", "Reopening Codex"],
  recovering: ["بازگردانی حساب قبلی", "Restoring the previous account"],
  authorizingProjectCopy: [
    "تأیید با Touch ID یا رمز مک",
    "Confirm with Touch ID or Mac password",
  ],
  copyingProjects: ["کپی فهرست پروژه‌ها", "Copying the project list"],
};
export type DesktopSwitchPhase = keyof typeof desktopSwitchPhases;
export function desktopSwitchPhaseText(
  phase: DesktopSwitchPhase,
  fa: boolean,
): string {
  return desktopSwitchPhases[phase][fa ? 0 : 1];
}

export function stateForPresentation(state: AppState): AppState {
  return {
    ...state,
    lastError: state.lastError ? errorCode(state.lastError) : null,
    accounts: state.accounts.map((account) => ({
      ...account,
      error: account.error ? errorCode(account.error) : null,
    })),
  };
}
export function loginForPresentation(login: LoginState): LoginState {
  return { ...login, error: login.error ? errorCode(login.error) : null };
}

export function isNotificationError(error: unknown): boolean {
  return errorCode(error).startsWith("notification");
}
