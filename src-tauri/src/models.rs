use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub used_percent: f64,
    pub window_duration_mins: Option<u64>,
    pub resets_at: Option<f64>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Credits {
    pub has_credits: Option<bool>,
    pub unlimited: Option<bool>,
    pub balance: Option<String>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndividualLimit {
    pub remaining_percent: Option<f64>,
    pub resets_at: Option<f64>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RateLimitBucket {
    pub limit_id: Option<String>,
    pub limit_name: Option<String>,
    pub primary: Option<UsageWindow>,
    pub secondary: Option<UsageWindow>,
    pub plan_type: Option<String>,
    pub credits: Option<Credits>,
    pub individual_limit: Option<IndividualLimit>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetCredit {
    pub id: String,
    pub status: Option<String>,
    pub granted_at: Option<f64>,
    pub expires_at: Option<f64>,
    pub title: Option<String>,
    pub description: Option<String>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetCredits {
    pub available_count: Option<u64>,
    pub credits: Option<Vec<ResetCredit>>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    pub rate_limits: Option<RateLimitBucket>,
    pub rate_limits_by_limit_id: Option<BTreeMap<String, RateLimitBucket>>,
    pub rate_limit_reset_credits: Option<ResetCredits>,
    pub account_id: Option<String>,
}
impl UsageSnapshot {
    pub fn five_hour(&self) -> Option<&UsageWindow> {
        let bucket = self
            .rate_limits_by_limit_id
            .as_ref()
            .and_then(|m| m.get("codex").or_else(|| m.values().next()))
            .or(self.rate_limits.as_ref())?;
        [bucket.primary.as_ref(), bucket.secondary.as_ref()]
            .into_iter()
            .flatten()
            .find(|w| w.window_duration_mins == Some(300))
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Idle,
    Refreshing,
    SigningIn,
    Connected,
    NeedsLogin,
    Failed,
}
impl Default for Status {
    fn default() -> Self {
        Self::Idle
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub label: String,
    pub email: Option<String>,
    pub plan: Option<String>,
    pub workspace_id: Option<String>,
    pub snapshot: Option<UsageSnapshot>,
    pub updated_at: Option<f64>,
    pub color: Option<String>,
    pub subscription_ends_at: Option<f64>,
    pub alert_threshold: Option<f64>,
    #[serde(default)]
    pub status: Status,
    pub error: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub calendar: String,
    pub language: String,
    pub appearance: String,
    pub refresh_minutes: u64,
    pub layout: String,
    pub sort: String,
    pub pinned: bool,
    // None uses the enabled default; Some(false) preserves an explicit opt-out.
    pub reporting_consent: Option<bool>,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            language: "en".into(),
            calendar: "persian".into(),
            appearance: "system".into(),
            refresh_minutes: 3,
            layout: "list".into(),
            sort: "manual".into(),
            pinned: false,
            reporting_consent: None,
        }
    }
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    pub accounts: Vec<Account>,
    pub settings: Settings,
    pub codex_executable: Option<String>,
    pub last_error: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginState {
    pub account_id: String,
    pub login_id: Option<String>,
    pub url: Option<String>,
    pub status: String,
    pub error: Option<String>,
}
impl LoginState {
    pub fn terminal(id: &str, status: &str, error: Option<String>) -> Self {
        Self {
            account_id: id.into(),
            login_id: None,
            url: None,
            status: status.into(),
            error,
        }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformCapabilities {
    pub platform: String,
    pub desktop_switch: bool,
    pub desktop_restore: bool,
    pub reason: Option<String>,
}

pub fn capabilities() -> PlatformCapabilities {
    let desktop_switch = crate::desktop::available();
    PlatformCapabilities {
        platform: std::env::consts::OS.into(),
        desktop_switch,
        desktop_restore: desktop_switch,
        reason: if desktop_switch {
            None
        } else {
            Some(crate::desktop::unavailable_reason().into())
        },
    }
}
pub fn now() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}
pub fn valid_workspace(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 200
        && s.bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}
pub fn valid_id(s: &str) -> bool {
    uuid::Uuid::parse_str(s)
        .map(|u| u.to_string() == s)
        .unwrap_or(false)
}

// Command-only metadata, never persisted or emitted as background state.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshResult {
    #[serde(flatten)]
    pub state: AppState,
    pub refreshed_ids: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn refresh_metadata_preserves_the_existing_state_shape() {
        let result = RefreshResult {
            state: AppState::default(),
            refreshed_ids: vec!["read-by-this-request".into()],
        };
        let value = serde_json::to_value(result).unwrap();
        assert_eq!(value["refreshedIds"][0], "read-by-this-request");
        assert!(value["accounts"].is_array());
        let _: AppState = serde_json::from_value(value).unwrap();
        assert!(serde_json::to_value(AppState::default())
            .unwrap()
            .get("refreshedIds")
            .is_none());
    }
    #[test]
    fn snapshot_preserves_buckets_and_reset_credits() {
        let input = r#"{"rateLimitsByLimitId":{"codex":{"primary":{"usedPercent":92,"windowDurationMins":300,"resetsAt":1900000000}},"other":{"planType":"pro"}},"rateLimitResetCredits":{"availableCount":1,"credits":[{"id":"x","status":"available","expiresAt":1900000000}]}}"#;
        let s: UsageSnapshot = serde_json::from_str(input).unwrap();
        assert_eq!(s.five_hour().unwrap().used_percent, 92.0);
        assert_eq!(s.rate_limits_by_limit_id.as_ref().unwrap().len(), 2);
        assert_eq!(
            s.rate_limit_reset_credits.unwrap().credits.unwrap()[0].id,
            "x"
        );
    }
    #[test]
    fn workspace_cannot_inject_config() {
        assert!(valid_workspace("team_123-ab"));
        assert!(!valid_workspace("x\"\ncli_auth_credentials_store=\"file"));
        assert!(!valid_workspace(""));
    }
    #[test]
    fn ids_cannot_escape_profile_root() {
        assert!(!valid_id("../profiles"));
        assert!(valid_id(&uuid::Uuid::new_v4().to_string()));
    }
}
