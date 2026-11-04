//! Portable, encrypted account archives. Tokens never cross the webview boundary.
use crate::{
    models::*,
    storage::{self, Saved},
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use ring::{
    aead, pbkdf2,
    rand::{SecureRandom, SystemRandom},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
#[cfg(not(target_os = "macos"))]
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    io::{Read, Write},
    num::NonZeroU32,
    path::Path,
};
use zeroize::Zeroizing;

pub const MAX_BYTES: u64 = 32 * 1024 * 1024;
const ITERATIONS: u32 = 600_000;
const INVALID: &str = "transferInvalid";
const STORE: &str = "credentialStore";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Envelope {
    format: String,
    version: u32,
    encryption: Encryption,
    ciphertext: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Encryption {
    cipher: String,
    kdf: String,
    iterations: u32,
    salt: String,
    nonce: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Payload {
    pub schema_version: u32,
    pub schema_minor: u32,
    pub minimum_reader_version: u32,
    #[serde(default)]
    pub required_features: Vec<String>,
    pub created_at: f64,
    pub app_version: String,
    pub source_platform: String,
    pub data: Saved,
    /// Missing credentials are explicit, for accounts that have never signed in.
    pub credentials: HashMap<String, Option<String>>,
}

pub trait Credentials {
    fn read(&self, home: &Path) -> Result<Option<String>, String>;
    fn write(&self, home: &Path, value: Option<&str>) -> Result<(), String>;
    fn read_many(
        &self,
        homes: &[std::path::PathBuf],
        _language: &str,
    ) -> Result<Vec<Option<String>>, String> {
        homes.iter().map(|home| self.read(home)).collect()
    }
}
pub struct SystemCredentials;
impl SystemCredentials {
    #[cfg(not(target_os = "macos"))]
    fn entry(home: &Path) -> Result<keyring::Entry, String> {
        let path = home.canonicalize().map_err(|_| STORE.to_string())?;
        let hash = format!("{:x}", Sha256::digest(path.to_string_lossy().as_bytes()));
        keyring::Entry::new("Codex Auth", &format!("cli|{}", &hash[..16])).map_err(|_| STORE.into())
    }
}
impl Credentials for SystemCredentials {
    fn read(&self, home: &Path) -> Result<Option<String>, String> {
        #[cfg(target_os = "macos")]
        {
            return local_credentials(home);
        }
        #[cfg(not(target_os = "macos"))]
        match Self::entry(home)?.get_password() {
            Ok(s) => Ok(Some(s)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(STORE.into()),
        }
    }
    fn write(&self, home: &Path, value: Option<&str>) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            return write_local_credentials(home, value);
        }
        #[cfg(not(target_os = "macos"))]
        {
            let entry = Self::entry(home)?;
            match value {
                Some(s) => entry.set_password(s).map_err(|_| STORE.into()),
                None => match entry.delete_credential() {
                    Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                    Err(_) => Err(STORE.into()),
                },
            }
        }
    }
}

// Managed macOS profiles use Codex's file backend directly.
#[cfg(any(target_os = "macos", test))]
fn local_credentials(home: &Path) -> Result<Option<String>, String> {
    storage::private_dir(home)?;
    let file = home.join("auth.json");
    storage::reject_link(&file)?;
    match std::fs::read_to_string(&file) {
        Ok(value) => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600))
                    .map_err(|_| STORE)?;
            }
            Ok(Some(value))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(STORE.into()),
    }
}
#[cfg(any(target_os = "macos", test))]
fn write_local_credentials(home: &Path, value: Option<&str>) -> Result<(), String> {
    storage::private_dir(home)?;
    let file = home.join("auth.json");
    storage::reject_link(&file)?;
    if let Some(value) = value {
        atomic_credential_file(home, &file, value.as_bytes())?;
    }
    if value.is_none() {
        match std::fs::remove_file(&file) {
            Ok(()) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(_) => return Err(STORE.into()),
        }
    }
    #[cfg(unix)]
    std::fs::File::open(home)
        .and_then(|f| f.sync_all())
        .map_err(|_| STORE)?;
    Ok(())
}
#[cfg(any(target_os = "macos", test))]
fn atomic_credential_file(home: &Path, path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut temp = tempfile::NamedTempFile::new_in(home).map_err(|_| STORE)?;
    temp.write_all(bytes)
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|_| STORE)?;
    temp.persist(path).map_err(|_| STORE)?;
    Ok(())
}

