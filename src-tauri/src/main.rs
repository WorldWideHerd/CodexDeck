#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    if std::env::args_os().any(|arg| arg == "--reporting-smoke-test") {
        if let Err(message) = codexdeck_lib::reporting_smoke_test() {
            eprintln!("{message}");
            std::process::exit(1);
        }
        return;
    }
    if std::env::args_os().any(|arg| arg == "--check-desktop-switch-bridge") {
        let ready = codexdeck_lib::desktop_switch_probe();
        println!(
            "Desktop switch bridge: {}",
            if ready { "ready" } else { "unavailable" }
        );
        std::process::exit(if ready { 0 } else { 1 });
    }
    codexdeck_lib::run();
}
