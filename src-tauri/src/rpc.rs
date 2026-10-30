//! Account-only JSONL transport. No raw server errors, stderr or packets are logged.
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::Path,
    process::Stdio,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex as StdMutex, Weak,
    },
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::{Child, ChildStdin, Command},
    sync::{mpsc, oneshot, Mutex},
};

const MAX_PACKET: usize = 8 * 1024 * 1024;
type Reply = Result<Value, String>;
struct Pending {
    sender: oneshot::Sender<Reply>,
    method: String,
}
#[derive(Clone)]
pub struct EventSender {
    critical: mpsc::UnboundedSender<Event>,
    quota: mpsc::Sender<Event>,
}
pub struct EventReceiver {
    critical: mpsc::UnboundedReceiver<Event>,
    quota: mpsc::Receiver<Event>,
}
pub fn event_channel() -> (EventSender, EventReceiver) {
    let (critical, crx) = mpsc::unbounded_channel();
    let (quota, qrx) = mpsc::channel(128);
    (
        EventSender { critical, quota },
        EventReceiver {
            critical: crx,
            quota: qrx,
        },
    )
}
impl EventReceiver {
    pub async fn recv(&mut self) -> Option<Event> {
        tokio::select! {biased;event=self.critical.recv()=>event,event=self.quota.recv()=>event}
    }
}

