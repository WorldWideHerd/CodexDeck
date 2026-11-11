fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        build_macos_icon();
        build_switch_bridge();
        cc::Build::new()
            .file("src/notification_mac.m")
            .file("src/desktop_mac.m")
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .compile("codexdeck_notifications");
        println!("cargo:rustc-link-lib=framework=UserNotifications");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rustc-link-lib=framework=AppKit");
        println!("cargo:rustc-link-lib=framework=Security");
        println!("cargo:rerun-if-changed=src/notification_mac.m");
        println!("cargo:rerun-if-changed=src/desktop_mac.m");
    }
    tauri_build::build()
}

fn build_switch_bridge() {
    use std::{path::PathBuf, process::Command};
    let manifest = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let root = manifest.parent().unwrap();
    let out = PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
    let sources = [
        root.join("native/macos/SwitchSupport.swift"),
        root.join("native/macos/MainAccountSwitch.swift"),
        root.join("native/macos/DesktopCredentials.swift"),
        root.join("native/macos/DesktopAccountSwitcher.swift"),
        root.join("native/macos/DesktopProjectCopy.swift"),
        root.join("native/macos/DesktopAuthorization.swift"),
        root.join("native/macos/DesktopSwitchProgress.swift"),
        root.join("native/macos/CredentialBrokerProtocol.swift"),
        root.join("native/macos/CredentialBrokerClient.swift"),
        root.join("native/macos/AppCodeIdentity.swift"),
        root.join("native/macos/RPCClient.swift"),
    ];
    let arch = match std::env::var("CARGO_CFG_TARGET_ARCH").unwrap().as_str() {
        "aarch64" => "arm64",
        "x86_64" => "x86_64",
        _ => panic!("Unsupported macOS architecture"),
    };
    let result = Command::new("/usr/bin/swiftc")
        .args([
            "-O",
            "-whole-module-optimization",
            "-parse-as-library",
            "-emit-library",
            "-static",
            "-module-name",
            "CodexDeckMainSwitch",
            "-target",
            &format!("{arch}-apple-macosx13.0"),
            "-module-cache-path",
        ])
        .arg(out.join("swift-cache"))
        .args(&sources)
        .arg("-o")
        .arg(out.join("libcodexdeck_main_switch.a"))
        .output()
        .expect("Swift compiler is required for the macOS account switch bridge");
    if !result.status.success() {
        panic!(
            "Swift account-switch bridge failed: {}",
            String::from_utf8_lossy(&result.stderr)
        );
    }
    for source in sources {
        println!("cargo:rerun-if-changed={}", source.display());
    }
    let info = Command::new("/usr/bin/swiftc")
        .arg("-print-target-info")
        .output()
        .unwrap();
    let info: serde_json::Value = serde_json::from_slice(&info.stdout).unwrap();
    for key in ["runtimeLibraryPaths", "runtimeLibraryImportPaths"] {
        for path in info["paths"][key].as_array().unwrap() {
            println!("cargo:rustc-link-search=native={}", path.as_str().unwrap());
        }
    }
    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=codexdeck_main_switch");
    println!("cargo:rustc-link-lib=framework=LocalAuthentication");
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
}

// Resources must exist before tauri_build copies them, including a fresh checkout
// and direct cargo test/dev builds that do not run CLI packaging hooks.
fn build_macos_icon() {
    use std::{path::PathBuf, process::Command};
    let manifest = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let script = manifest.parent().unwrap().join("scripts/build-macos-icon.py");
    let result = Command::new("python3")
        .arg(&script)
        .output()
        .expect("Python 3 and Xcode are required to compile the macOS app icon");
    if !result.status.success() {
        panic!(
            "macOS app icon compilation failed: {} {}",
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        );
    }
    println!("cargo:rerun-if-changed={}", script.display());
    println!("cargo:rerun-if-changed=icons/icon.png");
}
