mod alerts;
mod backend;
mod desktop;
mod discovery;
mod models;
mod notification;
mod rpc;
mod storage;
mod transfer;
mod warmup;
pub fn desktop_switch_probe() -> bool {
    desktop::probe()
}
#[tauri::command]
async fn get_warmup(core: Core<'_>) -> Result<Option<warmup::Job>, String> {
    Ok(core.warmup_state().await)
}
#[tauri::command]
async fn start_warmup(
    window: tauri::WebviewWindow,
    core: Core<'_>,
    ids: Vec<String>,
    at: Option<f64>,
) -> Result<warmup::Job, String> {
    if window.label() != "main" {
        return Err("Unavailable".into());
    }
    core.plan_warmup(ids, at).await
}
#[tauri::command]
async fn cancel_warmup(window: tauri::WebviewWindow, core: Core<'_>) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Unavailable".into());
    }
    core.cancel_warmup().await
}
#[tauri::command]
async fn test_notification(
    window: tauri::WebviewWindow,
    core: Core<'_>,
) -> Result<Option<String>, String> {
    if window.label() != "main" {
        return Err("Unavailable".into());
    }
    let readiness = core.check_notification_readiness(true).await;
    if !readiness.can_send() {
        return Err(readiness
            .message()
            .unwrap_or("Notifications are unavailable.")
            .into());
    }
    let fa = core.state().await.settings.language == "fa";
    notification::send(
        "CodexDeck",
        if fa {
            "این یک اعلان آزمایشی CodexDeck است."
        } else {
            "This is a CodexDeck test notification."
        },
    )
    .await?;
    Ok(readiness.message().map(str::to_owned))
}
#[tauri::command]
async fn check_notification_readiness(
    window: tauri::WebviewWindow,
    core: Core<'_>,
) -> Result<Option<String>, String> {
    if window.label() != "main" {
        return Err("Unavailable".into());
    }
    Ok(core
        .check_notification_readiness(false)
        .await
        .message()
        .map(str::to_owned))
}
// Fixed OS destinations only; the webview cannot supply arbitrary URLs.
#[tauri::command]
async fn open_notification_settings(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Unavailable".into());
    }
    #[cfg(target_os = "macos")]
    let destination = "x-apple.systempreferences:com.apple.Notifications-Settings.extension";
    #[cfg(target_os = "windows")]
    let destination = "ms-settings:notifications";
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        tauri::async_runtime::spawn_blocking(move || open::that(destination))
            .await
            .map_err(|_| "notificationSettingsOpen".to_string())?
            .map_err(|_| "notificationSettingsOpen".to_string())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Err("notificationSettingsOpen".into())
    }
}
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}
use backend::Backend;
use models::*;
use serde_json::Value;
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_dialog::DialogExt;
type Core<'a> = State<'a, Arc<Backend>>;

