//! Windows original-account transaction. Secrets stay native; recovery is DPAPI encrypted.
use crate::{
    rpc, storage,
    transfer::{Credentials, SystemCredentials},
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};
use tauri::Emitter;

fn powershell(script: &str) -> Command {
    // Never resolve a credential-handling executable through the working directory/PATH.
    let root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
    let mut command =
        Command::new(PathBuf::from(root).join("System32/WindowsPowerShell/v1.0/powershell.exe"));
    command.args([
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        script,
    ]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command.stdin(Stdio::null()).stderr(Stdio::null());
    command
}
fn installation() -> Result<PathBuf, String> {
    let output = powershell(r#"$ErrorActionPreference='Stop'; $p=Get-AppxPackage -Name '*Codex*' | Where-Object {$_.Publisher -like '*OpenAI*'} | Select-Object -First 1; if ($p) { $m=Get-AppxPackageManifest $p; $e=$m.Package.Applications.Application | Select-Object -First 1; Join-Path $p.InstallLocation $e.Executable } else { exit 1 }"#)
        .output().map_err(|_| "desktopMissing")?;
    let text = String::from_utf8_lossy(&output.stdout);
    let path = PathBuf::from(text.trim().trim_start_matches('\u{feff}'));
    if !output.status.success() || !path.is_absolute() || !crate::discovery::executable(&path) {
        return Err("desktopMissing".into());
    }
    Ok(path)
}
pub fn available() -> bool {
    installation().is_ok()
}
pub fn home() -> Result<PathBuf, String> {
    let path =
        PathBuf::from(std::env::var_os("USERPROFILE").ok_or("desktopMissing")?).join(".codex");
    storage::private_dir(&path)?;
    path.canonicalize().map_err(|_| "desktopMissing".into())
}
// Require a clean shutdown by the user. Never kill a name-matched process or a live task.
pub fn require_closed() -> Result<(), String> {
    let status = powershell(r#"$ErrorActionPreference='Stop'; if (Get-Process -Name 'Codex','codex-app','codex-desktop' -ErrorAction SilentlyContinue) { exit 2 }; exit 0"#)
        .status().map_err(|_| "desktopQuit")?;
    if status.success() {
        Ok(())
    } else {
        Err("desktopQuit".into())
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Snapshot {
    file: Option<String>,
    keyring: Option<String>,
    mode: String,
    active: Option<String>,
    recovering: bool,
}
fn read_file(home: &Path) -> Result<Option<String>, String> {
    let path = home.join("auth.json");
    storage::reject_link(&path)?;
    match std::fs::read(&path) {
        Ok(bytes) if bytes.len() <= 2 * 1024 * 1024 => String::from_utf8(bytes)
            .map(Some)
            .map_err(|_| "credentialStore".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        _ => Err("credentialStore".into()),
    }
}
fn write_file(home: &Path, value: Option<&str>) -> Result<(), String> {
    let path = home.join("auth.json");
    storage::reject_link(&path)?;
    if let Some(value) = value {
        atomic(&path, value.as_bytes())
    } else {
        match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            _ => Err("credentialStore".into()),
        }
    }
}
fn atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    storage::reject_link(path)?;
    let mut temp = tempfile::NamedTempFile::new_in(path.parent().ok_or("credentialStore")?)
        .map_err(|_| "credentialStore")?;
    temp.write_all(bytes)
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|_| "credentialStore")?;
    temp.persist(path).map_err(|_| "credentialStore")?;
    Ok(())
}
fn snapshot(home: &Path, mode: &str, active: Option<String>) -> Result<Snapshot, String> {
    Ok(Snapshot {
        file: read_file(home)?,
        keyring: SystemCredentials.read(home)?,
        mode: mode.into(),
        active,
        recovering: true,
    })
}
fn restore(home: &Path, value: &Snapshot) -> Result<(), String> {
    SystemCredentials.write(home, value.keyring.as_deref())?;
    write_file(home, value.file.as_deref())
}
fn backup_path(home: &Path) -> PathBuf {
    home.join("codexdeck-desktop-recovery.dpapi")
}
fn crypt(bytes: &[u8], decrypt: bool) -> Result<Vec<u8>, String> {
    // DPAPI is bound to this Windows user. Credentials travel only over anonymous pipes.
    let operation = if decrypt { "Unprotect" } else { "Protect" };
    let script = format!("$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[Security.Cryptography.ProtectedData]::{operation}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))");
    let mut child = powershell(&script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|_| "credentialStore")?;
    let mut input = child.stdin.take().ok_or("credentialStore")?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    let write = input.write_all(encoded.as_bytes());
    drop(input);
    let output = child.wait_with_output().map_err(|_| "credentialStore")?;
    if write.is_err() || !output.status.success() {
        return Err("credentialStore".into());
    }
    base64::engine::general_purpose::STANDARD
        .decode(output.stdout)
        .map_err(|_| "credentialStore".into())
}
fn backup(home: &Path) -> Result<Option<Snapshot>, String> {
    let path = backup_path(home);
    storage::reject_link(&path)?;
    match std::fs::read(path) {
        Ok(bytes) if bytes.len() <= 8 * 1024 * 1024 => {
            serde_json::from_slice(&crypt(&bytes, true)?)
                .map(Some)
                .map_err(|_| "desktopRecovery".into())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        _ => Err("desktopRecovery".into()),
    }
}
fn save_backup(home: &Path, value: &Snapshot) -> Result<(), String> {
    atomic(
        &backup_path(home),
        &crypt(
            &serde_json::to_vec(value).map_err(|_| "credentialStore")?,
            false,
        )?,
    )
}
pub fn require_recovered() -> Result<(), String> {
    if backup(&home()?)?.is_some_and(|b| b.recovering) {
        Err("desktopRecovery".into())
    } else {
        Ok(())
    }
}
fn mode(config: &Value, profile: Option<&Value>) -> Result<String, String> {
    let config = config.get("config").ok_or("desktopStorage")?;
    let mode = config["cli_auth_credentials_store"]
        .as_str()
        .unwrap_or("file");
    if !["file", "keyring", "auto"].contains(&mode)
        || config["auth_keyring_backend"].as_str().unwrap_or("direct") != "direct"
    {
        return Err("desktopStorage".into());
    }
    if let Some(profile) = profile {
        if config["forced_login_method"]
            .as_str()
            .is_some_and(|s| s != "chatgpt")
        {
            return Err("workspaceMismatch".into());
        }
        let expected = profile["resolvedWorkspaceID"]
            .as_str()
            .or(profile["workspaceID"].as_str());
        let allowed = &config["forced_chatgpt_workspace_id"];
        if !allowed.is_null()
            && !expected.is_some_and(|id| {
                allowed.as_str() == Some(id)
                    || allowed
                        .as_array()
                        .is_some_and(|v| v.iter().any(|v| v.as_str() == Some(id)))
            })
        {
            return Err("workspaceMismatch".into());
        }
    }
    Ok(mode.into())
}
async fn reader(executable: &Path, home: &Path) -> Result<std::sync::Arc<rpc::Rpc>, String> {
    let (events, _receiver) = rpc::event_channel();
    rpc::Rpc::start_original(executable, home, "desktop".into(), events).await
}
fn launch(executable: &Path, home: &Path) -> Result<(), String> {
    let mut command = Command::new(executable);
    for (name, _) in std::env::vars_os() {
        let key = name.to_string_lossy();
        if key.starts_with("CODEX_") || key == "OPENAI_API_KEY" || key == "OPENAI_BASE_URL" {
            command.env_remove(name);
        }
    }
    command
        .env("CODEX_HOME", home)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut child = command.spawn().map_err(|_| "desktopLaunch")?;
    std::thread::sleep(std::time::Duration::from_millis(1000));
    if child
        .try_wait()
        .map_err(|_| "desktopLaunch")?
        .is_some_and(|s| !s.success())
    {
        return Err("desktopLaunch".into());
    }
    Ok(())
}
fn profile_account(profile: &Value) -> Result<crate::models::Account, String> {
    serde_json::from_value(json!({
        "id":profile["id"], "label":profile["label"], "email":profile["email"],
        "workspaceId":profile["resolvedWorkspaceID"].as_str().or(profile["workspaceID"].as_str()),
        "status":"connected"
    }))
    .map_err(|_| "desktopNeedsLogin".into())
}
fn sync_current(previous: &Snapshot, profiles: &[Value]) -> Result<(), String> {
    let raw = if previous.mode == "file" {
        previous.file.as_deref()
    } else {
        previous.keyring.as_deref().or_else(|| {
            if previous.mode == "auto" {
                previous.file.as_deref()
            } else {
                None
            }
        })
    };
    let Some(raw) = raw else {
        return Ok(());
    };
    for profile in profiles {
        let account = profile_account(profile)?;
        let mut saved = storage::Saved::default();
        if let Some(ws) = account.workspace_id.as_ref() {
            saved
                .resolved_workspaces
                .insert(account.id.clone(), ws.clone());
        }
        if crate::transfer::credential_matches(raw, &account, &saved) {
            let source = url::Url::parse(profile["home"].as_str().ok_or("desktopNeedsLogin")?)
                .map_err(|_| "desktopNeedsLogin")?
                .to_file_path()
                .map_err(|_| "desktopNeedsLogin")?;
            SystemCredentials.write(&source, Some(raw))?;
            break;
        }
    }
    Ok(())
}
pub async fn switch(app: &tauri::AppHandle, request: Value) -> Result<Option<String>, String> {
    let executable = installation()?;
    let cli = PathBuf::from(request["executable"].as_str().ok_or("cliMissing")?);
    if !cli.is_absolute() || !crate::discovery::executable(&cli) {
        return Err("cliMissing".into());
    }
    let home = home()?;
    let _lock = storage::RootLock::acquire(&home.join("codexdeck-switch-lock"))?;
    // Backend has stopped its own RPC clients before this check.
    require_closed()?;
    let profiles = request["profiles"].as_array().ok_or("desktopNeedsLogin")?;
    let selected = profiles.iter().find(|p| p["id"] == request["selectedID"]);
    if request["action"] == "switch" && selected.is_none() {
        return Err("desktopNeedsLogin".into());
    }
    let rpc = reader(&cli, &home).await?;
    let config = rpc
        .request("config/read", json!({"includeLayers":false}), 30)
        .await;
    rpc.stop().await;
    let mode = mode(&config.map_err(|_| "desktopStorage")?, selected)?;
    let old_backup = backup(&home)?;
    let previous = snapshot(
        &home,
        &mode,
        request["previousID"].as_str().map(str::to_owned),
    )?;
    let mut recovery = if selected.is_some() {
        if old_backup.as_ref().is_some_and(|b| b.recovering) {
            return Err("desktopRecovery".into());
        }
        previous.clone()
    } else {
        old_backup.clone().ok_or("desktopNoBackup")?
    };
    if recovery.mode != mode {
        return Err("desktopStorage".into());
    }
    sync_current(&previous, profiles)?;
    // Validate source against its card before changing anything.
    let target = if let Some(profile) = selected {
        let source = url::Url::parse(profile["home"].as_str().ok_or("desktopNeedsLogin")?)
            .map_err(|_| "desktopNeedsLogin")?
            .to_file_path()
            .map_err(|_| "desktopNeedsLogin")?;
        let raw = SystemCredentials
            .read(&source)?
            .ok_or("desktopNeedsLogin")?;
        let account = profile_account(profile)?;
        let mut saved = storage::Saved::default();
        if let Some(workspace) = profile["resolvedWorkspaceID"]
            .as_str()
            .or(profile["workspaceID"].as_str())
        {
            saved
                .resolved_workspaces
                .insert(account.id.clone(), workspace.into());
        }
        if !crate::transfer::credential_matches(&raw, &account, &saved) {
            return Err("desktopNeedsLogin".into());
        }
        Some(raw)
    } else {
        None
    };
    require_closed()?;
    recovery.recovering = true;
    save_backup(&home, &recovery)?;
    // Confirm the recovery record can be decrypted before touching the original login.
    if backup(&home)?.as_ref() != Some(&recovery) {
        return Err("desktopRecovery".into());
    }
    let current = snapshot(&home, &mode, previous.active.clone())?;
    if require_closed().is_err() || current != previous {
        // A concurrent external sign-in must never be rolled back over.
        if let Some(old) = old_backup.as_ref() {
            save_backup(&home, old)?;
        } else {
            std::fs::remove_file(backup_path(&home)).map_err(|_| "desktopRecovery")?;
        }
        return Err("desktopChanged".into());
    }
    let _ = app.emit("desktop-switch-progress", "saving");
    let result: Result<Option<String>, String> = async {
        if let Some(raw) = target {
            if mode == "file" {
                SystemCredentials.write(&home, None)?;
                write_file(&home, Some(&raw))?;
            } else {
                SystemCredentials.write(&home, Some(&raw))?;
                write_file(&home, None)?;
            }
            let _ = app.emit("desktop-switch-progress", "verifying");
            let verifier = reader(&cli, &home).await?;
            let identity = verifier
                .request("account/read", json!({"refreshToken":false}), 30)
                .await;
            verifier.stop().await;
            let identity = identity.map_err(|_| "desktopVerification")?;
            let profile = selected.ok_or("desktopNeedsLogin")?;
            let expected = profile["email"].as_str().ok_or("desktopNeedsLogin")?;
            if identity["account"]["type"] != "chatgpt"
                || !identity["account"]["email"]
                    .as_str()
                    .is_some_and(|email| email.eq_ignore_ascii_case(expected))
            {
                return Err("desktopVerification".into());
            }
            if let Some(expected_workspace) = profile["resolvedWorkspaceID"]
                .as_str()
                .or(profile["workspaceID"].as_str())
            {
                if identity["workspaceRouting"]["chatgptAccountId"]
                    .as_str()
                    .is_some_and(|actual| actual != expected_workspace)
                {
                    return Err("workspaceMismatch".into());
                }
            }
        } else {
            restore(&home, &recovery)?;
        }
        require_closed()?;
        let _ = app.emit("desktop-switch-progress", "opening");
        launch(&executable, &home)?;
        if selected.is_some() {
            recovery.recovering = false;
            save_backup(&home, &recovery)?;
        } else {
            std::fs::remove_file(backup_path(&home)).map_err(|_| "desktopRecovery")?;
        }
        Ok(selected
            .and_then(|p| p["id"].as_str())
            .map(str::to_owned)
            .or_else(|| {
                if selected.is_none() {
                    recovery.active.clone()
                } else {
                    None
                }
            }))
    }
    .await;
    let _ = app.emit("desktop-switch-progress", Option::<String>::None);
    if let Err(error) = result {
        // Never replace a running app's credentials after a failed launch/commit.
        if require_closed().is_err() || restore(&home, &previous).is_err() {
            return Err("desktopRecovery".into());
        }
        if let Some(old) = old_backup {
            save_backup(&home, &old)?;
        } else {
            std::fs::remove_file(backup_path(&home)).map_err(|_| "desktopRecovery")?;
        }
        return Err(error);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn card_identity_is_decoded_with_workspace() {
        let account = profile_account(&json!({"id":"id", "label":"Test", "email":"test@example.com", "resolvedWorkspaceID":"workspace"})).unwrap();
        assert_eq!(account.workspace_id.as_deref(), Some("workspace"));
        assert_eq!(account.email.as_deref(), Some("test@example.com"));
    }
    #[cfg(windows)]
    #[test]
    fn dpapi_roundtrip_and_tampering() {
        let plain = b"synthetic credential snapshot";
        let mut encrypted = crypt(plain, false).unwrap();
        assert_ne!(encrypted, plain);
        assert_eq!(crypt(&encrypted, true).unwrap(), plain);
        let last = encrypted.len() - 1;
        encrypted[last] ^= 1;
        assert!(crypt(&encrypted, true).is_err());
    }
    #[cfg(windows)]
    #[test]
    fn encrypted_backup_restores_file_and_keyring_without_plaintext_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        SystemCredentials
            .write(home, Some("synthetic original keyring"))
            .unwrap();
        write_file(home, Some("synthetic original file")).unwrap();
        let original = snapshot(home, "auto", Some("original".into())).unwrap();
        save_backup(home, &original).unwrap();
        let bytes = std::fs::read(backup_path(home)).unwrap();
        assert!(!bytes.windows(b"synthetic".len()).any(|w| w == b"synthetic"));
        SystemCredentials
            .write(home, Some("synthetic replacement"))
            .unwrap();
        write_file(home, None).unwrap();
        let saved = backup(home).unwrap().unwrap();
        restore(home, &saved).unwrap();
        assert_eq!(read_file(home).unwrap(), original.file);
        assert_eq!(SystemCredentials.read(home).unwrap(), original.keyring);
        assert_eq!(saved.active.as_deref(), Some("original"));
        SystemCredentials.write(home, None).unwrap();
    }
    #[test]
    fn storage_and_workspace_restrictions_are_enforced() {
        assert_eq!(mode(&json!({"config":{}}), None).unwrap(), "file");
        assert!(mode(
            &json!({"config":{"cli_auth_credentials_store":"unknown"}}),
            None
        )
        .is_err());
        assert!(mode(&json!({"config":{"auth_keyring_backend":"other"}}), None).is_err());
        let config = json!({"config":{"forced_chatgpt_workspace_id":["a","b"]}});
        assert!(mode(&config, Some(&json!({"workspaceID":"b"}))).is_ok());
        assert!(mode(&config, Some(&json!({"workspaceID":"c"}))).is_err());
        assert!(mode(&config, Some(&json!({}))).is_err());
        assert!(mode(
            &json!({"config":{"forced_login_method":"api"}}),
            Some(&json!({}))
        )
        .is_err());
    }
}