pub const DISCONNECTED: &str = "Codex connection stopped. Refresh to reconnect.";
#[derive(Debug)]
pub struct Event {
    pub account: String,
    pub generation: String,
    pub method: String,
    pub params: Value,
}
pub struct Rpc {
    writer: Mutex<ChildStdin>,
    child: Mutex<Child>,
    pending: StdMutex<HashMap<u64, Pending>>,
    active_login: StdMutex<Option<String>>,
    quota_pending: AtomicBool,
    turns: tokio::sync::broadcast::Sender<Value>,
    next: AtomicU64,
    alive: AtomicBool,
    pub generation: String,
}
struct PendingGuard<'a> {
    rpc: &'a Rpc,
    id: u64,
}
impl Drop for PendingGuard<'_> {
    fn drop(&mut self) {
        self.rpc.pending.lock().unwrap().remove(&self.id);
    }
}
impl Rpc {
    pub async fn start(
        executable: &Path,
        home: &Path,
        workspace: Option<&str>,
        account: String,
        events: EventSender,
    ) -> Result<Arc<Self>, String> {
        Self::start_mode(executable, home, workspace, account, events, false).await
    }
    pub async fn start_original(
        executable: &Path,
        home: &Path,
        account: String,
        events: EventSender,
    ) -> Result<Arc<Self>, String> {
        Self::start_mode(executable, home, None, account, events, true).await
    }
    async fn start_mode(
        executable: &Path,
        home: &Path,
        workspace: Option<&str>,
        account: String,
        events: EventSender,
        original: bool,
    ) -> Result<Arc<Self>, String> {
        let mut command = Command::new(executable);
        command.args([
            "app-server",
            "--listen",
            "stdio://",
            "-c",
            "analytics.enabled=false",
        ]);
        // The original app's storage mode has been validated by the signed Swift bridge.
        // Respect that configuration; account homes always require the direct keyring.
        if !original {
            command.args([
                "-c",
                "cli_auth_credentials_store=\"keyring\"",
                "-c",
                "auth_keyring_backend=\"direct\"",
            ]);
        }
        if let Some(ws) = workspace {
            command
                .arg("-c")
                .arg(format!("forced_chatgpt_workspace_id=\"{ws}\""));
        }
        // Allow only OS/runtime/network settings. Authentication and parent app overrides never cross profiles.
        command.env_clear();
        for key in [
            "HOME",
            "USERPROFILE",
            "HOMEDRIVE",
            "HOMEPATH",
            "PATH",
            "SystemRoot",
            "WINDIR",
            "COMSPEC",
            "PATHEXT",
            "TMP",
            "TEMP",
            "TMPDIR",
            "USER",
            "USERNAME",
            "LOGNAME",
            "LANG",
            "LC_ALL",
            "LC_CTYPE",
            "XDG_RUNTIME_DIR",
            "DBUS_SESSION_BUS_ADDRESS",
            "DISPLAY",
            "WAYLAND_DISPLAY",
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
            "no_proxy",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "CODEX_CA_CERTIFICATE",
        ] {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        command
            .env("CODEX_HOME", home)
            .env("CODEX_SQLITE_HOME", home.join("sqlite"));
        command
            .current_dir(home)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x08000000); // no console window
        let mut child = command.spawn().map_err(|_| {
            "Could not start Codex. Choose a native Codex executable and retry.".to_string()
        })?;
        let writer = child.stdin.take().ok_or(DISCONNECTED)?;
        let mut stdout = child.stdout.take().ok_or(DISCONNECTED)?;
        let rpc = Arc::new(Self {
            writer: Mutex::new(writer),
            child: Mutex::new(child),
            pending: StdMutex::new(HashMap::new()),
            active_login: StdMutex::new(None),
            quota_pending: AtomicBool::new(false),
            turns: tokio::sync::broadcast::channel(16).0,
            next: AtomicU64::new(1),
            alive: AtomicBool::new(true),
            generation: uuid::Uuid::new_v4().to_string(),
        });
        let weak: Weak<Self> = Arc::downgrade(&rpc);
        let generation = rpc.generation.clone();
        tokio::spawn(async move {
            let mut buffer = Vec::new();
            let mut chunk = [0u8; 8192];
            'read: loop {
                let count = match stdout.read(&mut chunk).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => n,
                };
                for byte in &chunk[..count] {
                    if *byte != b'\n' {
                        buffer.push(*byte);
                        if buffer.len() > MAX_PACKET {
                            break 'read;
                        }
                        continue;
                    }
                    let packet = serde_json::from_slice::<Value>(&buffer);
                    buffer.clear();
                    let Some(rpc) = weak.upgrade() else {
                        break 'read;
                    };
                    let Ok(packet) = packet else {
                        continue;
                    };
                    if let Some(id) = packet
                        .get("id")
                        .filter(|_| packet.get("method").is_none())
                        .and_then(Value::as_u64)
                    {
                        let sender = rpc.pending.lock().unwrap().remove(&id);
                        if let Some(sender) = sender {
                            let result = if let Some(error) = packet.get("error") {
                                Err(safe_error(error.get("message").and_then(Value::as_str)))
                            } else {
                                Ok(packet.get("result").cloned().unwrap_or(Value::Null))
                            };
                            if sender.method == "account/login/start" {
                                *rpc.active_login.lock().unwrap() = result
                                    .as_ref()
                                    .ok()
                                    .and_then(|v| v.get("loginId"))
                                    .and_then(Value::as_str)
                                    .map(str::to_string);
                            }
                            let _ = sender.sender.send(result);
                            continue;
                        }
                    }
                    if packet.get("method").and_then(Value::as_str) == Some("turn/completed") {
                        let _ = rpc
                            .turns
                            .send(packet.get("params").cloned().unwrap_or(Value::Null));
                    }
                    if let Some(method) = packet.get("method").and_then(Value::as_str) {
                        if let Some(id) = packet.get("id") {
                            if tokio::time::timeout(Duration::from_secs(5),rpc.write(json!({"id":id,"error":{"code":-32601,"message":"Unsupported method"}}))).await.is_err(){break 'read;}
                        } else if matches!(
                            method,
                            "account/login/completed"
                                | "account/rateLimits/updated"
                                | "account/updated"
                        ) {
                            let event = Event {
                                account: account.clone(),
                                generation: generation.clone(),
                                method: method.into(),
                                params: packet.get("params").cloned().unwrap_or(Value::Null),
                            };
                            if method == "account/login/completed" {
                                // Only the one accepted login can produce a terminal event; server spam is dropped here.
                                let mut active = rpc.active_login.lock().unwrap();
                                if active.as_deref().is_some_and(|id| {
                                    Some(id) == event.params.get("loginId").and_then(Value::as_str)
                                }) {
                                    active.take();
                                    let _ = events.critical.send(event);
                                }
                            } else if !rpc.quota_pending.swap(true, Ordering::SeqCst) {
                                if events.quota.try_send(event).is_err() {
                                    rpc.quota_pending.store(false, Ordering::SeqCst);
                                }
                            }
                        }
                    }
                }
            }
            if let Some(rpc) = weak.upgrade() {
                rpc.fail_pending();
                let _ = rpc.child.lock().await.start_kill();
                let _ = events.critical.send(Event {
                    account,
                    generation,
                    method: "transport/exited".into(),
                    params: Value::Null,
                });
            }
        });
        if let Err(error) = rpc.request("initialize", json!({"clientInfo":{"name":"codexdeck","title":"CodexDeck","version":env!("CARGO_PKG_VERSION")}}), 35).await {
            rpc.stop().await; return Err(error);
        }
        if let Err(error) = rpc.write(json!({"method":"initialized"})).await {
            rpc.stop().await;
            return Err(error);
        }
        Ok(rpc)
    }
    pub fn subscribe_turns(&self) -> tokio::sync::broadcast::Receiver<Value> {
        self.turns.subscribe()
    }
    pub fn acknowledge_quota(&self) {
        self.quota_pending.store(false, Ordering::SeqCst);
    }
    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }
    async fn write(&self, packet: Value) -> Result<(), String> {
        let mut bytes = serde_json::to_vec(&packet)
            .map_err(|_| "Could not encode Codex request.".to_string())?;
        bytes.push(b'\n');
        self.writer
            .lock()
            .await
            .write_all(&bytes)
            .await
            .map_err(|_| DISCONNECTED.to_string())
    }
    pub async fn request(&self, method: &str, params: Value, seconds: u64) -> Reply {
        if !self.is_alive() {
            return Err(DISCONNECTED.into());
        }
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        let (sender, receiver) = oneshot::channel();
        if method == "account/login/cancel" {
            self.active_login.lock().unwrap().take();
        }
        self.pending.lock().unwrap().insert(
            id,
            Pending {
                sender,
                method: method.into(),
            },
        );
        let _guard = PendingGuard { rpc: self, id };
        let outcome = tokio::time::timeout(Duration::from_secs(seconds), async {
            self.write(json!({"id":id,"method":method,"params":params}))
                .await?;
            receiver.await.map_err(|_| DISCONNECTED.to_string())?
        })
        .await;
        match outcome {
            Ok(value) => value,
            Err(_) => {
                self.stop().await;
                Err("Codex did not respond in time. Check your connection and retry.".into())
            }
        }
    }
    fn fail_pending(&self) {
        self.alive.store(false, Ordering::SeqCst);
        for (_, sender) in self.pending.lock().unwrap().drain() {
            let _ = sender.sender.send(Err(DISCONNECTED.into()));
        }
    }
    pub async fn stop(&self) {
        self.fail_pending();
        let mut child = self.child.lock().await;
        let _ = child.start_kill();
        let _ = tokio::time::timeout(Duration::from_secs(3), child.wait()).await;
    }
}
pub fn safe_error(message: Option<&str>) -> String {
    let text = message.unwrap_or_default().to_ascii_lowercase();
    if ["keyring","keychain","credential store","secret service"].iter().any(|s| text.contains(s)) { "The operating system credential store is unavailable or locked. Enable it and retry; credentials will not be saved to a file." }
    else if ["401","unauthorized","not authenticated","log in","sign in","refresh token"].iter().any(|s| text.contains(s)) { "Your sign-in expired. Sign in again." }
    else if ["403","permission","workspace"].iter().any(|s| text.contains(s)) { "Check account and workspace access." }
    else if text.contains("429") || text.contains("too many") { "Too many requests. Try again later." }
    else { "Could not read Codex account information. Check your connection and retry." }.into()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn raw_errors_never_escape() {
        assert!(!safe_error(Some("access_token=secret")).contains("secret"));
        assert!(safe_error(Some("401 bearer secret")).contains("Sign in"));
    }
}

