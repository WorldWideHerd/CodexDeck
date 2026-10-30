use crate::{
    discovery,
    models::*,
    rpc::{self, Event, Rpc},
    storage::{self, Saved},
};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{Mutex, Notify};

pub struct Backend {
    pub app: AppHandle,
    _root_lock: storage::RootLock,
    pub(crate) root: PathBuf,
    pub(crate) saved: Mutex<Saved>,
    pub(crate) warmup_gate: Mutex<()>,
    clients: Mutex<HashMap<String, Arc<Rpc>>>,
    locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    logins: Mutex<HashMap<String, LoginState>>,
    login_gate: Mutex<()>,
    settings_gate: Mutex<()>,
    events: rpc::EventSender,
    pub schedule: Notify,
    refresh_gate: Mutex<()>,
    // A corrupt metadata file must never be overwritten by a subsequent command.
    storage_error: Option<String>,
    delivery_errors: Mutex<Option<(String, String)>>,
}
impl Backend {
    pub async fn check_notification_readiness(
        &self,
        request: bool,
    ) -> crate::notification::Readiness {
        let readiness = crate::notification::permission(request).await;
        let mut saved = self.saved.lock().await;
        crate::notification::reconcile_notice(&mut saved.state.last_error, readiness);
        drop(saved);
        self.emit_state().await;
        readiness
    }

