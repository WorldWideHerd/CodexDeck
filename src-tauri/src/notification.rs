//! Native permission checks and acknowledged enqueue; never assume desktop plugin permission is real.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Readiness {
    Ready,
    Silent,
    Quiet,
    SoundUnknown,
    Unverified,
    NotRequested,
    Denied,
    Unavailable,
    RequestFailed,
    AppChanged,
}
impl Readiness {
    pub fn can_send(self) -> bool {
        matches!(self, Self::Ready | Self::Silent | Self::SoundUnknown)
    }
    pub fn message(self) -> Option<&'static str> {
        match self{
        Self::Ready=>None,
        Self::AppChanged=>Some("notificationAppChanged"),
        Self::RequestFailed=>Some("notificationRequestFailed"),
        Self::Silent=>Some("Notifications are enabled, but sound is disabled in OS settings."),
        Self::Quiet=>Some("Visual notifications are disabled or provisional. Enable CodexDeck alerts and banners in OS notification settings before using quota alerts."),
        Self::SoundUnknown=>Some("Visual notifications are enabled, but sound readiness could not be verified."),
        Self::Unverified=>Some("Visual notification authorization cannot yet be verified on this platform. Quota alerts are unavailable in this build."),
        Self::NotRequested=>Some("Enable notification permission in OS settings before using quota alerts."),
        Self::Denied=>Some("OS notification permission is denied. Enable CodexDeck notifications in system settings and retry."),
        Self::Unavailable=>Some("Notification readiness could not be verified. Run the installed app in a desktop session and check OS notification settings."),
    }
    }
}
pub fn is_readiness_message(message: &str) -> bool {
    [
        Readiness::Ready,
        Readiness::Silent,
        Readiness::Quiet,
        Readiness::SoundUnknown,
        Readiness::Unverified,
        Readiness::NotRequested,
        Readiness::Denied,
        Readiness::Unavailable,
        Readiness::RequestFailed,
        Readiness::AppChanged,
    ]
    .into_iter()
    .any(|s| s.message() == Some(message))
}
/// Values are the public UserNotifications enum values, encoded by the C bridge.
#[cfg(any(test, target_os = "macos"))]
fn classify_macos(auth: i32, alert: i32, style: i32, sound: i32, center: i32) -> Readiness {
    match auth {
        0 => Readiness::NotRequested,
        1 => Readiness::Denied,
        2 => {
            if alert != 2 || style == 0 || center != 2 {
                Readiness::Quiet
            } else {
                match sound {
                    2 => Readiness::Ready,
                    1 => Readiness::Silent,
                    _ => Readiness::SoundUnknown,
                }
            }
        }
        3 => Readiness::Quiet,
        _ => Readiness::Unavailable,
    }
}
#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use std::{
        collections::HashMap,
        ffi::CString,
        sync::{
            atomic::{AtomicU64, Ordering},
            Mutex, OnceLock,
        },
        time::Duration,
    };
    use tokio::sync::oneshot;
    type Sender = oneshot::Sender<i32>;
    static PENDING: OnceLock<Mutex<HashMap<u64, Sender>>> = OnceLock::new();
    static NEXT: AtomicU64 = AtomicU64::new(1);
    extern "C" {
        fn codexdeck_permission(request: bool, id: u64, callback: extern "C" fn(u64, i32));
        fn codexdeck_notify(
            title: *const std::ffi::c_char,
            body: *const std::ffi::c_char,
            id: u64,
            callback: extern "C" fn(u64, i32),
        );
    }
    extern "C" fn completed(id: u64, status: i32) {
        if let Some(sender) = PENDING
            .get_or_init(Default::default)
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&id)
        {
            let _ = sender.send(status);
        }
    }
    struct Registration(u64);
    impl Drop for Registration {
        fn drop(&mut self) {
            PENDING
                .get_or_init(Default::default)
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&self.0);
        }
    }
    async fn result(start: impl FnOnce(u64)) -> Option<i32> {
        let id = NEXT.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        PENDING
            .get_or_init(Default::default)
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id, tx);
        let _registration = Registration(id);
        start(id);
        let result = tokio::time::timeout(Duration::from_secs(30), rx)
            .await
            .ok()
            .and_then(Result::ok);
        PENDING
            .get_or_init(Default::default)
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&id);
        result
    }
    pub async fn permission(request: bool) -> Readiness {
        match result(|id| unsafe { codexdeck_permission(request, id, completed) }).await {
            Some(code) if code & 0x1000 != 0 => classify_macos(
                code & 7,
                (code >> 3) & 3,
                (code >> 7) & 3,
                (code >> 5) & 3,
                (code >> 9) & 3,
            ),
            Some(6) => Readiness::RequestFailed,
            Some(7) => Readiness::AppChanged,
            _ => Readiness::Unavailable,
        }
    }
    pub async fn send(title: &str, body: &str) -> Result<(), String> {
        let title = CString::new(title).map_err(|_| "Invalid notification title.".to_string())?;
        let body = CString::new(body).map_err(|_| "Invalid notification body.".to_string())?;
        match result(|id| unsafe { codexdeck_notify(title.as_ptr(), body.as_ptr(), id, completed) })
            .await
        {
            Some(0) => Ok(()),
            Some(7) => Err("notificationAppChanged".into()),
            _ => Err(
                "The OS did not accept the quota notification. Check notification permissions."
                    .into(),
            ),
        }
    }
}
#[cfg(target_os = "linux")]
mod platform {
    use super::*;
    pub async fn permission(_request: bool) -> Readiness {
        match tokio::task::spawn_blocking(notify_rust::get_server_information).await {
            Ok(Ok(_)) => Readiness::Unverified,
            _ => Readiness::Unavailable,
        }
    }
    pub async fn send(title: &str, body: &str) -> Result<(), String> {
        let title = title.to_owned();
        let body = body.to_owned();
        tokio::task::spawn_blocking(move || {
            notify_rust::Notification::new()
                .summary(&title)
                .body(&body)
                .show()
                .map(|_| ())
                .map_err(|_| {
                    "The desktop notification server did not accept the quota alert.".to_string()
                })
        })
        .await
        .map_err(|_| "The notification service stopped.".to_string())?
    }
}
#[cfg(windows)]
mod platform {
    use super::*;
    use windows::{
        core::HSTRING,
        Data::Xml::Dom::XmlDocument,
        UI::Notifications::{NotificationSetting, ToastNotification, ToastNotificationManager},
    };
    fn notifier() -> windows::core::Result<windows::UI::Notifications::ToastNotifier> {
        ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from("com.codexdeck.desktop"))
    }
    pub async fn permission(_request: bool) -> Readiness {
        match notifier().and_then(|n| n.Setting()) {
            Ok(setting) if setting == NotificationSetting::Enabled => Readiness::Unverified,
            Ok(_) => Readiness::Denied,
            Err(_) => Readiness::Unavailable,
        }
    }
    fn escape(s: &str) -> String {
        s.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
            .replace('\'', "&apos;")
    }
    pub async fn send(title: &str, body: &str) -> Result<(), String> {
        (||->windows::core::Result<()>{let xml=XmlDocument::new()?;xml.LoadXml(&HSTRING::from(format!("<toast><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text></binding></visual></toast>",escape(title),escape(body))))?;let toast=ToastNotification::CreateToastNotification(&xml)?;notifier()?.Show(&toast)})().map_err(|_|"Windows did not accept the quota notification. Check app notification settings.".into())
    }
}
#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
mod platform {
    use super::*;
    pub async fn permission(_: bool) -> Readiness {
        Readiness::Unavailable
    }
    pub async fn send(_: &str, _: &str) -> Result<(), String> {
        Err("Notifications are unsupported on this platform.".into())
    }
}
pub use platform::{permission, send};
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn granular_macos_status_matrix() {
        assert_eq!(classify_macos(0, 0, 0, 0, 0), Readiness::NotRequested);
        assert_eq!(classify_macos(1, 2, 1, 2, 2), Readiness::Denied);
        assert_eq!(classify_macos(2, 2, 1, 2, 2), Readiness::Ready);
        assert_eq!(classify_macos(2, 2, 1, 1, 2), Readiness::Silent);
        assert_eq!(classify_macos(2, 2, 1, 0, 2), Readiness::SoundUnknown);
        for (auth, alert, style, center) in [
            (2, 1, 1, 2),
            (2, 2, 0, 2),
            (2, 2, 1, 1),
            (3, 2, 1, 2),
            (7, 2, 1, 2),
        ] {
            assert!(!classify_macos(auth, alert, style, 2, center).can_send());
        }
        assert!(!Readiness::Unverified.can_send());
        assert!(!Readiness::Quiet.can_send());
    }
    #[test]
    fn denied_and_unknown_are_not_deliverable() {
        for status in [
            Readiness::Denied,
            Readiness::NotRequested,
            Readiness::Unavailable,
            Readiness::AppChanged,
        ] {
            assert!(!status.can_send());
            assert!(status.message().is_some());
        }
        assert!(Readiness::Ready.can_send());
    }
}

