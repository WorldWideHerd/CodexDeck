//! Optional, best-effort application health reporting. No account values, raw
//! failures, stable device identifier, or offline report queue enter this module.
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{mpsc, watch, Notify};
use uuid::Uuid;

const ORIGIN: &str = "https://codexdeck-api.worldwideherd.com";
const HEARTBEAT: Duration = Duration::from_secs(60);
const COOLDOWN: Duration = Duration::from_secs(300);

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum Diagnostic {
    Refresh,
    SignIn,
    Switch,
    Restore,
    Storage,
}
impl Diagnostic {
    fn fields(self) -> (&'static str, &'static str) {
        match self {
            Self::Refresh => ("refresh", "unknown"),
            Self::SignIn => ("sign_in", "unknown"),
            Self::Switch => ("switch_account", "unknown"),
            Self::Restore => ("restore", "unknown"),
            Self::Storage => ("storage", "storage_failed"),
        }
    }
}
#[derive(Clone, Copy)]
struct Control {
    enabled: bool,
    generation: u64,
    stop: bool,
}
struct Event {
    generation: u64,
    kind: Diagnostic,
}

pub struct Reporter {
    control: watch::Sender<Control>,
    events: mpsc::Sender<Event>,
    finished: Arc<Notify>,
}
impl Reporter {
    pub fn new(consent: Option<bool>) -> Self {
        let (control, rx) = watch::channel(Control {
            enabled: consent == Some(true),
            generation: 1,
            stop: false,
        });
        let (events, queue) = mpsc::channel(16);
        let finished = Arc::new(Notify::new());
        let completion = finished.clone();
        tauri::async_runtime::spawn(async move {
            worker(rx, queue).await;
            completion.notify_one();
        });
        Self {
            control,
            events,
            finished,
        }
    }
    pub fn set_consent(&self, consent: Option<bool>) {
        self.control.send_if_modified(|c| {
            let enabled = consent == Some(true);
            if c.enabled == enabled {
                return false;
            }
            c.enabled = enabled;
            c.generation = c.generation.wrapping_add(1);
            true
        });
    }
    pub fn record(&self, kind: Diagnostic) {
        let c = *self.control.borrow();
        if c.enabled && !c.stop {
            // Full queues drop events; app work never waits for reporting.
            let _ = self.events.try_send(Event {
                generation: c.generation,
                kind,
            });
        }
    }
    pub async fn shutdown(&self) {
        self.control.send_modify(|c| {
            c.enabled = false;
            c.stop = true;
            c.generation = c.generation.wrapping_add(1);
        });
        let _ = tokio::time::timeout(Duration::from_secs(6), self.finished.notified()).await;
    }
}

