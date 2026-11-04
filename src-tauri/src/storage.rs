use crate::models::*;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
};
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub desktop_account_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warmup: Option<crate::warmup::Job>,
    pub state: AppState,
    #[serde(default)]
    pub alert_keys: HashMap<String, crate::alerts::AlertState>,
    #[serde(default)]
    pub resolved_workspaces: HashMap<String, String>,
    #[serde(default)]
    pub transfer_extensions: serde_json::Map<String, serde_json::Value>,
}
pub(crate) fn reject_link(path: &Path) -> Result<(), String> {
    if fs::symlink_metadata(path)
        .map(|m| {
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                m.file_attributes() & 0x400 != 0
            }
            #[cfg(not(windows))]
            {
                m.file_type().is_symlink()
            }
        })
        .unwrap_or(false)
    {
        return Err("The app data location contains an unsupported symbolic link.".into());
    }
    Ok(())
}
pub fn private_dir(path: &Path) -> Result<(), String> {
    reject_link(path)?;
    {
        let mut builder = fs::DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(path)
    }
    .map_err(|_| "Could not create private app storage.".to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| "Could not protect app storage.".to_string())?;
    }
    Ok(())
}
pub fn profile(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("Invalid account identifier.".into());
    }
    reject_link(root)?;
    let profiles = root.join("profiles");
    private_dir(&profiles)?;
    let path = profiles.join(id);
    private_dir(&path)?;
    Ok(path)
}
/// Held for the entire backend lifetime. OS releases the lock even after a crash.
pub struct RootLock {
    _file: fs::File,
}
impl RootLock {
    pub fn acquire(root: &Path) -> Result<Self, String> {
        private_dir(root)?;
        let canonical =
            fs::canonicalize(root).map_err(|_| "Could not resolve app storage.".to_string())?;
        let path = canonical.join("instance.lock");
        reject_link(&path)?;
        let mut options = fs::OpenOptions::new();
        options.read(true).write(true).create(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options
            .open(path)
            .map_err(|_| "Could not open the app storage lock.".to_string())?;
        file.try_lock().map_err(|_|"This app data folder is already in use by another CodexDeck process. Close that process and retry.".to_string())?;
        Ok(Self { _file: file })
    }
}
pub fn load(root: &Path) -> Result<Saved, String> {
    private_dir(root)?;
    let path = root.join("state.json");
    reject_link(&path)?;
    if !path.exists() {
        return Ok(Saved {
            version: 1,
            ..Default::default()
        });
    }
    let metadata =
        fs::metadata(&path).map_err(|_| "Could not read saved account metadata.".to_string())?;
    if metadata.len() > 16 * 1024 * 1024 {
        return Err("Saved metadata is too large. Restore a known-good metadata backup.".into());
    }
    let bytes =
        fs::read(&path).map_err(|_| "Could not read saved account metadata.".to_string())?;
    let mut saved: Saved = serde_json::from_slice(&bytes).map_err(|_| "Saved metadata is invalid. It has been preserved; restore a known-good metadata backup.".to_string())?;
    if saved.version != 1 {
        return Err("This metadata version requires a newer CodexDeck build.".into());
    }
    let mut ids = std::collections::HashSet::new();
    for a in &mut saved.state.accounts {
        if !valid_id(&a.id)
            || !ids.insert(a.id.clone())
            || a.workspace_id.as_ref().is_some_and(|s| !valid_workspace(s))
        {
            return Err(
                "Saved account identifiers are invalid. Metadata has been preserved.".into(),
            );
        }
        a.status = Status::Idle;
        a.error = None;
    }
    validate_settings(&saved.state.settings)?;
    if saved
        .desktop_account_id
        .as_ref()
        .is_some_and(|id| !saved.state.accounts.iter().any(|a| &a.id == id))
    {
        saved.desktop_account_id = None;
    }
    saved.state.last_error = None;
    Ok(saved)
}
pub fn save(root: &Path, saved: &Saved) -> Result<(), String> {
    private_dir(root)?;
    let destination = root.join("state.json");
    reject_link(&destination)?;
    let mut sanitized = Saved {
        version: 1,
        desktop_account_id: saved.desktop_account_id.clone(),
        warmup: saved.warmup.clone(),
        state: saved.state.clone(),
        alert_keys: saved.alert_keys.clone(),
        resolved_workspaces: saved.resolved_workspaces.clone(),
        transfer_extensions: saved.transfer_extensions.clone(),
    };
    for a in &mut sanitized.state.accounts {
        a.status = Status::Idle;
        a.error = None;
    }
    sanitized.state.last_error = None;
    let bytes = serde_json::to_vec_pretty(&sanitized)
        .map_err(|_| "Could not encode metadata.".to_string())?;
    let mut temp = tempfile::NamedTempFile::new_in(root)
        .map_err(|_| "Could not write metadata.".to_string())?;
    temp.write_all(&bytes)
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|_| "Could not save metadata.".to_string())?;
    temp.persist(destination)
        .map_err(|_| "Could not replace saved metadata.".to_string())?;
    Ok(())
}
pub fn validate_settings(s: &Settings) -> Result<(), String> {
    if !["persian", "gregory"].contains(&s.calendar.as_str())
        || !["fa", "en"].contains(&s.language.as_str())
        || !["system", "light", "dark"].contains(&s.appearance.as_str())
        || !["cards", "list"].contains(&s.layout.as_str())
        || !["manual", "fiveHour", "weekly", "reset"].contains(&s.sort.as_str())
        || ![3, 5, 10, 30, 60].contains(&s.refresh_minutes)
    {
        return Err(
            "Invalid settings. Refresh interval must be one of 3, 5, 10, 30, or 60 minutes.".into(),
        );
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn calendar_defaults_migrate_and_validate() {
        let mut settings: Settings = serde_json::from_str(r#"{"language":"en"}"#).unwrap();
        assert_eq!(settings.calendar, "persian");
        assert!(validate_settings(&settings).is_ok());
        settings.calendar = "gregory".into();
        let restored: Settings =
            serde_json::from_str(&serde_json::to_string(&settings).unwrap()).unwrap();
        assert_eq!(restored.calendar, "gregory");
        settings.calendar = "invalid".into();
        assert!(validate_settings(&settings).is_err());
    }
    #[test]
    fn desktop_account_marker_roundtrips_and_unknown_ids_are_discarded() {
        let root = tempfile::tempdir().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let mut saved = Saved {
            version: 1,
            ..Default::default()
        };
        saved
            .state
            .accounts
            .push(serde_json::from_value(serde_json::json!({"id":id,"label":"test"})).unwrap());
        saved.desktop_account_id = Some(id.clone());
        save(root.path(), &saved).unwrap();
        assert_eq!(load(root.path()).unwrap().desktop_account_id, Some(id));
        saved.desktop_account_id = Some(uuid::Uuid::new_v4().to_string());
        save(root.path(), &saved).unwrap();
        assert_eq!(load(root.path()).unwrap().desktop_account_id, None);
    }
    #[test]
    fn metadata_is_atomic_and_contains_no_login_state() {
        let dir = tempfile::tempdir().unwrap();
        let mut saved = Saved {
            version: 1,
            ..Default::default()
        };
        saved.state.last_error = Some("raw failure".into());
        save(dir.path(), &saved).unwrap();
        saved.state.settings.language = "en".into();
        save(dir.path(), &saved).unwrap();
        assert_eq!(load(dir.path()).unwrap().state.settings.language, "en");
        let bytes = fs::read_to_string(dir.path().join("state.json")).unwrap();
        assert!(!bytes.contains("raw failure"));
        assert!(!bytes.contains("loginId"));
    }
    #[test]
    fn exclusive_root_lock_and_crash_release() {
        let root = tempfile::tempdir().unwrap();
        let lock = RootLock::acquire(root.path()).unwrap();
        let child = |mode: &str| {
            std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "storage::tests::root_lock_child_probe",
                    "--nocapture",
                ])
                .env("CODEXDECK_LOCK_PROBE", root.path())
                .env("CODEXDECK_LOCK_MODE", mode)
                .status()
                .unwrap()
        };
        assert!(child("blocked").success());
        drop(lock);
        // Child exits without Rust destructors; kernel must release its ownership.
        assert!(child("crash-release").success());
        assert!(RootLock::acquire(root.path()).is_ok());
    }
    #[test]
    fn root_lock_child_probe() {
        let Some(root) = std::env::var_os("CODEXDECK_LOCK_PROBE") else {
            return;
        };
        if std::env::var("CODEXDECK_LOCK_MODE").unwrap() == "blocked" {
            assert!(RootLock::acquire(Path::new(&root)).is_err());
        } else {
            let _lock = RootLock::acquire(Path::new(&root)).unwrap();
            std::process::exit(0);
        }
    }
    #[cfg(unix)]
    #[test]
    fn refuses_symlinked_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("untouched");
        fs::write(&target, "original").unwrap();
        std::os::unix::fs::symlink(&target, dir.path().join("state.json")).unwrap();
        assert!(save(dir.path(), &Saved::default()).is_err());
        assert_eq!(fs::read_to_string(target).unwrap(), "original");
    }
}