#[cfg(all(test, unix))]
mod transport_tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    const FIXTURE: &str = r#"#!/usr/bin/env python3
import json,os,sys
assert os.path.realpath(os.environ['CODEX_HOME'])==os.path.realpath(os.getcwd())
assert all(k not in os.environ for k in ['OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN','OPENAI_BASE_URL','CODEX_ELECTRON_USER_DATA_PATH','CODEX_HOME_OVERRIDE'])
assert 'cli_auth_credentials_store="keyring"' in sys.argv
assert 'analytics.enabled=false' in sys.argv
ready=False

def emit(v):
    print(json.dumps(v),flush=True)
for line in sys.stdin:
    p=json.loads(line)
    m=p.get('method')
    if m=='initialize':
        assert p['params']['clientInfo']['name']=='codexdeck'
        emit({'id':p['id'],'method':'tool/call','params':{}})
        emit({'id':p['id'],'result':{'userAgent':'synthetic'}})
    elif m=='initialized':
        ready=True
        emit({'id':'untrusted-tool-request','method':'tool/call','params':{'secret':'synthetic-only'}})
    elif m=='account/read':
        assert ready
        assert p['params']=={'refreshToken':False}
        emit({'id':p['id'],'result':{'account':{'type':'chatgpt','email':'synthetic@example.test','planType':'pro'},'workspaceRouting':{'chatgptAccountId':'synthetic-workspace'}}})
    elif m=='account/rateLimits/read':
        emit({'id':p['id'],'result':{'rateLimitsByLimitId':{'codex':{'primary':{'usedPercent':40,'windowDurationMins':300,'resetsAt':1900000000}},'additional':{'planType':'pro'}},'rateLimitResetCredits':{'availableCount':2}}})
    elif m=='account/login/start':
        for i in range(500):
            emit({'method':'account/rateLimits/updated','params':{}})
        emit({'id':p['id'],'result':{'type':'chatgpt','loginId':'synthetic-login','authUrl':'https://auth.openai.com/synthetic'}})
        emit({'method':'account/login/completed','params':{'loginId':'wrong-login','success':True}})
        emit({'method':'account/login/completed','params':{'loginId':'synthetic-login','success':True}})
        emit({'method':'account/login/completed','params':{'loginId':'synthetic-login','success':True}})
    elif m in ['account/login/cancel','account/logout']:
        emit({'id':p['id'],'result':{}})
    elif m=='fixture/exit':
        os._exit(0)
    elif m=='fixture/timeout':
        pass
    elif m=='fixture/oversize':
        sys.stdout.write('x'*(8*1024*1024+1));sys.stdout.flush()