    pub fn new(app: AppHandle, root: PathBuf) -> Result<(Arc<Self>, rpc::EventReceiver), String> {
        let root_lock = storage::RootLock::acquire(&root)?;
        let loaded = storage::load(&root);
        let storage_error = loaded.as_ref().err().cloned();
        let mut saved = loaded.unwrap_or_default();
        if let Some(error) = &storage_error {
            saved.state.last_error = Some(error.clone());
        }
        if saved.state.codex_executable.is_none() {
            saved.state.codex_executable = discovery::discover();
        }
        let (events, rx) = rpc::event_channel();
        Ok((
            Arc::new(Self {
                app,
                _root_lock: root_lock,
                root,
                saved: Mutex::new(saved),
                warmup_gate: Mutex::new(()),
                clients: Mutex::new(HashMap::new()),
                locks: Mutex::new(HashMap::new()),
                logins: Mutex::new(HashMap::new()),
                events,
                login_gate: Mutex::new(()),
                settings_gate: Mutex::new(()),
                schedule: Notify::new(),
                refresh_gate: Mutex::new(()),
                storage_error,
                delivery_errors: Mutex::new(None),
            }),
            rx,
        ))
    }
    pub(crate) fn writable(&self) -> Result<(), String> {
        self.storage_error.clone().map_or(Ok(()), Err)
    }
    // Serialize transfer against refresh, settings, login and every existing account.
    // All credential access stays native; only counts return to the webview.
    pub async fn transfer(
        &self,
        path: PathBuf,
        password: String,
        importing: bool,
    ) -> Result<crate::transfer::ImportReport, String> {
        let password = zeroize::Zeroizing::new(password);
        self.writable()?;
        if self.saved.lock().await.desktop_account_id.is_some() {
            return Err("desktopActiveTransfer".into());
        }
        if !importing {
            let parent = path
                .parent()
                .and_then(|p| p.canonicalize().ok())
                .ok_or("transferFile")?;
            let root = self.root.canonicalize().map_err(|_| "transferFile")?;
            if parent.starts_with(root) {
                return Err("transferFile".into());
            }
        }
        let _login = self.login_gate.lock().await;
        let _refresh = self.refresh_gate.lock().await;
        let _settings = self.settings_gate.lock().await;
        if self.saved.lock().await.desktop_account_id.is_some() {
            return Err("desktopActiveTransfer".into());
        }
        if !self.logins.lock().await.is_empty() {
            return Err("pendingLogin".into());
        }
        let ids: Vec<_> = self
            .state()
            .await
            .accounts
            .into_iter()
            .map(|a| a.id)
            .collect();
        let mut guards = Vec::new();
        for id in ids {
            guards.push(self.account_lock(&id).await.lock_owned().await);
            crate::desktop::require_closed(&storage::profile(&self.root, &id)?)?;
        }
        let mut saved = self.saved.lock().await;
        // Stop writers before reading secrets; clients restart lazily after transfer.
        let mut clients = self.clients.lock().await;
        for (_, client) in clients.drain() {
            client.stop().await;
        }
        drop(clients);
        let result = if importing {
            let bytes = crate::transfer::read_archive(&path)?;
            let payload = crate::transfer::open(&bytes, &password)?;
            crate::transfer::merge(
                &self.root,
                &mut saved,
                payload,
                &crate::transfer::SystemCredentials,
            )
        } else {
            let payload =
                crate::transfer::capture(&self.root, &saved, &crate::transfer::SystemCredentials)?;
            let bytes = crate::transfer::seal(&payload, &password)?;
            crate::transfer::write_archive(&path, &bytes)?;
            Ok(crate::transfer::ImportReport {
                imported: saved.state.accounts.len(),
                skipped: 0,
            })
        };
        let state = saved.state.clone();
        drop(saved);
        if importing && result.is_ok() {
            if let Some(window) = self.app.get_webview_window("main") {
                let _ = window.set_always_on_top(state.settings.pinned);
            }
            let _ = self.app.emit("state-changed", state);
            self.schedule.notify_one();
        }
        result
    }
    pub async fn state(&self) -> AppState {
        self.saved.lock().await.state.clone()
    }
    pub async fn switch_main_desktop(&self, id: Option<String>) -> Result<AppState, String> {
        let _login = self.login_gate.lock().await;
        let _refresh = self.refresh_gate.lock().await;
        let _settings = self.settings_gate.lock().await;
        self.writable()?;
        if !crate::desktop::available() {
            return Err(crate::desktop::unavailable_reason().into());
        }
        if !self.logins.lock().await.is_empty() {
            return Err("pendingLogin".into());
        }
        if let Some(id) = &id {
            if !matches!(self.account(id).await?.status, Status::Connected) {
                return Err("desktopNeedsLogin".into());
            }
        }
        let accounts = self.state().await.accounts;
        let mut guards = Vec::new();
        let mut profiles = Vec::new();
        for account in &accounts {
            guards.push(self.account_lock(&account.id).await.lock_owned().await);
            let home = storage::profile(&self.root, &account.id)?;
            crate::desktop::require_closed(&home)?;
            profiles.push(json!({
                "id":account.id, "label":account.label, "email":account.email,
                "workspaceID":account.workspace_id,
                "resolvedWorkspaceID":self.saved.lock().await.resolved_workspaces.get(&account.id),
                "home":url::Url::from_file_path(home).map_err(|_| "desktopNeedsLogin")?.to_string()
            }));
        }
        // No source or original-home app-server may race credential replacement or rollback.
        for (_, client) in self.clients.lock().await.drain() {
            client.stop().await;
        }
        let saved = self.saved.lock().await;
        let request = json!({"action":if id.is_some(){"switch"}else{"restore"},
            "language":saved.state.settings.language, "selectedID":id,
            "previousID":saved.desktop_account_id, "profiles":profiles});
        drop(saved);
        let active = crate::desktop::switch(&self.app, request).await?;
        self.saved.lock().await.desktop_account_id = active;
        self.publish().await
    }
    pub(crate) async fn publish(&self) -> Result<AppState, String> {
        let mut saved = self.saved.lock().await;
        let result = storage::save(&self.root, &saved);
        if let Err(error) = &result {
            saved.state.last_error = Some(error.clone());
        }
        let state = saved.state.clone();
        drop(saved);
        let _ = self.app.emit("state-changed", &state);
        result.map(|_| state)
    }
    async fn emit_state(&self) {
        let _ = self.app.emit("state-changed", self.state().await);
    }
    pub(crate) async fn account(&self, id: &str) -> Result<Account, String> {
        self.writable()?;
        if !valid_id(id) {
            return Err("Invalid account identifier.".into());
        }
        self.saved
            .lock()
            .await
            .state
            .accounts
            .iter()
            .find(|a| a.id == id)
            .cloned()
            .ok_or_else(|| "Account not found.".into())
    }
    pub(crate) async fn account_lock(&self, id: &str) -> Arc<Mutex<()>> {
        self.locks
            .lock()
            .await
            .entry(id.into())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
    async fn set_status(&self, id: &str, status: Status, error: Option<String>) {
        if let Some(a) = self
            .saved
            .lock()
            .await
            .state
            .accounts
            .iter_mut()
            .find(|a| a.id == id)
        {
            a.status = status;
            a.error = error;
        }
        self.emit_state().await;
    }
    pub(crate) async fn client(&self, id: &str) -> Result<Arc<Rpc>, String> {
        let a = self.account(id).await?;
        let using_desktop = self.saved.lock().await.desktop_account_id.as_deref() == Some(id);
        if using_desktop {
            crate::desktop::require_recovered()?;
        }
        let mut clients = self.clients.lock().await;
        if let Some(client) = clients.get(id).filter(|c| c.is_alive()) {
            return Ok(client.clone());
        }
        if let Some(old) = clients.remove(id) {
            old.stop().await;
        }
        let path = self
            .saved
            .lock()
            .await
            .state
            .codex_executable
            .clone()
            .ok_or("Codex CLI was not found. Choose its executable in settings.")?;
        if !discovery::executable(Path::new(&path)) {
            return Err("The selected Codex executable is unavailable.".into());
        }
        let client = if using_desktop {
            Rpc::start_original(
                Path::new(&path),
                &crate::desktop::original_home()?,
                id.into(),
                self.events.clone(),
            )
            .await?
        } else {
            Rpc::start(
                Path::new(&path),
                &storage::profile(&self.root, id)?,
                a.workspace_id.as_deref(),
                id.into(),
                self.events.clone(),
            )
            .await?
        };
        clients.insert(id.into(), client.clone());
        Ok(client)
    }
    pub async fn add(&self, label: String, workspace: Option<String>) -> Result<AppState, String> {
        self.writable()?;
        let label = valid_label(label)?;
        let workspace = workspace
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        if workspace.as_ref().is_some_and(|s| !valid_workspace(s)) {
            return Err("Invalid workspace identifier.".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        storage::profile(&self.root, &id)?;
        self.saved.lock().await.state.accounts.push(Account {
            id,
            label,
            email: None,
            plan: None,
            workspace_id: workspace,
            snapshot: None,
            updated_at: None,
            color: None,
            subscription_ends_at: None,
            alert_threshold: None,
            status: Status::Idle,
            error: None,
        });
        self.publish().await
    }
    pub async fn update(self: &Arc<Self>, id: String, patch: Value) -> Result<AppState, String> {
        let lock = self.account_lock(&id).await;
        let _guard = lock.lock().await;
        let mut account = self.account(&id).await?;
        let object = patch
            .as_object()
            .ok_or("Account patch must be an object.")?;
        for (key, value) in object {
            match key.as_str() {
                "label" => {
                    account.label = valid_label(value.as_str().ok_or("Invalid label.")?.into())?
                }
                "color" => {
                    let color = nullable_string(value)?;
                    if color.as_ref().is_some_and(|s| {
                        s.len() != 7
                            || !s.starts_with('#')
                            || !s[1..].bytes().all(|c| c.is_ascii_hexdigit())
                    }) {
                        return Err("Choose a valid hex color.".into());
                    }
                    account.color = color;
                }
                "subscriptionEndsAt" => {
                    account.subscription_ends_at = nullable_number(value, 0.0, 32_503_680_000.0)?
                }
                "alertThreshold" => account.alert_threshold = nullable_number(value, 1.0, 100.0)?,
                _ => return Err("Unsupported account setting.".into()),
            }
        }
        let request_permission =
            account.alert_threshold.is_some() && object.contains_key("alertThreshold");
        let mut saved = self.saved.lock().await;
        let index = saved
            .state
            .accounts
            .iter()
            .position(|a| a.id == id)
            .ok_or("Account not found.")?;
        if saved.state.accounts[index].alert_threshold != account.alert_threshold {
            saved.alert_keys.remove(&id);
        }
        saved.state.accounts[index] = account;
        drop(saved);
        let state = self.publish().await?;
        // Saving preferences must not wait for, or fail because of, OS authorization.
        if request_permission {
            let backend = self.clone();
            tauri::async_runtime::spawn(async move {
                let readiness = crate::notification::permission(true).await;
                let mut saved = backend.saved.lock().await;
                if !saved
                    .state
                    .accounts
                    .iter()
                    .any(|a| a.id == id && a.alert_threshold.is_some())
                {
                    return;
                }
                if let Some(message) = readiness.message() {
                    saved.state.last_error = Some(message.into());
                } else if saved
                    .state
                    .last_error
                    .as_deref()
                    .is_some_and(crate::notification::is_readiness_message)
                {
                    saved.state.last_error = None;
                }
                drop(saved);
                backend.emit_state().await;
            });
        }
        Ok(state)
    }
    pub async fn reorder(&self, ids: Vec<String>) -> Result<AppState, String> {
        self.writable()?;
        let mut saved = self.saved.lock().await;
        let requested: HashSet<_> = ids.iter().collect();
        let current: HashSet<_> = saved.state.accounts.iter().map(|a| &a.id).collect();
        if ids.len() != saved.state.accounts.len()
            || requested.len() != ids.len()
            || requested != current
        {
            return Err("Order must contain each account exactly once.".into());
        }
        let order: HashMap<_, _> = ids
            .iter()
            .enumerate()
            .map(|(i, id)| (id.clone(), i))
            .collect();
        saved.state.accounts.sort_by_key(|a| order[&a.id]);
        drop(saved);
        self.publish().await
    }
    pub async fn settings(&self, patch: Value) -> Result<AppState, String> {
        let _guard = self.settings_gate.lock().await;
        self.writable()?;
        let mut settings = self.saved.lock().await.state.settings.clone();
        let object = patch
            .as_object()
            .ok_or("Settings patch must be an object.")?;
        for (key, v) in object {
            match key.as_str() {
                "calendar" => settings.calendar = v.as_str().ok_or("Invalid calendar.")?.into(),
                "language" => settings.language = v.as_str().ok_or("Invalid language.")?.into(),
                "appearance" => {
                    settings.appearance = v.as_str().ok_or("Invalid appearance.")?.into()
                }
                "refreshMinutes" => {
                    settings.refresh_minutes = v.as_u64().ok_or("Invalid refresh interval.")?
                }
                "layout" => settings.layout = v.as_str().ok_or("Invalid layout.")?.into(),
                "sort" => settings.sort = v.as_str().ok_or("Invalid sort.")?.into(),
                "pinned" => settings.pinned = v.as_bool().ok_or("Invalid pinned setting.")?,
                _ => return Err("Unsupported app setting.".into()),
            }
        }
        storage::validate_settings(&settings)?;
        if let Some(window) = self.app.get_webview_window("main") {
            window
                .set_always_on_top(settings.pinned)
                .map_err(|_| "Could not pin the window.".to_string())?;
        }
        self.saved.lock().await.state.settings = settings;
        self.schedule.notify_one();
        self.publish().await
    }
    pub async fn refresh(self: &Arc<Self>, id: Option<String>) -> Result<AppState, String> {
        self.refresh_with_outcome(id).await.map(|result| result.state)
    }
    pub async fn refresh_with_outcome(
        self: &Arc<Self>,
        id: Option<String>,
    ) -> Result<RefreshResult, String> {
        self.writable()?;
        let _guard = self.refresh_gate.lock().await;
        let ids = if let Some(id) = id {
            self.account(&id).await?;
            vec![id]
        } else {
            self.state()
                .await
                .accounts
                .into_iter()
                .map(|a| a.id)
                .collect()
        };
        let mut refreshed_ids = Vec::new();
        for id in ids {
            if self.refresh_one(&id).await {
                refreshed_ids.push(id);
            }
        }
        Ok(RefreshResult {
            state: self.state().await,
            refreshed_ids,
        })
    }
    // Only this invocation's completed read can report success. Busy, signing-in,
    // failed and unavailable accounts cannot borrow a background completion.
    async fn refresh_one(&self, id: &str) -> bool {
        let lock = self.account_lock(id).await;
        let Ok(_guard) = lock.try_lock() else {
            return false;
        };
        if self.account(id).await.is_err() || self.logins.lock().await.contains_key(id) {
            return false;
        }
        self.set_status(id, Status::Refreshing, None).await;
        match self.read_account(id).await {
            Ok(true) => {
                self.set_status(id, Status::Connected, None).await;
                if self.publish().await.is_ok() {
                    self.check_alert(id).await;
                    return true;
                }
            }
            Ok(false) => {
                self.set_status(id, Status::NeedsLogin, None).await;
            }
            Err(error) => {
                let status = if error.contains("Sign in again") {
                    Status::NeedsLogin
                } else {
                    Status::Failed
                };
                self.set_status(id, status, Some(error)).await;
            }
        }
        false
    }
    pub(crate) async fn read_account(&self, id: &str) -> Result<bool, String> {
        let client = self.client(id).await?;
        let identity = client
            .request("account/read", json!({"refreshToken":false}), 35)
            .await?;
        let Some(account) = identity.get("account").filter(|a| !a.is_null()) else {
            if self.saved.lock().await.desktop_account_id.as_deref() == Some(id) {
                self.detach_desktop_client(id).await?;
                return Err("desktopChanged".into());
            }
            return Ok(false);
        };
        if account.get("type").and_then(Value::as_str) != Some("chatgpt") {
            if self.saved.lock().await.desktop_account_id.as_deref() == Some(id) {
                self.detach_desktop_client(id).await?;
                return Err("desktopChanged".into());
            }
            return Err("Sign in with a ChatGPT account to read subscription quotas.".into());
        }
        let raw = client
            .request("account/rateLimits/read", json!({}), 35)
            .await?;
        let snapshot: UsageSnapshot = serde_json::from_value(raw).map_err(|_| {
            "Codex returned an unsupported quota response. Update the CLI and retry.".to_string()
        })?;
        let email = account
            .get("email")
            .and_then(Value::as_str)
            .map(str::to_string);
        let plan = account
            .get("planType")
            .and_then(Value::as_str)
            .map(str::to_string);
        let workspace = identity
            .pointer("/workspaceRouting/chatgptAccountId")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| snapshot.account_id.clone());
        let mut saved = self.saved.lock().await;
        if saved.desktop_account_id.as_deref() == Some(id) {
            let expected = saved
                .state
                .accounts
                .iter()
                .find(|a| a.id == id)
                .ok_or("Account not found.")?;
            if !expected
                .email
                .as_deref()
                .zip(email.as_deref())
                .is_some_and(|(a, b)| a.eq_ignore_ascii_case(b))
                || saved
                    .resolved_workspaces
                    .get(id)
                    .is_some_and(|w| Some(w) != workspace.as_ref())
            {
                drop(saved);
                self.detach_desktop_client(id).await?;
                return Err("desktopChanged".into());
            }
        }
        if let Some(a) = saved.state.accounts.iter().find(|a| a.id == id) {
            if a.workspace_id.is_some() && a.workspace_id != workspace {
                return Err(
                    "The signed-in workspace does not match this account's required workspace."
                        .into(),
                );
            }
        }
        if email.is_some()
            && saved.state.accounts.iter().any(|a| {
                a.id != id
                    && a.email
                        .as_ref()
                        .zip(email.as_ref())
                        .is_some_and(|(a, b)| a.eq_ignore_ascii_case(b))
                    && saved.resolved_workspaces.get(&a.id) == workspace.as_ref()
            })
        {
            return Err(
                "This ChatGPT account and workspace are already connected. Use another sign-in."
                    .into(),
            );
        }
        match workspace {
            Some(workspace) => {
                saved.resolved_workspaces.insert(id.into(), workspace);
            }
            None => {
                saved.resolved_workspaces.remove(id);
            }
        }
        let a = saved
            .state
            .accounts
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or("Account not found.")?;
        a.email = email;
        a.plan = plan;
        a.snapshot = Some(snapshot);
        a.updated_at = Some(now());
        Ok(true)
    }
    async fn detach_desktop_client(&self, id: &str) -> Result<(), String> {
        let mut saved = self.saved.lock().await;
        if saved.desktop_account_id.as_deref() == Some(id) {
            saved.desktop_account_id = None;
        }
        let persisted = storage::save(&self.root, &saved);
        drop(saved);
        // Stop the original-home client even if metadata persistence failed. Future login/removal must use the isolated home.
        if let Some(client) = self.clients.lock().await.remove(id) {
            client.stop().await;
        }
        persisted
    }
    pub async fn start_login(self: &Arc<Self>, id: String) -> Result<LoginState, String> {
        let _login_guard = self.login_gate.lock().await;
        let lock = self.account_lock(&id).await;
        let _guard = lock.lock().await;
        self.account(&id).await?;
        if self.saved.lock().await.desktop_account_id.as_ref() == Some(&id) {
            return Err("desktopActive".into());
        }
        crate::desktop::require_closed(&storage::profile(&self.root, &id)?)?;
        if !self.logins.lock().await.is_empty() {
            return Err("Finish or cancel the pending sign-in before starting another.".into());
        }
        self.set_status(&id, Status::SigningIn, None).await;
        let result = async {
            let client = self.client(&id).await?;
            let result = client
                .request("account/login/start", json!({"type":"chatgpt"}), 35)
                .await?;
            let login_id = result
                .get("loginId")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .ok_or("Codex returned no sign-in identifier.")?
                .to_string();
            let raw = result
                .get("authUrl")
                .and_then(Value::as_str)
                .ok_or("Codex returned no sign-in URL.")?;
            let url = discovery::login_url(raw)?;
            Ok::<_, String>(LoginState {
                account_id: id.clone(),
                login_id: Some(login_id),
                url: Some(url.to_string()),
                status: "pending".into(),
                error: None,
            })
        }
        .await;
        match result {
            Ok(login) => {
                self.logins.lock().await.insert(id.clone(), login.clone());
                let _ = self.app.emit("login-changed", &login);
                let weak = Arc::downgrade(self);
                let expected = login.login_id.clone();
                let account = id.clone();
                tokio::spawn(async move {
                    tokio::time::sleep(Duration::from_secs(600)).await;
                    if let Some(this) = weak.upgrade() {
                        let _login_guard = this.login_gate.lock().await;
                        let lock = this.account_lock(&account).await;
                        let _guard = lock.lock().await;
                        if this
                            .logins
                            .lock()
                            .await
                            .get(&account)
                            .is_some_and(|l| l.login_id == expected)
                        {
                            let _ = this.cancel_locked(&account).await;
                        }
                    }
                });
                Ok(login)
            }
            Err(error) => {
                if let Some(client) = self.clients.lock().await.remove(&id) {
                    client.stop().await;
                }
                self.set_status(&id, Status::Failed, Some(error.clone()))
                    .await;
                let _ = self.app.emit(
                    "login-changed",
                    LoginState::terminal(&id, "failed", Some(error.clone())),
                );
                Err(error)
            }
        }
    }
    async fn cancel_locked(&self, id: &str) -> Result<(), String> {
        let login = self.logins.lock().await.remove(id);
        let login_was_pending = login.is_some();
        if let Some(login) = login {
            let client = self.clients.lock().await.remove(id);
            if let Some(client) = client {
                if let Some(login_id) = login.login_id {
                    let _ = client
                        .request("account/login/cancel", json!({"loginId":login_id}), 5)
                        .await;
                }
                client.stop().await;
            }
            let _ = self
                .app
                .emit("login-changed", LoginState::terminal(id, "cancelled", None));
        }
        if login_was_pending {
            self.set_status(id, Status::NeedsLogin, None).await;
        }
        Ok(())
    }
    pub async fn cancel(&self, id: String) -> Result<AppState, String> {
        let _login_guard = self.login_gate.lock().await;
        let lock = self.account_lock(&id).await;
        let _guard = lock.lock().await;
        self.account(&id).await?;
        self.cancel_locked(&id).await?;
        Ok(self.state().await)
    }
    pub async fn open_login(&self, id: String) -> Result<(), String> {
        self.account(&id).await?;
        let logins = self.logins.lock().await;
        let login = logins
            .get(&id)
            .ok_or("No sign-in is pending for this account.")?;
        let url =
            discovery::login_url(login.url.as_deref().ok_or("No sign-in URL is available.")?)?;
        open::that(url.as_str())
            .map_err(|_| "Could not open your browser. Try the sign-in button again.".into())
    }
    pub async fn remove(&self, id: String) -> Result<AppState, String> {
        let _login_guard = self.login_gate.lock().await;
        let lock = self.account_lock(&id).await;
        let _guard = lock.lock().await;
        let account = self.account(&id).await?;
        if self.saved.lock().await.desktop_account_id.as_ref() == Some(&id) {
            return Err("desktopActive".into());
        }
        if self.logins.lock().await.contains_key(&id) {
            self.cancel_locked(&id).await?;
        }
        // Never discard metadata while secure logout may have failed.
        let home = storage::profile(&self.root, &id)?;
        crate::desktop::require_closed(&home)?;
        // An unused account has never created credentials. Connected or previously active accounts require confirmed logout.
        if account.email.is_some()
            || std::fs::read_dir(&home)
                .map(|mut i| i.next().is_some())
                .unwrap_or(true)
            || self.clients.lock().await.contains_key(&id)
        {
            let client = self.client(&id).await?;
            client.request("account/logout", json!({}), 35).await?;
        }
        if let Some(client) = self.clients.lock().await.remove(&id) {
            client.stop().await;
        }
        std::fs::remove_dir_all(&home).map_err(|_| {
            "Signed out, but could not remove isolated account files. Retry removal.".to_string()
        })?;
        {
            let mut saved = self.saved.lock().await;
            saved.state.accounts.retain(|a| a.id != id);
            saved.alert_keys.remove(&id);
            saved.resolved_workspaces.remove(&id);
        }
        self.publish().await
    }
    pub async fn choose(&self, path: PathBuf) -> Result<AppState, String> {
        let _login_guard = self.login_gate.lock().await;
        self.writable()?;
        if !path.is_absolute() || !discovery::executable(&path) {
            return Err("Choose an executable Codex CLI file. On Windows, select codex.exe rather than an npm .cmd wrapper.".into());
        }
        if !self.logins.lock().await.is_empty() {
            return Err("Finish or cancel sign-in before changing the executable.".into());
        }
        let _gate = self.refresh_gate.lock().await;
        let mut clients = self.clients.lock().await;
        for (_, c) in clients.drain() {
            c.stop().await;
        }
        drop(clients);
        self.saved.lock().await.state.codex_executable = Some(path.to_string_lossy().into_owned());
        self.publish().await
    }
    async fn check_alert(&self, id: &str) {
        if !self
            .saved
            .lock()
            .await
            .state
            .accounts
            .iter()
            .any(|a| a.id == id && a.alert_threshold.is_some())
        {
            return;
        }
        let readiness = crate::notification::permission(false).await;
        let mut saved = self.saved.lock().await;
        let old_error = saved.state.last_error.clone();
        if let Some(message) = readiness.message() {
            saved.state.last_error = Some(message.into());
        } else if saved
            .state
            .last_error
            .as_deref()
            .is_some_and(crate::notification::is_readiness_message)
        {
            saved.state.last_error = None;
        }
        let notice_changed = old_error != saved.state.last_error;
        let Some(a) = saved.state.accounts.iter().find(|a| a.id == id) else {
            return;
        };
        let Some(threshold) = a.alert_threshold else {
            return;
        };
        let window = a.snapshot.as_ref().and_then(UsageSnapshot::five_hour);
        let remaining = window.map(|w| 100.0 - w.used_percent).unwrap_or_default();
        let previous = saved.alert_keys.get(id).cloned().unwrap_or_default();
        let (reservation, send) =
            crate::alerts::reserve(&previous, window, threshold, now(), readiness);
        if reservation == previous {
            drop(saved);
            if notice_changed {
                self.emit_state().await;
            }
            return;
        }
        saved.alert_keys.insert(id.into(), reservation.clone());
        if let Err(error) = storage::save(&self.root, &saved) {
            saved.alert_keys.insert(id.into(), previous);
            saved.state.last_error = Some(error);
            drop(saved);
            self.emit_state().await;
            return;
        }
        if !send {
            drop(saved);
            if notice_changed {
                self.emit_state().await;
            }
            return;
        }
        let fa = saved.state.settings.language == "fa";
        let body = crate::notification::quota_body(remaining, fa);
        // Per-account refresh still owns its account lock; release the global state during external OS work.
        drop(saved);
        if crate::notification::send("CodexDeck", &body).await.is_err() {
            let mut saved = self.saved.lock().await;
            let matches = saved
                .state
                .accounts
                .iter()
                .any(|a| a.id == id && a.alert_threshold == Some(threshold))
                && saved.alert_keys.get(id) == Some(&reservation);
            if matches {
                saved.alert_keys.insert(id.into(), previous);
                saved.state.last_error=Some("Quota notification could not be confirmed. Check OS permissions; the next refresh will retry. A timed-out OS submission can still arrive later.".into());
                if storage::save(&self.root, &saved).is_err() {
                    saved.state.last_error=Some("Quota notification failed and retry state could not be saved. It may remain suppressed after restart; check app storage permissions.".into());
                }
                if let Some(message) = &saved.state.last_error {
                    *self.delivery_errors.lock().await = Some((id.into(), message.clone()));
                }
            }
        } else {
            let previous_error = crate::notification::take_delivery_error(
                &mut *self.delivery_errors.lock().await,
                id,
            );
            if let Some(previous_error) = previous_error {
                let mut saved = self.saved.lock().await;
                if saved.state.last_error.as_ref() == Some(&previous_error) {
                    saved.state.last_error = None;
                }
            }
        }
        self.emit_state().await;
    }
    pub async fn event(self: &Arc<Self>, event: Event) {
        let lock = self.account_lock(&event.account).await;
        let guard = lock.lock().await;
        let current = self
            .clients
            .lock()
            .await
            .get(&event.account)
            .is_some_and(|c| c.generation == event.generation);
        if !current {
            return;
        }
        match event.method.as_str() {
            "transport/exited" => {
                self.clients.lock().await.remove(&event.account);
                let login = self.logins.lock().await.remove(&event.account);
                if login.is_some() {
                    let _ = self.app.emit(
                        "login-changed",
                        LoginState::terminal(
                            &event.account,
                            "failed",
                            Some(rpc::DISCONNECTED.into()),
                        ),
                    );
                }
                self.set_status(
                    &event.account,
                    Status::Failed,
                    Some(rpc::DISCONNECTED.into()),
                )
                .await;
            }
            "account/login/completed" => {
                let mut logins = self.logins.lock().await;
                if !logins.get(&event.account).is_some_and(|l| {
                    l.login_id.as_deref() == event.params.get("loginId").and_then(Value::as_str)
                }) {
                    return;
                }
                logins.remove(&event.account);
                drop(logins);
                let success = event.params.get("success").and_then(Value::as_bool) == Some(true);
                let error = if success {
                    None
                } else {
                    Some("Sign-in did not complete. Retry sign-in.".into())
                };
                let _ = self.app.emit(
                    "login-changed",
                    LoginState::terminal(
                        &event.account,
                        if success { "complete" } else { "failed" },
                        error.clone(),
                    ),
                );
                self.set_status(
                    &event.account,
                    if success {
                        Status::Idle
                    } else {
                        Status::Failed
                    },
                    error,
                )
                .await;
                drop(guard);
                if success {
                    self.refresh_one(&event.account).await;
                }
            }
            "account/rateLimits/updated" | "account/updated" => {
                if let Some(client) = self.clients.lock().await.get(&event.account) {
                    client.acknowledge_quota();
                }
                drop(guard);
                self.refresh_one(&event.account).await;
            }
            _ => {}
        }
    }
    pub async fn shutdown(&self) {
        let mut clients = self.clients.lock().await;
        for (_, client) in clients.drain() {
            client.stop().await;
        }
    }
}
fn valid_label(label: String) -> Result<String, String> {
    let label = label.trim();
    if label.is_empty() || label.chars().count() > 100 || label.chars().any(char::is_control) {
        return Err("Account label must contain 1–100 printable characters.".into());
    }
    Ok(label.into())
}
fn nullable_string(v: &Value) -> Result<Option<String>, String> {
    if v.is_null() {
        Ok(None)
    } else {
        v.as_str()
            .map(|s| Some(s.into()))
            .ok_or("Invalid text value.".into())
    }
}
fn nullable_number(v: &Value, min: f64, max: f64) -> Result<Option<f64>, String> {
    if v.is_null() {
        return Ok(None);
    }
    v.as_f64()
        .filter(|n| n.is_finite() && *n >= min && *n <= max)
        .map(Some)
        .ok_or("Invalid numeric value.".into())
}

pub fn background(backend: Arc<Backend>, mut events: rpc::EventReceiver) {
    crate::warmup::background(backend.clone());
    let this = backend.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            this.event(event).await;
        }
    });
    tauri::async_runtime::spawn(async move {
        let _ = backend.refresh(None).await;
        let mut checked = now();
        let mut due = checked + backend.state().await.settings.refresh_minutes as f64 * 60.0;
        loop {
            tokio::select! {
                _=tokio::time::sleep(Duration::from_secs(15))=>{
                    let current=now();
                    // Wall-clock gap catches system sleep even on clocks that pause while suspended.
                    if current>=due || current-checked>45.0 {
                        let _=backend.refresh(None).await;
                        due=now()+backend.state().await.settings.refresh_minutes as f64*60.0;
                    }
                    checked=now();
                },
                _=backend.schedule.notified()=>{
                    due=now()+backend.state().await.settings.refresh_minutes as f64*60.0;
                    checked=now();
                },
            }
        }
    });
}