fn aad(e: &Envelope) -> Result<Vec<u8>, String> {
    // Authenticate all format/algorithm parameters as well as the ciphertext.
    serde_json::to_vec(&(&e.format, e.version, &e.encryption)).map_err(|_| INVALID.into())
}
fn key(password: &str, salt: &[u8], iterations: u32) -> Result<aead::LessSafeKey, String> {
    if password.is_empty() || password.len() > 1024 {
        return Err("transferPassword".into());
    }
    let mut bytes = Zeroizing::new([0u8; 32]);
    pbkdf2::derive(
        pbkdf2::PBKDF2_HMAC_SHA256,
        NonZeroU32::new(iterations).ok_or(INVALID)?,
        salt,
        password.as_bytes(),
        bytes.as_mut(),
    );
    aead::UnboundKey::new(&aead::AES_256_GCM, bytes.as_ref())
        .map(aead::LessSafeKey::new)
        .map_err(|_| INVALID.into())
}
pub fn seal(payload: &Payload, password: &str) -> Result<Vec<u8>, String> {
    if password.chars().count() < 10 {
        return Err("transferPassword".into());
    }
    let rng = SystemRandom::new();
    let mut salt = [0u8; 16];
    let mut nonce = [0u8; 12];
    rng.fill(&mut salt)
        .and_then(|_| rng.fill(&mut nonce))
        .map_err(|_| "transferFailed")?;
    let mut e = Envelope {
        format: "codexdeck-account-archive".into(),
        version: 1,
        encryption: Encryption {
            cipher: "AES-256-GCM".into(),
            kdf: "PBKDF2-HMAC-SHA256".into(),
            iterations: ITERATIONS,
            salt: B64.encode(salt),
            nonce: B64.encode(nonce),
        },
        ciphertext: String::new(),
    };
    let mut data = Zeroizing::new(serde_json::to_vec(payload).map_err(|_| INVALID)?);
    if data.len() > 23 * 1024 * 1024 {
        return Err(INVALID.into());
    }
    key(password, &salt, ITERATIONS)?
        .seal_in_place_append_tag(
            aead::Nonce::assume_unique_for_key(nonce),
            aead::Aad::from(aad(&e)?),
            &mut *data,
        )
        .map_err(|_| INVALID)?;
    e.ciphertext = B64.encode(&*data);
    serde_json::to_vec_pretty(&e).map_err(|_| INVALID.into())
}
pub fn open(bytes: &[u8], password: &str) -> Result<Payload, String> {
    if bytes.len() as u64 > MAX_BYTES {
        return Err(INVALID.into());
    }
    let e: Envelope = serde_json::from_slice(bytes).map_err(|_| INVALID)?;
    if e.format != "codexdeck-account-archive" {
        return Err(INVALID.into());
    }
    if e.version != 1
        || e.encryption.cipher != "AES-256-GCM"
        || e.encryption.kdf != "PBKDF2-HMAC-SHA256"
    {
        return Err("transferVersion".into());
    }
    if !(600_000..=2_000_000).contains(&e.encryption.iterations) {
        return Err(INVALID.into());
    }
    let salt = B64.decode(&e.encryption.salt).map_err(|_| INVALID)?;
    let nonce: [u8; 12] = B64
        .decode(&e.encryption.nonce)
        .map_err(|_| INVALID)?
        .try_into()
        .map_err(|_| INVALID)?;
    if salt.len() != 16 {
        return Err(INVALID.into());
    }
    let mut data = Zeroizing::new(B64.decode(&e.ciphertext).map_err(|_| INVALID)?);
    let plaintext = key(password, &salt, e.encryption.iterations)?
        .open_in_place(
            aead::Nonce::assume_unique_for_key(nonce),
            aead::Aad::from(aad(&e)?),
            &mut data,
        )
        .map_err(|_| "transferDecrypt")?;
    let payload: Payload = serde_json::from_slice(plaintext).map_err(|_| INVALID)?;
    validate(&payload)?;
    Ok(payload)
}
fn workspace<'a>(a: &'a Account, saved: &'a Saved) -> Option<&'a str> {
    saved
        .resolved_workspaces
        .get(&a.id)
        .map(String::as_str)
        .or(a.workspace_id.as_deref())
}
pub(crate) fn credential_matches(raw: &str, a: &Account, saved: &Saved) -> bool {
    if raw.len() > 2 * 1024 * 1024 {
        return false;
    }
    let Ok(v) = serde_json::from_str::<Value>(raw) else {
        return false;
    };
    if v.get("OPENAI_API_KEY").is_some_and(|v| !v.is_null())
        || v.get("auth_mode")
            .and_then(Value::as_str)
            .is_some_and(|v| v != "chatgpt")
    {
        return false;
    }
    let Some(t) = v.get("tokens") else {
        return false;
    };
    if ["access_token", "refresh_token"].iter().any(|k| {
        t.get(k)
            .and_then(Value::as_str)
            .is_none_or(|s| s.is_empty())
    }) {
        return false;
    }
    let Some(token) = t.get("id_token").and_then(Value::as_str) else {
        return false;
    };
    let parts: Vec<_> = token.split('.').collect();
    if parts.len() != 3 {
        return false;
    }
    let Ok(body) =
        base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(parts[1].trim_end_matches('='))
    else {
        return false;
    };
    let Ok(claims) = serde_json::from_slice::<Value>(&body) else {
        return false;
    };
    let email = claims.get("email").and_then(Value::as_str);
    if !email
        .zip(a.email.as_deref())
        .is_some_and(|(l, r)| l.eq_ignore_ascii_case(r))
    {
        return false;
    }
    let ws = t.get("account_id").and_then(Value::as_str).or_else(|| {
        claims
            .pointer("/https:~1~1api.openai.com~1auth/chatgpt_account_id")
            .and_then(Value::as_str)
    });
    workspace(a, saved).is_none_or(|expected| ws == Some(expected))
}
pub fn validate(p: &Payload) -> Result<(), String> {
    if p.schema_version != 1
        || p.minimum_reader_version > 1
        || !p.required_features.is_empty()
        || p.data.version != 1
    {
        return Err("transferVersion".into());
    }
    storage::validate_settings(&p.data.state.settings).map_err(|_| INVALID)?;
    if p.data.state.accounts.len() > 1000 {
        return Err(INVALID.into());
    }
    let mut ids = HashSet::new();
    let mut identities = HashSet::new();
    for a in &p.data.state.accounts {
        if !valid_id(&a.id)
            || !ids.insert(a.id.clone())
            || a.label.trim().is_empty()
            || a.label.chars().count() > 100
            || a.label.chars().any(char::is_control)
            || a.workspace_id
                .as_deref()
                .is_some_and(|s| !valid_workspace(s))
            || workspace(a, &p.data).is_some_and(|s| !valid_workspace(s))
            || a.color.as_deref().is_some_and(|s| {
                s.len() != 7
                    || !s.starts_with('#')
                    || !s[1..].bytes().all(|c| c.is_ascii_hexdigit())
            })
            || a.alert_threshold
                .is_some_and(|n| !(1.0..=100.0).contains(&n))
            || a.subscription_ends_at
                .is_some_and(|n| !(0.0..=32_503_680_000.0).contains(&n))
        {
            return Err(INVALID.into());
        }
        if let Some(email) = &a.email {
            if !identities.insert((email.to_lowercase(), workspace(a, &p.data))) {
                return Err(INVALID.into());
            }
        }
        match p.credentials.get(&a.id) {
            Some(Some(raw)) if credential_matches(raw, a, &p.data) => (),
            Some(None) if a.email.is_none() => (),
            _ => return Err("transferCredentials".into()),
        }
    }
    if p.credentials.len() != ids.len()
        || p.data
            .alert_keys
            .keys()
            .chain(p.data.resolved_workspaces.keys())
            .any(|id| !ids.contains(id))
    {
        return Err(INVALID.into());
    }
    Ok(())
}
pub fn capture(
    root: &Path,
    saved: &Saved,
    credentials: &dyn Credentials,
) -> Result<Payload, String> {
    let mut data: Saved = serde_json::from_value(serde_json::to_value(saved).map_err(|_| INVALID)?)
        .map_err(|_| INVALID)?;
    data.state.last_error = None;
    // Consent belongs to this installation, never to an account archive.
    data.state.settings.reporting_consent = None;
    // A backup must not carry authorization to send future messages on another machine.
    data.warmup = None;
    data.desktop_account_id = None;
    let mut secrets = HashMap::new();
    let homes = data
        .state
        .accounts
        .iter()
        .map(|a| storage::profile(root, &a.id))
        .collect::<Result<Vec<_>, _>>()?;
    let values = credentials.read_many(&homes, &data.state.settings.language)?;
    if values.len() != data.state.accounts.len() {
        return Err(STORE.into());
    }
    for (a, value) in data.state.accounts.iter_mut().zip(values) {
        a.status = Status::Idle;
        a.error = None;
        secrets.insert(a.id.clone(), value);
    }
    let payload = Payload {
        schema_version: 1,
        schema_minor: 0,
        minimum_reader_version: 1,
        required_features: vec![],
        created_at: now(),
        app_version: env!("CARGO_PKG_VERSION").into(),
        source_platform: std::env::consts::OS.into(),
        data,
        credentials: secrets,
    };
    validate(&payload)?;
    Ok(payload)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub imported: usize,
    pub skipped: usize,
}
/// Only new IDs/credential keys are written. Existing accounts are never overwritten.
/// The metadata rename is the commit point; failures remove staged credentials first.
pub fn merge(
    root: &Path,
    current: &mut Saved,
    payload: Payload,
    credentials: &dyn Credentials,
) -> Result<ImportReport, String> {
    validate(&payload)?;
    let mut next: Saved =
        serde_json::from_value(serde_json::to_value(&*current).map_err(|_| INVALID)?)
            .map_err(|_| INVALID)?;
    let mut staged = Vec::new();
    let mut skipped = 0;
    let result = (|| {
        for mut a in payload.data.state.accounts.iter().cloned() {
            if next.state.accounts.iter().any(|b| {
                a.email
                    .as_ref()
                    .zip(b.email.as_ref())
                    .is_some_and(|(l, r)| l.eq_ignore_ascii_case(r))
                    && workspace(&a, &payload.data) == workspace(b, &next)
            }) {
                skipped += 1;
                continue;
            }
            let old_id = a.id.clone();
            a.id = uuid::Uuid::new_v4().to_string();
            a.status = Status::Idle;
            a.error = None;
            let home = storage::profile(root, &a.id)?;
            if credentials.read(&home)?.is_some() {
                return Err("transferFailed".into());
            }
            // Record before writing: an OS store may report failure after saving.
            staged.push(home.clone());
            credentials.write(&home, payload.credentials[&old_id].as_deref())?;
            if credentials.read(&home)?.as_deref() != payload.credentials[&old_id].as_deref() {
                return Err(STORE.into());
            }
            if let Some(v) = payload.data.alert_keys.get(&old_id) {
                next.alert_keys.insert(a.id.clone(), v.clone());
            }
            if let Some(v) = payload.data.resolved_workspaces.get(&old_id) {
                next.resolved_workspaces.insert(a.id.clone(), v.clone());
            }
            next.state.accounts.push(a);
        }
        let local_consent = current.state.settings.reporting_consent;
        next.state.settings = payload.data.state.settings;
        next.state.settings.reporting_consent = local_consent;
        next.transfer_extensions
            .extend(payload.data.transfer_extensions);
        // Executables are machine-specific and are never trusted from an imported archive.
        storage::save(root, &next)?;
        Ok(())
    })();
    if let Err(error) = result {
        let mut failed = false;
        for home in staged.iter().rev() {
            if credentials.write(home, None).is_err() {
                failed = true;
            } else if std::fs::remove_dir_all(home).is_err() {
                failed = true;
            }
        }
        return Err(if failed {
            "transferCleanup".into()
        } else {
            error
        });
    }
    let imported = staged.len();
    *current = next;
    Ok(ImportReport { imported, skipped })
}
pub fn read_archive(path: &Path) -> Result<Vec<u8>, String> {
    let mut file = std::fs::File::open(path).map_err(|_| "transferFile")?;
    let mut data = Vec::new();
    Read::by_ref(&mut file)
        .take(MAX_BYTES + 1)
        .read_to_end(&mut data)
        .map_err(|_| "transferFile")?;
    if data.len() as u64 > MAX_BYTES {
        return Err(INVALID.into());
    }
    Ok(data)
}
pub fn write_archive(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("transferFile")?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|_| "transferFile")?;
    temp.write_all(bytes)
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|_| "transferFile")?;
    temp.persist(path).map_err(|_| "transferFile")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::cell::{Cell, RefCell};
    #[derive(Default)]
    struct MemoryCredentials {
        values: RefCell<HashMap<std::path::PathBuf, String>>,
        fail_write: Cell<bool>,
    }
    impl Credentials for MemoryCredentials {
        fn read(&self, home: &Path) -> Result<Option<String>, String> {
            Ok(self.values.borrow().get(home).cloned())
        }
        fn write(&self, home: &Path, value: Option<&str>) -> Result<(), String> {
            if let Some(v) = value {
                self.values.borrow_mut().insert(home.into(), v.into());
                if self.fail_write.replace(false) {
                    return Err(STORE.into());
                }
            } else {
                self.values.borrow_mut().remove(home);
            }
            Ok(())
        }
    }
    #[test]
    fn file_credentials_roundtrip_and_logout_stays_logged_out() {
        let dir = tempfile::tempdir().unwrap();
        assert!(local_credentials(dir.path()).unwrap().is_none());
        write_local_credentials(dir.path(), Some("synthetic-secret")).unwrap();
        assert_eq!(
            local_credentials(dir.path()).unwrap().as_deref(),
            Some("synthetic-secret")
        );
        std::fs::remove_file(dir.path().join("auth.json")).unwrap();
        assert!(local_credentials(dir.path()).unwrap().is_none());
        write_local_credentials(dir.path(), Some("new-login")).unwrap();
        write_local_credentials(dir.path(), None).unwrap();
        assert!(local_credentials(dir.path()).unwrap().is_none());
    }
    #[cfg(unix)]
    #[test]
    fn file_credentials_are_private_and_reject_symlinks() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let dir = tempfile::tempdir().unwrap();
        write_local_credentials(dir.path(), Some("synthetic")).unwrap();
        assert_eq!(
            std::fs::metadata(dir.path()).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            std::fs::metadata(dir.path().join("auth.json"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        let target = dir.path().join("target");
        std::fs::write(&target, "untouched").unwrap();
        std::fs::remove_file(dir.path().join("auth.json")).unwrap();
        symlink(&target, dir.path().join("auth.json")).unwrap();
        assert!(write_local_credentials(dir.path(), Some("replacement")).is_err());
        assert!(local_credentials(dir.path()).is_err());
        assert_eq!(std::fs::read_to_string(target).unwrap(), "untouched");
    }
    #[test]
    fn capture_uses_one_batch_and_propagates_cancellation_without_individual_reads() {
        struct CancelledBatch(Cell<usize>);
        impl Credentials for CancelledBatch {
            fn read(&self, _: &Path) -> Result<Option<String>, String> {
                panic!("Export must use the batch boundary")
            }
            fn write(&self, _: &Path, _: Option<&str>) -> Result<(), String> {
                panic!("Export must never write credentials")
            }
            fn read_many(
                &self,
                homes: &[std::path::PathBuf],
                _: &str,
            ) -> Result<Vec<Option<String>>, String> {
                assert_eq!(homes.len(), 10);
                self.0.set(self.0.get() + 1);
                Err("transferCancelled".into())
            }
        }
        let dir = tempfile::tempdir().unwrap();
        let mut saved = fixture().data;
        let template = saved.state.accounts[0].clone();
        saved.state.accounts = (0..10)
            .map(|_| Account {
                id: uuid::Uuid::new_v4().to_string(),
                ..template.clone()
            })
            .collect();
        let credentials = CancelledBatch(Cell::new(0));
        assert_eq!(
            capture(dir.path(), &saved, &credentials).err().unwrap(),
            "transferCancelled"
        );
        assert_eq!(credentials.0.get(), 1);
        assert_eq!(saved.state.accounts.len(), 10);
    }
    fn fixture() -> Payload {
        let id = uuid::Uuid::new_v4().to_string();
        let claims = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(br#"{"email":"test@example.invalid"}"#);
        let raw = json!({"tokens":{"access_token":"synthetic-access", "refresh_token":"synthetic-refresh", "id_token":format!("header.{claims}.signature"), "account_id":"workspace"}}).to_string();
        let account: Account = serde_json::from_value(json!({"id":id, "label":"Test", "email":"test@example.invalid", "workspaceId":"workspace", "color":"#abcdef", "alertThreshold":15, "subscriptionEndsAt":1800000000})).unwrap();
        let mut saved = Saved {
            version: 1,
            ..Default::default()
        };
        saved.state.accounts.push(account);
        saved
            .resolved_workspaces
            .insert(id.clone(), "workspace".into());
        saved.alert_keys.insert(
            id.clone(),
            crate::alerts::AlertState {
                is_below: true,
                last_reset: Some(1900000000.0),
            },
        );
        saved
            .transfer_extensions
            .insert("futurePlugin".into(), json!({"v":2}));
        Payload {
            schema_version: 1,
            schema_minor: 0,
            minimum_reader_version: 1,
            required_features: vec![],
            created_at: now(),
            app_version: "test".into(),
            source_platform: "test".into(),
            data: saved,
            credentials: HashMap::from([(id, Some(raw))]),
        }
    }
    #[test]
    fn encrypted_roundtrip_wrong_password_and_tamper() {
        let p = fixture();
        let pass = "test password 123";
        let bytes = seal(&p, pass).unwrap();
        let text = String::from_utf8(bytes.clone()).unwrap();
        assert!(!text.contains("synthetic-access"));
        assert!(!text.contains("test@example.invalid"));
        let restored = open(&bytes, pass).unwrap();
        assert_eq!(restored.credentials, p.credentials);
        assert_ne!(bytes, seal(&p, pass).unwrap());
        assert_eq!(
            open(&bytes, "incorrect password").err().unwrap(),
            "transferDecrypt"
        );
        let mut e: Envelope = serde_json::from_slice(&bytes).unwrap();
        let mut cipher = B64.decode(&e.ciphertext).unwrap();
        cipher[0] ^= 1;
        e.ciphertext = B64.encode(cipher);
        assert_eq!(
            open(&serde_json::to_vec(&e).unwrap(), pass).err().unwrap(),
            "transferDecrypt"
        );
        assert!(seal(&p, "short").is_err());
    }
    #[test]
    fn newer_optional_fields_work_but_required_versions_fail() {
        let mut p = fixture();
        p.schema_minor = 99;
        assert!(validate(&p).is_ok());
        p.minimum_reader_version = 2;
        assert_eq!(validate(&p).unwrap_err(), "transferVersion");
        p.minimum_reader_version = 1;
        p.required_features.push("future-required".into());
        assert_eq!(validate(&p).unwrap_err(), "transferVersion");
    }
    #[test]
    fn rejects_incomplete_mismatched_and_duplicate_accounts() {
        let mut p = fixture();
        p.data.state.accounts[0].email = Some("other@example.invalid".into());
        assert_eq!(validate(&p).unwrap_err(), "transferCredentials");
        let mut p = fixture();
        p.credentials.clear();
        assert!(validate(&p).is_err());
        let mut p = fixture();
        p.data.state.accounts.push(p.data.state.accounts[0].clone());
        assert!(validate(&p).is_err());
        let mut p = fixture();
        p.data.state.accounts[0].id = "../../escape".into();
        assert!(validate(&p).is_err());
    }
    #[test]
    fn full_merge_remaps_keys_keeps_local_executable_and_skips_duplicates() {
        let dir = tempfile::tempdir().unwrap();
        let credentials = MemoryCredentials::default();
        let mut current = Saved {
            version: 1,
            ..Default::default()
        };
        current.state.codex_executable = Some("/local/codex".into());
        current.state.settings.reporting_consent = Some(false);
        let mut p = fixture();
        let source_id = p.data.state.accounts[0].id.clone();
        p.data.state.settings.language = "en".into();
        p.data.state.settings.reporting_consent = Some(true);
        let r = merge(dir.path(), &mut current, p, &credentials).unwrap();
        assert_eq!((r.imported, r.skipped), (1, 0));
        let id = &current.state.accounts[0].id;
        assert_ne!(id, &source_id);
        assert!(current.alert_keys[id].is_below);
        assert_eq!(current.resolved_workspaces[id], "workspace");
        assert_eq!(current.state.settings.language, "en");
        assert_eq!(current.state.settings.reporting_consent, Some(false));
        assert_eq!(
            current.state.codex_executable.as_deref(),
            Some("/local/codex")
        );
        assert!(current.transfer_extensions.contains_key("futurePlugin"));
        current.warmup = Some(crate::warmup::Job {
            id: "local-job".into(),
            at: Some(now() + 3600.0),
            status: "pending".into(),
            rows: vec![],
        });
        current.desktop_account_id = Some(id.clone());
        let exported = capture(dir.path(), &current, &credentials).unwrap();
        assert!(exported.data.desktop_account_id.is_none());
        assert!(exported.data.state.settings.reporting_consent.is_none());
        assert_eq!(current.state.settings.reporting_consent, Some(false));
        assert_eq!(current.desktop_account_id.as_ref(), Some(id));
        assert!(exported.data.warmup.is_none());
        assert!(current.warmup.is_some());
        assert!(exported.credentials[id]
            .as_ref()
            .unwrap()
            .contains("synthetic-refresh"));
        let r = merge(dir.path(), &mut current, fixture(), &credentials).unwrap();
        assert_eq!((r.imported, r.skipped), (0, 1));
        assert_eq!(current.state.accounts.len(), 1);
        let disk = std::fs::read_to_string(dir.path().join("state.json")).unwrap();
        assert!(!disk.contains("synthetic-refresh"));
    }
    #[test]
    fn credential_failure_after_write_rolls_back_and_preserves_original_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let credentials = MemoryCredentials::default();
        let mut current = Saved {
            version: 1,
            ..Default::default()
        };
        storage::save(dir.path(), &current).unwrap();
        let before = std::fs::read(dir.path().join("state.json")).unwrap();
        credentials.fail_write.set(true);
        assert!(merge(dir.path(), &mut current, fixture(), &credentials).is_err());
        assert!(current.state.accounts.is_empty());
        assert!(credentials.values.borrow().is_empty());
        assert_eq!(
            std::fs::read(dir.path().join("state.json")).unwrap(),
            before
        );
    }
    #[test]
    fn metadata_failure_rolls_back_credentials() {
        let dir = tempfile::tempdir().unwrap();
        let credentials = MemoryCredentials::default();
        let mut current = Saved {
            version: 1,
            ..Default::default()
        };
        std::fs::create_dir(dir.path().join("state.json")).unwrap();
        assert!(merge(dir.path(), &mut current, fixture(), &credentials).is_err());
        assert!(current.state.accounts.is_empty());
        assert!(credentials.values.borrow().is_empty());
    }
    #[test]
    fn archive_files_round_trip_and_reject_oversize() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("backup.json");
        write_archive(&path, b"test").unwrap();
        assert_eq!(read_archive(&path).unwrap(), b"test");
        std::fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .unwrap()
            .set_len(MAX_BYTES + 1)
            .unwrap();
        assert_eq!(read_archive(&path).unwrap_err(), INVALID);
    }
}
