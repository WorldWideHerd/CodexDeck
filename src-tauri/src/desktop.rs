//! Signed, main-account switching via the unchanged Swift transaction and credential broker.
use std::path::{Path, PathBuf};
#[cfg(not(target_os = "macos"))]
pub const UNSUPPORTED: &str = "desktopUnsupported";

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn codexdeck_desktop_available() -> i32;
    fn codexdeck_desktop_active(home: *const std::ffi::c_char) -> i32;
    fn codexdeck_original_home(buffer: *mut u8, capacity: u32) -> i32;
    fn codexdeck_main_switch_ready() -> i32;
    fn codexdeck_main_switch_probe() -> i32;
    fn codexdeck_main_switch_status() -> i32;
    fn codexdeck_main_switch_request(
        request: *const std::ffi::c_char,
        key: u64,
        callback: extern "C" fn(u64, *const std::ffi::c_char),
    );
}

pub fn probe() -> bool {
    #[cfg(target_os = "macos")]
    unsafe {
        available() && codexdeck_main_switch_probe() == 0
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}
pub fn unavailable_reason() -> &'static str {
    #[cfg(target_os = "macos")]
    unsafe {
        if codexdeck_desktop_available() != 1 {
            "desktopMissing"
        } else {
            "desktopBroker"
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        UNSUPPORTED
    }
}
pub fn available() -> bool {
    #[cfg(target_os = "macos")]
    unsafe {
        codexdeck_desktop_available() == 1 && codexdeck_main_switch_ready() == 1
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

pub fn original_home() -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        let mut buffer = [0u8; 16384];
        if unsafe { codexdeck_original_home(buffer.as_mut_ptr(), buffer.len() as u32) } != 0 {
            return Err("desktopMissing".into());
        }
        let path = std::ffi::CStr::from_bytes_until_nul(&buffer)
            .map_err(|_| "desktopMissing")?
            .to_str()
            .map_err(|_| "desktopMissing")?;
        Ok(PathBuf::from(path).join(".codex"))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(UNSUPPORTED.into())
    }
}
pub fn require_recovered() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    match unsafe { codexdeck_main_switch_status() } {
        0 => return Ok(()),
        1 => return Err("desktopRecovery".into()),
        2 => return Err("desktopReview".into()),
        _ => return Err("desktopBroker".into()),
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(UNSUPPORTED.into())
    }
}

// Also protect any independent instance opened by the preceding build.
pub fn require_closed(home: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let canonical = home.canonicalize().map_err(|_| "desktopLaunch")?;
        let path = std::ffi::CString::new(canonical.to_str().ok_or("desktopLaunch")?)
            .map_err(|_| "desktopLaunch")?;
        if unsafe { codexdeck_desktop_active(path.as_ptr()) } != 0 {
            return Err("desktopCloseFirst".into());
        }
    }
    let _ = home;
    Ok(())
}

#[cfg(target_os = "macos")]
mod bridge {
    use super::*;
    use std::{
        collections::HashMap,
        sync::{
            atomic::{AtomicU64, Ordering},
            Mutex, OnceLock,
        },
    };
    use tauri::Emitter;
    struct Pending {
        reply: tokio::sync::oneshot::Sender<Result<Option<String>, String>>,
        app: tauri::AppHandle,
    }
    static PENDING: OnceLock<Mutex<HashMap<u64, Pending>>> = OnceLock::new();
    static NEXT: AtomicU64 = AtomicU64::new(1);
    fn pending() -> &'static Mutex<HashMap<u64, Pending>> {
        PENDING.get_or_init(Default::default)
    }
    extern "C" fn callback(key: u64, text: *const std::ffi::c_char) {
        if text.is_null() {
            return;
        }
        let value = unsafe { std::ffi::CStr::from_ptr(text) };
        let Ok(value) = serde_json::from_slice::<serde_json::Value>(value.to_bytes()) else {
            return;
        };
        if value["done"] == true {
            if let Some(call) = pending().lock().unwrap().remove(&key) {
                let _ = call
                    .app
                    .emit("desktop-switch-progress", Option::<String>::None);
                let result = if let Some(error) = value["error"].as_str() {
                    Err(error.to_owned())
                } else {
                    Ok(value["activeId"]
                        .as_str()
                        .filter(|s| crate::models::valid_id(s))
                        .map(str::to_owned))
                };
                let _ = call.reply.send(result);
            }
        } else if let Some(phase) = value["phase"].as_str().filter(|p| {
            matches!(
                *p,
                "authorizing"
                    | "checkingAccount"
                    | "checkingApp"
                    | "quitting"
                    | "saving"
                    | "verifying"
                    | "opening"
                    | "recovering"
            )
        }) {
            if let Some(call) = pending().lock().unwrap().get(&key) {
                let _ = call.app.emit("desktop-switch-progress", phase);
            }
        }
    }
    pub async fn run(
        app: &tauri::AppHandle,
        request: serde_json::Value,
    ) -> Result<Option<String>, String> {
        let text =
            std::ffi::CString::new(serde_json::to_string(&request).map_err(|_| "desktopBroker")?)
                .map_err(|_| "desktopBroker")?;
        let key = NEXT.fetch_add(1, Ordering::Relaxed);
        let (reply, receiver) = tokio::sync::oneshot::channel();
        pending().lock().unwrap().insert(
            key,
            Pending {
                reply,
                app: app.clone(),
            },
        );
        unsafe {
            codexdeck_main_switch_request(text.as_ptr(), key, callback);
        }
        // Do not time out/release account locks while the native transaction may still be changing credentials.
        receiver.await.map_err(|_| "desktopBroker".to_string())?
    }
}
pub async fn switch(
    app: &tauri::AppHandle,
    request: serde_json::Value,
) -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        bridge::run(app, request).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, request);
        Err(UNSUPPORTED.into())
    }
}