/// Preserve the existing lock-screen privacy policy; localize only the quota.
pub fn quota_body(remaining: f64, fa: bool) -> String {
    let percent = format!("{:.0}", remaining.floor());
    if fa {
        let localized: String = percent
            .chars()
            .map(|c| match c {
                '0'..='9' => char::from_u32('۰' as u32 + c as u32 - '0' as u32).unwrap(),
                _ => c,
            })
            .collect();
        format!("سهمیهٔ پنج‌ساعته {}٪ باقی مانده است.", localized)
    } else {
        format!("Five-hour quota has {}% remaining.", percent)
    }
}
#[cfg(test)]
mod quota_body_tests {
    #[test]
    fn localizes_percent_without_account_identity() {
        assert!(super::quota_body(9.9, false).contains("Five-hour quota has 9%"));
        assert!(super::quota_body(9.9, true).contains("سهمیهٔ پنج‌ساعته ۹٪"));
    }
}

pub fn take_delivery_error(issue: &mut Option<(String, String)>, id: &str) -> Option<String> {
    if issue.as_ref().is_some_and(|(owner, _)| owner == id) {
        issue.take().map(|(_, message)| message)
    } else {
        None
    }
}
#[cfg(test)]
mod delivery_tests {
    #[test]
    fn successful_other_account_does_not_clear_latest_failure() {
        let mut issue = Some(("second".into(), "send failed".into()));
        assert!(super::take_delivery_error(&mut issue, "first").is_none());
        assert!(issue.is_some());
        assert_eq!(
            super::take_delivery_error(&mut issue, "second").as_deref(),
            Some("send failed")
        );
        assert!(issue.is_none());
    }
}

/// Update permission notices without clearing unrelated account/delivery failures.
pub fn reconcile_notice(current: &mut Option<String>, readiness: Readiness) {
    if current.as_deref().is_none_or(is_readiness_message) {
        *current = readiness.message().map(str::to_owned);
    }
}
#[cfg(test)]
mod notice_tests {
    use super::*;
    #[test]
    fn recheck_clears_stale_permission_and_preserves_unrelated_failure() {
        for status in [
            Readiness::Denied,
            Readiness::Unavailable,
            Readiness::RequestFailed,
            Readiness::AppChanged,
            Readiness::Quiet,
        ] {
            let mut notice = status.message().map(str::to_owned);
            reconcile_notice(&mut notice, Readiness::Ready);
            assert_eq!(notice, None);
        }
        let mut notice = Some("Account refresh failed".into());
        reconcile_notice(&mut notice, Readiness::Ready);
        assert_eq!(notice.as_deref(), Some("Account refresh failed"));
        reconcile_notice(&mut notice, Readiness::Denied);
        assert_eq!(notice.as_deref(), Some("Account refresh failed"));
    }
}