#[tauri::command]
async fn get_state(core: Core<'_>) -> Result<AppState, String> {
    Ok(core.state().await)
}
#[tauri::command]
async fn add_account(
    core: Core<'_>,
    label: String,
    workspace_id: Option<String>,
) -> Result<AppState, String> {
    core.add(label, workspace_id).await
}
#[tauri::command]
async fn update_account(core: Core<'_>, id: String, patch: Value) -> Result<AppState, String> {
    core.update(id, patch).await
}
#[tauri::command]
async fn remove_account(core: Core<'_>, id: String) -> Result<AppState, String> {
    core.remove(id).await
}
#[tauri::command]
async fn reorder_accounts(core: Core<'_>, ids: Vec<String>) -> Result<AppState, String> {
    core.reorder(ids).await
}
#[tauri::command]
async fn save_settings(
    app: tauri::AppHandle,
    core: Core<'_>,
    patch: Value,
) -> Result<AppState, String> {
    let state = core.settings(patch).await?;
    install_menus(&app, state.settings.language == "fa")
        .map_err(|_| "Could not update application menus.".to_string())?;
    Ok(state)
}
#[tauri::command]
async fn refresh_accounts(core: Core<'_>, id: Option<String>) -> Result<models::RefreshResult, String> {
    core.inner().refresh_with_outcome(id).await
}
#[tauri::command]
async fn start_login(core: Core<'_>, id: String) -> Result<LoginState, String> {
    core.inner().start_login(id).await
}
#[tauri::command]
async fn cancel_login(core: Core<'_>, id: String) -> Result<AppState, String> {
    core.cancel(id).await
}
#[tauri::command]
async fn open_login_url(core: Core<'_>, id: String) -> Result<(), String> {
    core.open_login(id).await
}
#[tauri::command]
async fn set_pinned(core: Core<'_>, pinned: bool) -> Result<(), String> {
    core.settings(serde_json::json!({"pinned":pinned}))
        .await
        .map(|_| ())
}
#[tauri::command]
fn get_platform_capabilities() -> PlatformCapabilities {
    capabilities()
}
#[tauri::command]
async fn switch_desktop_account(
    window: tauri::WebviewWindow,
    core: Core<'_>,
    id: String,
) -> Result<AppState, String> {
    if window.label() != "main" {
        return Err("Unavailable".into());
    }
    core.switch_main_desktop(Some(id)).await
}
#[tauri::command]
async fn restore_desktop_account(
    window: tauri::WebviewWindow,
    core: Core<'_>,
) -> Result<AppState, String> {
    if window.label() != "main" {
        return Err("Unavailable".into());
    }
    core.switch_main_desktop(None).await
}
#[tauri::command]
async fn choose_codex_executable(
    app: tauri::AppHandle,
    core: Core<'_>,
) -> Result<AppState, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Choose the native Codex executable")
        .pick_file(move |path| {
            let _ = sender.send(path);
        });
    match receiver
        .await
        .map_err(|_| "The file picker closed unexpectedly.".to_string())?
    {
        Some(path) => {
            core.choose(
                path.into_path()
                    .map_err(|_| "Select a local executable file.".to_string())?,
            )
            .await
        }
        None => Ok(core.state().await),
    }
}
#[tauri::command]
async fn transfer_accounts(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    core: Core<'_>,
    password: String,
    importing: bool,
) -> Result<Option<transfer::ImportReport>, String> {
    if window.label() != "main" {
        return Err("transferFailed".into());
    }
    if password.chars().count() < 10 || password.len() > 1024 {
        return Err("transferPassword".into());
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let picker = app.dialog().file().add_filter("CodexDeck JSON", &["json"]);
    if importing {
        picker
            .set_title("Import CodexDeck accounts")
            .pick_file(move |p| {
                let _ = sender.send(p);
            });
    } else {
        picker
            .set_title("Export CodexDeck accounts")
            .set_file_name("codexdeck-accounts.json")
            .save_file(move |p| {
                let _ = sender.send(p);
            });
    }
    let Some(path) = receiver.await.map_err(|_| "transferFile")? else {
        return Ok(None);
    };
    let outcome = core
        .transfer(
            path.into_path().map_err(|_| "transferFile")?,
            password,
            importing,
        )
        .await;
    // Resume account listeners after the native transfer releases its locks,
    // including when a transfer failed after stopping the app-server clients.
    let backend = core.inner().clone();
    tauri::async_runtime::spawn(async move {
        let _ = backend.refresh(None).await;
    });
    let report = outcome?;
    if importing {
        install_menus(&app, core.state().await.settings.language == "fa")
            .map_err(|_| "transferFailed")?;
    }
    Ok(Some(report))
}
fn show(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        #[cfg(target_os = "macos")]
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
        #[cfg(target_os = "windows")]
        let _ = window.set_skip_taskbar(false);
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
fn hide_dashboard(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        // Keep the app reachable if hiding the dashboard fails.
        if window.hide().is_ok() {
            #[cfg(target_os = "macos")]
            let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            #[cfg(target_os = "windows")]
            let _ = window.set_skip_taskbar(true);
        }
    }
}
#[tauri::command]
fn show_dashboard(app: tauri::AppHandle) {
    hide_menubar(app.clone());
    show(&app);
}
#[tauri::command]
fn hide_menubar(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("menubar") {
        let _ = window.hide();
    }
}
fn menu_action(app: &tauri::AppHandle, id: &str) {
    match id {
        "show" => show_dashboard(app.clone()),
        "hide" => {
            hide_dashboard(app);
        }
        "settings" => {
            show_dashboard(app.clone());
            let _ = app.emit_to("main", "open-settings", ());
        }
        "refresh" => {
            let core = app.state::<Arc<Backend>>().inner().clone();
            tauri::async_runtime::spawn(async move {
                let _ = core.refresh(None).await;
            });
        }
        "quit" => app.exit(0),
        _ => {}
    }
}
fn menu_text<'a>(fa: bool, persian: &'a str, english: &'a str) -> &'a str {
    if fa {
        persian
    } else {
        english
    }
}
fn install_menus(app: &tauri::AppHandle, fa: bool) -> tauri::Result<()> {
    let t = |f, e| menu_text(fa, f, e);
    let show_item =
        MenuItem::with_id(app, "show", t("بازکردن اپ", "Open app"), true, None::<&str>)?;
    let refresh_item = MenuItem::with_id(
        app,
        "refresh",
        t("تازه‌سازی اکانت‌ها", "Refresh accounts"),
        true,
        Some("CmdOrCtrl+R"),
    )?;
    let settings_item = MenuItem::with_id(
        app,
        "settings",
        t("تنظیمات…", "Settings…"),
        true,
        Some("CmdOrCtrl+,"),
    )?;
    let quit_item = MenuItem::with_id(
        app,
        "quit",
        t("خروج از اپ", "Quit CodexDeck"),
        true,
        Some("CmdOrCtrl+Q"),
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let tray_menu = Menu::with_items(
        app,
        &[
            &show_item,
            &refresh_item,
            &settings_item,
            &separator,
            &quit_item,
        ],
    )?;
    if let Some(tray) = app.tray_by_id("main-tray") {
        tray.set_menu(Some(tray_menu))?;
    }
    #[cfg(target_os = "macos")]
    {
        let about =
            PredefinedMenuItem::about(app, Some(t("درباره CodexDeck", "About CodexDeck")), None)?;
        let hide = PredefinedMenuItem::hide(app, Some(t("پنهان‌کردن CodexDeck", "Hide CodexDeck")))?;
        let hide_others = PredefinedMenuItem::hide_others(
            app,
            Some(t("پنهان‌کردن دیگر برنامه‌ها", "Hide Others")),
        )?;
        let show_all = PredefinedMenuItem::show_all(app, Some(t("نمایش همه", "Show All")))?;
        let app_menu = Submenu::with_items(
            app,
            "CodexDeck",
            true,
            &[
                &about,
                &separator,
                &settings_item,
                &PredefinedMenuItem::separator(app)?,
                &hide,
                &hide_others,
                &show_all,
                &PredefinedMenuItem::separator(app)?,
                &quit_item,
            ],
        )?;
        let edit = Submenu::with_items(
            app,
            t("ویرایش", "Edit"),
            true,
            &[
                &PredefinedMenuItem::undo(app, Some(t("واگرد", "Undo")))?,
                &PredefinedMenuItem::redo(app, Some(t("انجام دوباره", "Redo")))?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::cut(app, Some(t("برش", "Cut")))?,
                &PredefinedMenuItem::copy(app, Some(t("کپی", "Copy")))?,
                &PredefinedMenuItem::paste(app, Some(t("چسباندن", "Paste")))?,
                &PredefinedMenuItem::select_all(app, Some(t("انتخاب همه", "Select All")))?,
            ],
        )?;
        let view = Submenu::with_items(app, t("نمایش", "View"), true, &[&refresh_item])?;
        let window = Submenu::with_items(
            app,
            t("پنجره", "Window"),
            true,
            &[
                &show_item,
                &PredefinedMenuItem::minimize(app, Some(t("کوچک‌کردن", "Minimize")))?,
                &PredefinedMenuItem::close_window(app, Some(t("بستن پنجره", "Close Window")))?,
            ],
        )?;
        app.set_menu(Menu::with_items(app, &[&app_menu, &edit, &view, &window])?)?;
    }
    Ok(())
}
// Monochrome brand mark: three rounded quota arcs with the terminal prompt.
// Supersampling keeps the small menu-bar template crisp on Retina displays.
fn tray_pixels() -> Vec<u8> {
    let segment = |x: f64, y: f64, ax: f64, ay: f64, bx: f64, by: f64| {
        let dx = bx - ax;
        let dy = by - ay;
        let t = (((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)).clamp(0.0, 1.0);
        (x - ax - t * dx).hypot(y - ay - t * dy)
    };
    let ink = |x: f64, y: f64| {
        let dx = x - 9.0;
        let dy = y - 9.0;
        let angle = dy.atan2(dx).to_degrees().rem_euclid(360.0);
        let radius = 6.35;
        let arc = [38.0_f64, 158.0, 278.0].iter().any(|start| {
            ((angle - start).rem_euclid(360.0) <= 94.0 && (dx.hypot(dy) - radius).abs() <= 0.62)
                || [*start, start + 94.0].iter().any(|end| {
                    let radians = end.to_radians();
                    (dx - radius * radians.cos()).hypot(dy - radius * radians.sin()) <= 0.62
                })
        });
        arc || segment(x, y, 6.4, 10.95, 8.35, 9.15) <= 0.52
            || segment(x, y, 8.35, 9.15, 6.4, 7.35) <= 0.52
            || segment(x, y, 9.75, 7.35, 11.7, 7.35) <= 0.48
    };
    let mut pixels = vec![0u8; 36 * 36 * 4];
    for y in 0..36 {
        for x in 0..36 {
            let mut coverage = 0;
            for sy in 0..4 {
                for sx in 0..4 {
                    let px = (x as f64 + (sx as f64 + 0.5) / 4.0) / 2.0;
                    let py = 18.0 - (y as f64 + (sy as f64 + 0.5) / 4.0) / 2.0;
                    if ink(px, py) {
                        coverage += 1;
                    }
                }
            }
            pixels[(y * 36 + x) * 4 + 3] = (coverage * 255 / 16) as u8;
        }
    }
    pixels
}
const MENUBAR_WIDTH: f64 = 360.0;

// Match menubar-panel.css: up to six 64px rows plus fixed header/footer.
fn menubar_height(count: usize, has_error: bool) -> f64 {
    count.clamp(1, 6) as f64 * 64.0 + 160.0 + if has_error { 32.0 } else { 0.0 }
}

fn toggle_menubar(app: &tauri::AppHandle, rect: tauri::Rect) {
    if let Some(window) = app.get_webview_window("menubar") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
            return;
        }
        let state = tauri::async_runtime::block_on(app.state::<Arc<Backend>>().state());
        let mut logical_height = menubar_height(state.accounts.len(), state.last_error.is_some());
        // Tray rectangles are physical screen coordinates. Select the monitor at
        // the icon, not the monitor where the hidden popup was last displayed.
        let prior_scale = window.scale_factor().unwrap_or(1.0);
        let position = rect.position.to_physical::<f64>(prior_scale);
        let size = rect.size.to_physical::<f64>(prior_scale);
        let monitor = window
            .monitor_from_point(
                position.x + size.width / 2.0,
                position.y + size.height / 2.0,
            )
            .ok()
            .flatten();
        let scale = monitor
            .as_ref()
            .map(|m| m.scale_factor())
            .unwrap_or(prior_scale);
        if let Some(monitor) = &monitor {
            logical_height = logical_height.min(monitor.work_area().size.height as f64 / scale - 8.0);
        }
        if window
            .set_size(tauri::LogicalSize::new(MENUBAR_WIDTH, logical_height))
            .is_err()
        {
            show(app);
            return;
        }
        let width = MENUBAR_WIDTH * scale;
        let height = logical_height * scale;
        let mut x = position.x + size.width / 2.0 - width / 2.0;
        let mut y = position.y + size.height + 4.0 * scale;
        if let Some(monitor) = monitor {
            let area = monitor.work_area();
            let left = area.position.x as f64;
            let top = area.position.y as f64;
            x = x.clamp(left, (left + area.size.width as f64 - width).max(left));
            y = y.clamp(top, (top + area.size.height as f64 - height).max(top));
        }
        if window
            .set_position(tauri::PhysicalPosition::new(x, y))
            .is_err()
            || window.show().is_err()
            || window.set_focus().is_err()
        {
            let _ = window.hide();
            show(app);
        }
    } else {
        show(app);
    }
}
fn install_tray(app: &tauri::App) -> tauri::Result<()> {
    TrayIconBuilder::with_id("main-tray")
        .icon(tauri::image::Image::new_owned(tray_pixels(), 36, 36))
        .icon_as_template(true)
        .tooltip("CodexDeck")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                rect,
                ..
            } = event
            {
                toggle_menubar(tray.app_handle(), rect);
            }
        })
        .build(app)?;
    Ok(())
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    notification::initialize().expect("Could not initialize the Windows notification identity");
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show(app)
        }))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_state,
            test_notification,
            check_notification_readiness,
            open_notification_settings,
            get_warmup,
            start_warmup,
            cancel_warmup,
            transfer_accounts,
            add_account,
            update_account,
            remove_account,
            reorder_accounts,
            save_settings,
            refresh_accounts,
            start_login,
            cancel_login,
            open_login_url,
            set_pinned,
            choose_codex_executable,
            get_platform_capabilities,
            switch_desktop_account,
            restore_desktop_account,
            quit_app,
            show_dashboard,
            hide_menubar
        ])
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            #[cfg(debug_assertions)]
            let root = match std::env::var_os("CODEXDECK_DATA_DIR") {
                Some(path) => {
                    let path = std::path::PathBuf::from(path);
                    if !path.is_absolute() {
                        return Err("CODEXDECK_DATA_DIR must be absolute".into());
                    }
                    path
                }
                None => root,
            };
            let (core, events) =
                Backend::new(app.handle().clone(), root).map_err(std::io::Error::other)?;
            let initial_state = tauri::async_runtime::block_on(core.state());
            let pinned = initial_state.settings.pinned;
            if let Some(window) = app.get_webview_window("main") {
                window.set_always_on_top(pinned)?;
            }
            app.manage(core.clone());
            // If tray registration fails, keep the normal close behavior so the app cannot become inaccessible.
            let tray_ready = install_tray(app).is_ok();
            app.manage(TrayReady(tray_ready));
            // Failure to create the optional summary must not prevent the dashboard from starting.
            // A tray click falls back to the dashboard when this window is absent.
            let _ = WebviewWindowBuilder::new(
                app,
                "menubar",
                WebviewUrl::App("index.html?view=menubar".into()),
            )
            .title("CodexDeck")
            .inner_size(
                MENUBAR_WIDTH,
                menubar_height(initial_state.accounts.len(), initial_state.last_error.is_some()),
            )
            .resizable(false)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible(false)
            .focused(false)
            .build();
            install_menus(app.handle(), initial_state.settings.language == "fa")?;
            app.on_menu_event(|app, event| menu_action(app, event.id.as_ref()));
            backend::background(core, events);
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "menubar" {
                if let tauri::WindowEvent::Focused(false) = event {
                    let _ = window.hide();
                }
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<TrayReady>().0 {
                    api.prevent_close();
                    hide_dashboard(window.app_handle());
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("Could not initialize CodexDeck desktop runtime");
    app.run(|handle, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = &event {
            show(handle);
        }
        if let tauri::RunEvent::Exit = event {
            if let Some(core) = handle.try_state::<Arc<Backend>>() {
                tauri::async_runtime::block_on(core.shutdown());
            }
        }
    });
}
struct TrayReady(bool);

#[cfg(test)]
mod menubar_layout_tests {
    use super::menubar_height;

    #[test]
    fn fits_six_rows_before_scrolling_and_reserves_error_space() {
        assert_eq!(menubar_height(0, false), 224.0);
        assert_eq!(menubar_height(1, false), 224.0);
        assert_eq!(menubar_height(3, false), 352.0);
        assert_eq!(menubar_height(6, false), 544.0);
        assert_eq!(menubar_height(20, false), 544.0);
        assert_eq!(menubar_height(6, true), 576.0);
    }
}