struct Session {
    id: Uuid,
    // Historical report protocol calls this install_id; it is random per consent
    // session, not a device fingerprint or a persisted installation identifier.
    report_id: String,
    generation: u64,
    sent: HashMap<Diagnostic, Instant>,
}
impl Session {
    fn new(generation: u64) -> Self {
        Self {
            id: Uuid::new_v4(),
            report_id: format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple()),
            generation,
            sent: HashMap::new(),
        }
    }
    fn allow(&mut self, kind: Diagnostic, now: Instant) -> bool {
        if self
            .sent
            .get(&kind)
            .is_some_and(|last| now.duration_since(*last) < COOLDOWN)
        {
            return false;
        }
        self.sent.insert(kind, now);
        true
    }
}
#[derive(Serialize)]
struct Presence {
    session_id: Uuid,
    online: bool,
}
#[derive(Serialize)]
struct Issue<'a> {
    event_id: Uuid,
    install_id: &'a str,
    kind: &'static str,
    app_version: &'static str,
    app_build: &'static str,
    occurred_at: i64,
    last_occurred_at: i64,
    count: u8,
    operation: &'static str,
    code: &'static str,
}
#[derive(Serialize)]
struct Batch<'a> {
    schema_version: u8,
    reports: [Issue<'a>; 1],
}
fn issue(session: &Session, kind: Diagnostic) -> Batch<'_> {
    let (operation, code) = kind.fields();
    let now = crate::models::now() as i64;
    Batch {
        schema_version: 1,
        reports: [Issue {
            event_id: Uuid::new_v4(),
            install_id: &session.report_id,
            kind: "issue",
            app_version: env!("CARGO_PKG_VERSION"),
            app_build: "1",
            occurred_at: now,
            last_occurred_at: now,
            count: 1,
            operation,
            code,
        }],
    }
}
fn client() -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(5))
        .user_agent(concat!("CodexDeck/", env!("CARGO_PKG_VERSION")))
        .build()
}
async fn post<T: Serialize>(
    client: &reqwest::Client,
    origin: &str,
    path: &str,
    data: &T,
) -> Result<u16, reqwest::Error> {
    // Both callers and payload types are native and private; no webview supplied
    // destination, Authorization header, cookies, query, or free-text field.
    Ok(client
        .post(format!("{origin}{path}"))
        .json(data)
        .send()
        .await?
        .status()
        .as_u16())
}
async fn worker(control: watch::Receiver<Control>, events: mpsc::Receiver<Event>) {
    let Ok(client) = client() else {
        return;
    };
    run(client, ORIGIN, control, events, HEARTBEAT).await;
}
async fn run(
    client: reqwest::Client,
    origin: &str,
    mut control: watch::Receiver<Control>,
    mut events: mpsc::Receiver<Event>,
    heartbeat: Duration,
) {
    let mut session: Option<Session> = None;
    let mut tick = tokio::time::interval_at(tokio::time::Instant::now() + heartbeat, heartbeat);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        let current = *control.borrow_and_update();
        if session
            .as_ref()
            .is_some_and(|s| !current.enabled || s.generation != current.generation)
        {
            let old = session.take().unwrap();
            // A final best-effort removal is the only request made while off.
            let _ = post(
                &client,
                origin,
                "/v1/presence",
                &Presence {
                    session_id: old.id,
                    online: false,
                },
            )
            .await;
            // Consent may have changed while the bounded cleanup was in flight.
            continue;
        }
        if current.stop {
            break;
        }
        if current.enabled && session.is_none() {
            let new = Session::new(current.generation);
            session = Some(new);
            let data = Presence {
                session_id: session.as_ref().unwrap().id,
                online: true,
            };
            tokio::select! { biased;
                _ = control.changed() => { continue; }
                _ = post(&client, origin, "/v1/presence", &data) => {}
            }
            tick.reset_after(heartbeat);
        }
        tokio::select! { biased;
            result = control.changed() => { if result.is_err() { break; } }
            _ = tick.tick(), if session.is_some() => {
                let data = Presence {session_id: session.as_ref().unwrap().id, online: true};
                tokio::select! { biased;
                    _ = control.changed() => {}
                    _ = post(&client, origin, "/v1/presence", &data) => {}
                }
            }
            event = events.recv() => {
                let Some(event) = event else { break; };
                if let Some(s) = session.as_mut() {
                    if event.generation == s.generation && s.allow(event.kind, Instant::now()) {
                        let data = issue(s, event.kind);
                        tokio::select! { biased;
                            _ = control.changed() => {}
                            _ = post(&client, origin, "/v1/reports", &data) => {}
                        }
                    }
                }
            }
        }
    }
}

