//! Explicit, one-shot quota activation. A persisted claim precedes every send;
//! interrupted/uncertain requests are never replayed automatically.
use crate::{backend::Backend, models::*, storage};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashSet, sync::Arc, time::Duration};
use tauri::Emitter;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    pub account_id: String,
    pub label: String,
    pub status: String,
    pub resets_at: Option<f64>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub at: Option<f64>,
    pub status: String,
    pub rows: Vec<Row>,
}
fn active_window(snapshot: Option<&UsageSnapshot>, current: f64) -> Option<f64> {
    let window = snapshot?.five_hour()?;
    // A future reset can also be reported for an unused bucket. Require
    // observed usage before skipping a send or confirming activation.
    if !window.used_percent.is_finite() || window.used_percent <= 0.0 {
        return None;
    }
    window
        .resets_at
        .filter(|t| t.is_finite() && *t > current)
}
fn due(at: f64, current: f64, gap: f64) -> &'static str {
    if current < at {
        "pending"
    } else if current - at > 15.0 || gap > 20.0 {
        "missed"
    } else {
        "running"
    }
}
impl Backend {
    pub async fn warmup_state(&self) -> Option<Job> {
        self.saved.lock().await.warmup.clone()
    }
    async fn save_warmup(&self, job: Job) -> Result<(), String> {
        let mut saved = self.saved.lock().await;
        let previous = saved.warmup.replace(job.clone());
        if storage::save(&self.root, &saved).is_err() {
            saved.warmup = previous;
            return Err("Could not save quota activation.".into());
        }
        drop(saved);
        let _ = self.app.emit("warmup-changed", job);
        Ok(())
    }
    pub async fn plan_warmup(&self, ids: Vec<String>, at: Option<f64>) -> Result<Job, String> {
        self.writable()?;
        let _gate = self.warmup_gate.lock().await;
        if self
            .warmup_state()
            .await
            .is_some_and(|j| ["pending", "running"].contains(&j.status.as_str()))
        {
            return Err("A quota activation is already pending.".into());
        }
        if ids.is_empty()
            || ids.len() > 100
            || ids.iter().collect::<HashSet<_>>().len() != ids.len()
        {
            return Err("Select 1–100 distinct accounts.".into());
        }
        let current = now();
        if at.is_some_and(|t| !t.is_finite() || t < current + 5.0 || t > current + 30.0 * 86400.0) {
            return Err("Choose a future time within 30 days.".into());
        }
        let mut rows = Vec::new();
        for id in ids {
            let a = self.account(&id).await?;
            if !matches!(a.status, Status::Connected) {
                return Err("Select connected accounts.".into());
            }
            rows.push(Row {
                account_id: id,
                label: a.label,
                status: "queued".into(),
                resets_at: None,
            });
        }
        let job = Job {
            id: uuid::Uuid::new_v4().to_string(),
            at: Some(at.unwrap_or(current)),
            status: "pending".into(),
            rows,
        };
        self.save_warmup(job.clone()).await?;
        Ok(job)
    }
    pub async fn cancel_warmup(&self) -> Result<(), String> {
        self.writable()?;
        let _gate = self.warmup_gate.lock().await;
        let mut job = self.warmup_state().await.ok_or("No pending activation.")?;
        if job.status != "pending" {
            return Err("Only a pending activation can be cancelled.".into());
        }
        job.status = "cancelled".into();
        for row in &mut job.rows {
            row.status = "cancelled".into();
        }
        self.save_warmup(job).await
    }
    async fn activate_one(&self, id: &str) -> (&'static str, Option<f64>) {
        let lock = self.account_lock(id).await;
        let Ok(_guard) = lock.try_lock() else {
            return ("busy", None);
        };
        match self.account(id).await {
            Err(_) => return ("removed", None),
            Ok(a) if matches!(a.status, Status::SigningIn) => return ("busy", None),
            _ => {}
        }
        match self.read_account(id).await {
            Ok(true) => {}
            Ok(false) => return ("needsLogin", None),
            Err(_) => return ("failed", None),
        }
        let Ok(a) = self.account(id).await else {
            return ("removed", None);
        };
        // No known 5h bucket is not evidence of an inactive 5h window.
        if a.snapshot
            .as_ref()
            .and_then(UsageSnapshot::five_hour)
            .is_none()
        {
            return ("unknown", None);
        }
        if let Some(reset) = active_window(a.snapshot.as_ref(), now()) {
            return ("alreadyActive", Some(reset));
        }
        let Ok(client) = self.client(id).await else {
            return ("failed", None);
        };
        let Ok(workdir) = tempfile::tempdir() else {
            return ("failed", None);
        };
        let status = send_message(&client, workdir.path()).await;
        // Completion and activation are independent. Never invent now + five hours.
        for attempt in 0..3 {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
            if self.read_account(id).await == Ok(true) {
                if let Ok(a) = self.account(id).await {
                    if let Some(reset) = active_window(a.snapshot.as_ref(), now()) {
                        let _ = self.publish().await;
                        return ("confirmed", Some(reset));
                    }
                }
            }
        }
        let _ = self.publish().await;
        (status, None)
    }
}
async fn send_message(client: &crate::rpc::Rpc, workdir: &std::path::Path) -> &'static str {
    let thread = client.request("thread/start", json!({
            "ephemeral": true, "cwd": workdir, "approvalPolicy": "never", "sandbox": "read-only",
            "baseInstructions": "Reply only OK. Do not call tools or inspect files.",
            "developerInstructions": "This is a short connectivity check. Output only OK without tools.",
            "config": {"web_search":"disabled", "features.shell_tool":false, "features.apply_patch_freeform":false,
                "features.view_image_tool":false, "mcp_servers":{}, "apps._default.enabled":false}
        }), 35).await;
    let Some(thread_id) = thread
        .as_ref()
        .ok()
        .and_then(|v| v.pointer("/thread/id"))
        .and_then(Value::as_str)
    else {
        return "failed";
    };
    let mut completed = client.subscribe_turns();
    let turn = client.request("turn/start", json!({"threadId":thread_id,
            "input":[{"type":"text","text":"Reply only OK."}],
            "approvalPolicy":"never", "sandboxPolicy":{"type":"readOnly", "networkAccess":false}, "effort":"low"
        }), 35).await;
    // A transport timeout may have happened after the service accepted the message.
    let mut status = "uncertain";
    if let Ok(ref response) = turn {
        if let Some(turn_id) = response.pointer("/turn/id").and_then(Value::as_str) {
            let result = tokio::time::timeout(Duration::from_secs(60), async {
                loop {
                    let event = completed.recv().await.map_err(|_| ())?;
                    if event.get("threadId").and_then(Value::as_str) == Some(thread_id)
                        && event.pointer("/turn/id").and_then(Value::as_str) == Some(turn_id)
                    {
                        return Ok::<_, ()>(
                            event.pointer("/turn/status").and_then(Value::as_str)
                                == Some("completed"),
                        );
                    }
                }
            })
            .await;
            status = match result {
                Ok(Ok(true)) => "sent",
                Ok(Ok(false)) => "failed",
                _ => "uncertain",
            };
            if status == "uncertain" {
                let _ = client
                    .request(
                        "turn/interrupt",
                        json!({"threadId":thread_id,"turnId":turn_id}),
                        5,
                    )
                    .await;
            }
        }
    }
    let _ = client
        .request("thread/unsubscribe", json!({"threadId":thread_id}), 5)
        .await;
    status
}
fn recover(job: &mut Job, current: f64) -> bool {
    if job.status != "running" && !(job.status == "pending" && job.at.unwrap_or(0.0) <= current) {
        return false;
    }
    job.status = if job.status == "running" {
        "interrupted"
    } else {
        "missed"
    }
    .into();
    for row in &mut job.rows {
        if ["queued", "sending"].contains(&row.status.as_str()) {
            row.status = job.status.clone();
        }
    }
    true
}
pub fn background(core: Arc<Backend>) {
    tauri::async_runtime::spawn(async move {
        let startup_gate = core.warmup_gate.lock().await;
        // A restart never catches up or replays a previously claimed request.
        if let Some(mut job) = core.warmup_state().await {
            if recover(&mut job, now()) {
                if core.save_warmup(job).await.is_err() {
                    return;
                }
            }
        }
        drop(startup_gate);
        let mut checked = now();
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            let current = now();
            let gate = core.warmup_gate.lock().await;
            let job = core.warmup_state().await;
            let gap = current - checked;
            checked = current;
            let Some(mut job) = job.filter(|j| j.status == "pending") else {
                continue;
            };
            job.status = due(job.at.unwrap_or(0.0), current, gap).into();
            if job.status == "pending" {
                continue;
            }
            if job.status == "missed" {
                for row in &mut job.rows {
                    row.status = "missed".into();
                }
                let _ = core.save_warmup(job).await;
                continue;
            }
            // Claim the batch on disk before any inference, including immediate jobs.
            if core.save_warmup(job.clone()).await.is_err() {
                continue;
            }
            drop(gate);
            for index in 0..job.rows.len() {
                job.rows[index].status = "sending".into();
                if core.save_warmup(job.clone()).await.is_err() {
                    break;
                }
                let (status, resets_at) = core.activate_one(&job.rows[index].account_id).await;
                job.rows[index].status = status.into();
                job.rows[index].resets_at = resets_at;
                if core.save_warmup(job.clone()).await.is_err() {
                    break;
                }
            }
            job.status = "complete".into();
            for row in &mut job.rows {
                if ["queued", "sending"].contains(&row.status.as_str()) {
                    row.status = "interrupted".into();
                    job.status = "interrupted".into();
                }
            }
            let _ = core.save_warmup(job).await;
            checked = now();
        }
    });
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn persisted_jobs_recover_without_replaying_inference() {
        let root = tempfile::tempdir().unwrap();
        let mut saved = storage::Saved::default();
        saved.warmup = Some(Job {
            id: "test".into(),
            at: Some(200.0),
            status: "running".into(),
            rows: vec![
                Row {
                    account_id: "a".into(),
                    label: "A".into(),
                    status: "sent".into(),
                    resets_at: None,
                },
                Row {
                    account_id: "b".into(),
                    label: "B".into(),
                    status: "sending".into(),
                    resets_at: None,
                },
                Row {
                    account_id: "c".into(),
                    label: "C".into(),
                    status: "queued".into(),
                    resets_at: None,
                },
            ],
        });
        storage::save(root.path(), &saved).unwrap();
        let mut job = storage::load(root.path()).unwrap().warmup.unwrap();
        assert!(recover(&mut job, 100.0));
        assert_eq!(job.status, "interrupted");
        assert_eq!(job.rows[0].status, "sent");
        assert_eq!(job.rows[1].status, "interrupted");
        assert_eq!(job.rows[2].status, "interrupted");
        job.status = "pending".into();
        assert!(!recover(&mut job, 199.0));
        assert!(recover(&mut job, 200.0));
        assert_eq!(job.status, "missed");
    }
    #[test]
    fn missed_schedules_do_not_catch_up_after_sleep() {
        assert_eq!(due(100.0, 99.0, 1.0), "pending");
        assert_eq!(due(100.0, 101.0, 1.0), "running");
        assert_eq!(due(100.0, 116.0, 1.0), "missed");
        assert_eq!(due(100.0, 101.0, 60.0), "missed");
    }
    #[test]
    fn only_used_server_five_hour_future_resets_are_active() {
        let s: UsageSnapshot = serde_json::from_value(json!({"rateLimits":{"primary":{"usedPercent":1,"windowDurationMins":300,"resetsAt":200}}})).unwrap();
        assert_eq!(active_window(Some(&s), 100.0), Some(200.0));
        assert_eq!(active_window(Some(&s), 200.0), None);
        assert_eq!(active_window(None, 100.0), None);
        let weekly: UsageSnapshot = serde_json::from_value(json!({"rateLimits":{"primary":{"usedPercent":1,"windowDurationMins":10080,"resetsAt":200}}})).unwrap();
        assert_eq!(active_window(Some(&weekly), 100.0), None);
    }
    #[test]
    fn future_reset_without_usage_does_not_skip_or_confirm_activation() {
        let mut s: UsageSnapshot = serde_json::from_value(json!({"rateLimits":{"primary":{"usedPercent":0,"windowDurationMins":300,"resetsAt":200}}})).unwrap();
        assert_eq!(active_window(Some(&s), 100.0), None);
        for used in [-1.0, f64::NAN, f64::INFINITY] {
            s.rate_limits
                .as_mut()
                .unwrap()
                .primary
                .as_mut()
                .unwrap()
                .used_percent = used;
            assert_eq!(active_window(Some(&s), 100.0), None);
        }
        s.rate_limits
            .as_mut()
            .unwrap()
            .primary
            .as_mut()
            .unwrap()
            .used_percent = 0.1;
        assert_eq!(active_window(Some(&s), 100.0), Some(200.0));
        for reset in [None, Some(f64::NAN), Some(f64::INFINITY), Some(99.0)] {
            s.rate_limits
                .as_mut()
                .unwrap()
                .primary
                .as_mut()
                .unwrap()
                .resets_at = reset;
            assert_eq!(active_window(Some(&s), 100.0), None);
        }
    }
}