"#;
    fn fixture() -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let binary = dir.path().join("synthetic-codex");
        std::fs::write(&binary, FIXTURE).unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
        let home = dir.path().join("profile");
        std::fs::create_dir(&home).unwrap();
        (dir, binary, home)
    }
    #[tokio::test]
    async fn original_home_reads_respect_config_without_forcing_keyring() {
        let (_dir, binary, home) = fixture();
        let original_fixture = FIXTURE.replace("assert 'cli_auth_credentials_store=\"keyring\"' in sys.argv", "assert not any('cli_auth_credentials_store' in arg or 'auth_keyring_backend' in arg or 'forced_chatgpt_workspace_id' in arg for arg in sys.argv)");
        std::fs::write(&binary, original_fixture).unwrap();
        let (tx, _rx) = event_channel();
        let rpc = Rpc::start_original(&binary, &home, "synthetic-original".into(), tx)
            .await
            .unwrap();
        let identity = rpc
            .request("account/read", json!({"refreshToken":false}), 3)
            .await
            .unwrap();
        assert_eq!(identity["account"]["email"], "synthetic@example.test");
        rpc.stop().await;
    }
    #[tokio::test]
    async fn handshake_account_quotas_login_cancel_and_logout() {
        let (_dir, binary, home) = fixture();
        let (tx, mut rx) = event_channel();
        let rpc = Rpc::start(&binary, &home, None, "synthetic-account".into(), tx)
            .await
            .unwrap();
        let account = rpc
            .request("account/read", json!({"refreshToken":false}), 3)
            .await
            .unwrap();
        assert_eq!(account["account"]["email"], "synthetic@example.test");
        let quotas = rpc
            .request("account/rateLimits/read", json!({}), 3)
            .await
            .unwrap();
        let snapshot: crate::models::UsageSnapshot = serde_json::from_value(quotas).unwrap();
        assert_eq!(snapshot.rate_limits_by_limit_id.unwrap().len(), 2);
        assert_eq!(
            snapshot.rate_limit_reset_credits.unwrap().available_count,
            Some(2)
        );
        let login = rpc
            .request("account/login/start", json!({"type":"chatgpt"}), 3)
            .await
            .unwrap();
        assert_eq!(login["loginId"], "synthetic-login");
        let event = tokio::time::timeout(Duration::from_secs(3), rx.critical.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(event.method, "account/login/completed");
        assert_eq!(event.generation, rpc.generation);
        assert_eq!(event.params["loginId"], login["loginId"]);
        rpc.request(
            "account/login/cancel",
            json!({"loginId":"synthetic-login"}),
            3,
        )
        .await
        .unwrap();
        rpc.request("account/logout", json!({}), 3).await.unwrap();
        rpc.stop().await;
        assert!(!rpc.is_alive());
        assert!(rpc.pending.lock().unwrap().is_empty());
    }
    #[tokio::test]
    async fn timeout_and_exit_release_pending_requests() {
        let (_dir, binary, home) = fixture();
        let (tx, _rx) = event_channel();
        let rpc = Rpc::start(&binary, &home, None, "synthetic".into(), tx)
            .await
            .unwrap();
        assert!(rpc
            .request("fixture/timeout", json!({}), 1)
            .await
            .unwrap_err()
            .contains("time"));
        assert!(rpc.pending.lock().unwrap().is_empty());
        assert!(!rpc.is_alive());
        let (tx, _second_rx) = event_channel();
        let rpc = Rpc::start(&binary, &home, None, "synthetic".into(), tx)
            .await
            .unwrap();
        assert!(rpc.request("fixture/exit", json!({}), 3).await.is_err());
        assert!(!rpc.is_alive());
        assert!(rpc.pending.lock().unwrap().is_empty());
        rpc.stop().await;
    }
    #[tokio::test]
    async fn full_quota_queue_never_drops_or_blocks_login_completion() {
        let (_dir, binary, home) = fixture();
        let (tx, mut rx) = event_channel();
        for i in 0..128 {
            tx.quota
                .try_send(Event {
                    account: format!("other-{i}"),
                    generation: "synthetic".into(),
                    method: "account/rateLimits/updated".into(),
                    params: Value::Null,
                })
                .unwrap();
        }
        let rpc = Rpc::start(&binary, &home, None, "synthetic".into(), tx)
            .await
            .unwrap();
        let login = rpc
            .request("account/login/start", json!({"type":"chatgpt"}), 3)
            .await
            .unwrap();
        let event = tokio::time::timeout(Duration::from_secs(3), rx.critical.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(event.method, "account/login/completed");
        assert_eq!(event.params["loginId"], login["loginId"]);
        assert!(rx.critical.try_recv().is_err());
        // Reader remains free to resolve responses while the quota consumer has not drained its full queue.
        rpc.request("account/read", json!({"refreshToken":false}), 3)
            .await
            .unwrap();
        rpc.stop().await;
    }
    #[tokio::test]
    async fn oversized_packets_terminate_transport() {
        let (_dir, binary, home) = fixture();
        let (tx, _rx) = event_channel();
        let rpc = Rpc::start(&binary, &home, None, "synthetic".into(), tx)
            .await
            .unwrap();
        assert!(rpc.request("fixture/oversize", json!({}), 5).await.is_err());
        assert!(!rpc.is_alive());
        rpc.stop().await;
    }
}