/// Explicit operator-only connectivity check, before app/account initialization.
/// Uses production TLS/transport and a temporary presence, never a diagnostic.
pub async fn smoke_test() -> Result<(), String> {
    let client = client().map_err(|_| "Could not create HTTPS client")?;
    for path in ["/health", "/ready"] {
        let code = client
            .get(format!("{ORIGIN}{path}"))
            .send()
            .await
            .map_err(|_| format!("{path}: connection failed"))?
            .status()
            .as_u16();
        println!("{path}: HTTP {code}");
        if code != 200 {
            return Err(format!("{path}: expected HTTP 200"));
        }
    }
    let id = Uuid::new_v4();
    let online = post(
        &client,
        ORIGIN,
        "/v1/presence",
        &Presence {
            session_id: id,
            online: true,
        },
    )
    .await;
    // Always attempt cleanup, including ambiguous timeouts after server receipt.
    let offline = post(
        &client,
        ORIGIN,
        "/v1/presence",
        &Presence {
            session_id: id,
            online: false,
        },
    )
    .await;
    let online = online.map_err(|_| "presence online: connection failed")?;
    let offline = offline.map_err(|_| "presence cleanup: connection failed")?;
    println!("presence online: HTTP {online}; cleanup: HTTP {offline}");
    if online != 204 || offline != 204 {
        return Err("presence: expected HTTP 204".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reporting_requires_an_explicit_choice() {
        for value in [
            r#"{}"#,
            r#"{"reportingConsent":null}"#,
            r#"{"reportingConsent":false}"#,
        ] {
            let settings: crate::models::Settings = serde_json::from_str(value).unwrap();
            assert_ne!(settings.reporting_consent, Some(true));
        }
        let settings: crate::models::Settings =
            serde_json::from_str(r#"{"reportingConsent":true}"#).unwrap();
        assert_eq!(settings.reporting_consent, Some(true));
    }
    #[test]
    fn identifiers_rotate_and_payload_contains_only_allowlisted_fields() {
        let a = Session::new(1);
        let b = Session::new(2);
        assert_ne!(a.id, b.id);
        assert_ne!(a.report_id, b.report_id);
        assert_eq!(a.report_id.len(), 64);
        let value = serde_json::to_value(issue(&a, Diagnostic::Refresh)).unwrap();
        let report = value["reports"][0].as_object().unwrap();
        let mut fields: Vec<_> = report.keys().map(String::as_str).collect();
        fields.sort();
        assert_eq!(
            fields,
            [
                "app_build",
                "app_version",
                "code",
                "count",
                "event_id",
                "install_id",
                "kind",
                "last_occurred_at",
                "occurred_at",
                "operation"
            ]
        );
        assert_eq!(report["operation"], "refresh");
        assert_eq!(report["code"], "unknown");
        let presence = serde_json::to_value(Presence {
            session_id: a.id,
            online: true,
        })
        .unwrap();
        assert_eq!(presence.as_object().unwrap().len(), 2);
    }
    #[test]
    fn repeated_failures_are_bounded_per_category() {
        let mut s = Session::new(1);
        let now = Instant::now();
        assert!(s.allow(Diagnostic::Refresh, now));
        assert!(!s.allow(Diagnostic::Refresh, now + Duration::from_secs(299)));
        assert!(s.allow(Diagnostic::Storage, now));
        assert!(s.allow(Diagnostic::Refresh, now + COOLDOWN));
        assert_eq!(s.sent.len(), 2);
    }
    async fn mock_server(
        stall_online: bool,
    ) -> (
        String,
        mpsc::Receiver<(String, serde_json::Value)>,
        tokio::task::JoinHandle<()>,
    ) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (send, receive) = mpsc::channel(32);
        let handle = tokio::spawn(async move {
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                let send = send.clone();
                tokio::spawn(async move {
                    let mut bytes = Vec::new();
                    let mut buffer = [0u8; 2048];
                    let header_end = loop {
                        let n = socket.read(&mut buffer).await.unwrap();
                        if n == 0 {
                            return;
                        }
                        bytes.extend_from_slice(&buffer[..n]);
                        if let Some(offset) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
                            break offset + 4;
                        }
                    };
                    let headers = String::from_utf8_lossy(&bytes[..header_end]);
                    let path = headers
                        .lines()
                        .next()
                        .unwrap()
                        .split_whitespace()
                        .nth(1)
                        .unwrap()
                        .to_string();
                    let length = headers
                        .lines()
                        .find_map(|line| {
                            let (key, value) = line.split_once(':')?;
                            key.eq_ignore_ascii_case("content-length")
                                .then(|| value.trim().parse::<usize>().unwrap())
                        })
                        .unwrap();
                    while bytes.len() < header_end + length {
                        let n = socket.read(&mut buffer).await.unwrap();
                        if n == 0 {
                            return;
                        }
                        bytes.extend_from_slice(&buffer[..n]);
                    }
                    let body: serde_json::Value =
                        serde_json::from_slice(&bytes[header_end..header_end + length]).unwrap();
                    let stalled = stall_online && body["online"] == true;
                    send.send((path, body)).await.unwrap();
                    if stalled {
                        tokio::time::sleep(Duration::from_secs(30)).await;
                    }
                    let _ = socket
                        .write_all(b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n")
                        .await;
                });
            }
        });
        (format!("http://{address}"), receive, handle)
    }
    async fn observed(
        receive: &mut mpsc::Receiver<(String, serde_json::Value)>,
    ) -> (String, serde_json::Value) {
        tokio::time::timeout(Duration::from_secs(2), receive.recv())
            .await
            .unwrap()
            .unwrap()
    }
    fn test_reporter() -> (Reporter, watch::Receiver<Control>, mpsc::Receiver<Event>) {
        let (control, rx) = watch::channel(Control {
            enabled: false,
            generation: 1,
            stop: false,
        });
        let (events, queue) = mpsc::channel(16);
        (
            Reporter {
                control,
                events,
                finished: Arc::new(Notify::new()),
            },
            rx,
            queue,
        )
    }
    #[tokio::test]
    async fn network_reporting_is_gated_rotates_identity_and_discards_old_events() {
        let (origin, mut received, server) = mock_server(false).await;
        let (reporter, control, queue) = test_reporter();
        let runner = tokio::spawn(async move {
            run(
                reqwest::Client::builder().no_proxy().build().unwrap(),
                &origin,
                control,
                queue,
                HEARTBEAT,
            )
            .await;
        });
        reporter.record(Diagnostic::Refresh);
        assert!(
            tokio::time::timeout(Duration::from_millis(80), received.recv())
                .await
                .is_err()
        );
        reporter.set_consent(Some(true));
        let (path, initial) = observed(&mut received).await;
        assert_eq!(path, "/v1/presence");
        assert_eq!(initial["online"], true);
        reporter.record(Diagnostic::Refresh);
        let (path, report) = observed(&mut received).await;
        assert_eq!(path, "/v1/reports");
        assert_eq!(report["reports"][0]["operation"], "refresh");
        reporter.set_consent(Some(false));
        let (_, removal) = observed(&mut received).await;
        assert_eq!(removal["online"], false);
        assert_eq!(removal["session_id"], initial["session_id"]);
        reporter.record(Diagnostic::Storage);
        assert!(
            tokio::time::timeout(Duration::from_millis(80), received.recv())
                .await
                .is_err()
        );
        let old_generation = reporter.control.borrow().generation;
        reporter.set_consent(Some(true));
        let (_, next) = observed(&mut received).await;
        assert_ne!(initial["session_id"], next["session_id"]);
        // A buffered event belonging to a withdrawn session must never be sent.
        reporter
            .events
            .try_send(Event {
                generation: old_generation,
                kind: Diagnostic::Storage,
            })
            .unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(80), received.recv())
                .await
                .is_err()
        );
        reporter.control.send_modify(|c| {
            c.enabled = false;
            c.stop = true;
        });
        let (_, removal) = observed(&mut received).await;
        assert_eq!(removal["online"], false);
        tokio::time::timeout(Duration::from_secs(2), runner)
            .await
            .unwrap()
            .unwrap();
        server.abort();
    }
    #[tokio::test]
    async fn withdrawal_interrupts_a_slow_request_instead_of_waiting_for_network_timeout() {
        let (origin, mut received, server) = mock_server(true).await;
        let (reporter, control, queue) = test_reporter();
        let runner = tokio::spawn(async move {
            run(
                reqwest::Client::builder()
                    .no_proxy()
                    .timeout(Duration::from_secs(20))
                    .build()
                    .unwrap(),
                &origin,
                control,
                queue,
                HEARTBEAT,
            )
            .await;
        });
        reporter.set_consent(Some(true));
        let (_, initial) = observed(&mut received).await;
        assert_eq!(initial["online"], true);
        reporter.set_consent(Some(false));
        // The server deliberately never completes the online request. Removal
        // still arrives in <2s, proving the consent signal cancels that wait.
        let (_, removal) = observed(&mut received).await;
        assert_eq!(removal["online"], false);
        assert_eq!(removal["session_id"], initial["session_id"]);
        reporter.record(Diagnostic::Refresh);
        assert!(
            tokio::time::timeout(Duration::from_millis(80), received.recv())
                .await
                .is_err()
        );
        reporter.control.send_modify(|c| c.stop = true);
        tokio::time::timeout(Duration::from_secs(2), runner)
            .await
            .unwrap()
            .unwrap();
        server.abort();
    }
}