#[cfg(all(test, unix))]
mod message_tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    #[tokio::test]
    async fn sends_once_and_handles_completion_before_start_response() {
        for terminal in ["completed", "failed"] {
            let dir = tempfile::tempdir().unwrap();
            let binary = dir.path().join("synthetic-codex");
            let script = r#"#!/usr/bin/env python3
import json,sys
sent=0
for line in sys.stdin:
 p=json.loads(line);m=p.get('method');v=p.get('params',{})
 def emit(x): print(json.dumps(x),flush=True)
 if m=='initialize': emit({'id':p['id'],'result':{}})
 elif m=='thread/start':
  assert v['ephemeral'] and v['sandbox']=='read-only' and v['approvalPolicy']=='never'
  assert v['config']['features.shell_tool']==False and v['config']['web_search']=='disabled'
  emit({'id':p['id'],'result':{'thread':{'id':'synthetic-thread'}}})
 elif m=='turn/start':
  sent+=1;assert sent==1
  assert v['threadId']=='synthetic-thread' and v['input']==[{'type':'text','text':'Reply only OK.'}]
  assert v['sandboxPolicy']=={'type':'readOnly','networkAccess':False}
  emit({'method':'turn/completed','params':{'threadId':'unrelated','turn':{'id':'wrong','status':'completed'}}})
  emit({'method':'turn/completed','params':{'threadId':'synthetic-thread','turn':{'id':'synthetic-turn','status':'TERMINAL'}}})
  emit({'id':p['id'],'result':{'turn':{'id':'synthetic-turn'}}})
 elif m=='thread/unsubscribe':
  assert sent==1
  emit({'id':p['id'],'result':{}})
"#.replace("TERMINAL", terminal);
            std::fs::write(&binary, script).unwrap();
            std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
            let (tx, _rx) = crate::rpc::event_channel();
            let client = crate::rpc::Rpc::start(&binary, dir.path(), None, "synthetic".into(), tx)
                .await
                .unwrap();
            assert_eq!(
                send_message(&client, dir.path()).await,
                if terminal == "completed" {
                    "sent"
                } else {
                    "failed"
                }
            );
            client.stop().await;
        }
    }
}
