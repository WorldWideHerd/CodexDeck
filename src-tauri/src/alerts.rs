use crate::models::UsageWindow;
use serde::{Deserialize, Serialize};
#[derive(Clone, Default, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertState {
    pub is_below: bool,
    pub last_reset: Option<f64>,
}
/// Reserves one delivery transition; caller must persist before sending, and roll back on failure.
pub fn evaluate(
    previous: &AlertState,
    window: Option<&UsageWindow>,
    threshold: f64,
    now: f64,
) -> (AlertState, bool) {
    let Some(w) = window else {
        return (previous.clone(), false);
    };
    if !threshold.is_finite()
        || !(1.0..=100.0).contains(&threshold)
        || w.window_duration_mins != Some(300)
        || !w.used_percent.is_finite()
        || !(0.0..=100.0).contains(&w.used_percent)
        || w.resets_at.is_some_and(|r| !r.is_finite() || r <= now)
    {
        return (previous.clone(), false);
    }
    let new_period = previous
        .last_reset
        .zip(w.resets_at)
        .is_some_and(|(a, b)| a != b);
    let mut next = previous.clone();
    next.last_reset = w.resets_at;
    if 100.0 - w.used_percent >= threshold {
        next.is_below = false;
        return (next, false);
    }
    if previous.is_below && !new_period {
        return (next, false);
    }
    next.is_below = true;
    (next, true)
}
pub fn reserve(
    previous: &AlertState,
    window: Option<&UsageWindow>,
    threshold: f64,
    now: f64,
    readiness: crate::notification::Readiness,
) -> (AlertState, bool) {
    let (mut next, wants_send) = evaluate(previous, window, threshold, now);
    if !readiness.can_send() {
        // A blocked crossing stays unreserved, but fresh quota recovery must still rearm.
        if wants_send {
            next.is_below = false;
        }
        return (next, false);
    }
    (next, wants_send)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn w(used: f64, reset: Option<f64>) -> UsageWindow {
        UsageWindow {
            used_percent: used,
            window_duration_mins: Some(300),
            resets_at: reset,
        }
    }
    #[test]
    fn transition_recovery_and_same_reset() {
        let (s, send) = evaluate(&AlertState::default(), Some(&w(91., Some(200.))), 10., 100.);
        assert!(send);
        assert!(!evaluate(&s, Some(&w(92., Some(200.))), 10., 100.).1);
        let (s, send) = evaluate(&s, Some(&w(80., Some(200.))), 10., 100.);
        assert!(!send);
        assert!(!s.is_below);
        assert!(evaluate(&s, Some(&w(95., Some(200.))), 10., 100.).1);
    }
    #[test]
    fn denied_permission_does_not_consume_transition() {
        let prior = AlertState::default();
        let (state, send) = reserve(
            &prior,
            Some(&w(95., None)),
            10.,
            100.,
            crate::notification::Readiness::Denied,
        );
        assert_eq!(state, prior);
        assert!(!send);
        assert!(
            reserve(
                &state,
                Some(&w(95., None)),
                10.,
                100.,
                crate::notification::Readiness::Ready
            )
            .1
        );
    }
    #[test]
    fn recovery_during_denial_rearms_same_period() {
        use crate::notification::Readiness;
        let (s, send) = reserve(
            &AlertState::default(),
            Some(&w(95., Some(200.))),
            10.,
            100.,
            Readiness::Ready,
        );
        assert!(send);
        let (s, send) = reserve(&s, Some(&w(80., Some(200.))), 10., 100., Readiness::Denied);
        assert!(!send);
        assert!(!s.is_below);
        assert!(reserve(&s, Some(&w(95., Some(200.))), 10., 100., Readiness::Ready).1);
    }
    #[test]
    fn equality_is_not_below() {
        assert!(!evaluate(&AlertState::default(), Some(&w(90., None)), 10., 100.).1);
    }
    #[test]
    fn restart_and_new_period() {
        let (s, _) = evaluate(&AlertState::default(), Some(&w(95., Some(200.))), 10., 100.);
        let s: AlertState = serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
        assert!(!evaluate(&s, Some(&w(95., Some(200.))), 10., 100.).1);
        assert!(evaluate(&s, Some(&w(95., Some(300.))), 10., 100.).1);
    }
    #[test]
    fn unknown_reset_deduplicates() {
        let (s, send) = evaluate(&AlertState::default(), Some(&w(95., None)), 10., 100.);
        assert!(send);
        assert!(!evaluate(&s, Some(&w(95., None)), 10., 100.).1);
    }
    #[test]
    fn invalid_or_expired_data_never_sends() {
        for used in [-1., 101., f64::NAN, f64::INFINITY] {
            assert!(!evaluate(&AlertState::default(), Some(&w(used, None)), 10., 100.).1);
        }
        assert!(!evaluate(&AlertState::default(), Some(&w(99., Some(90.))), 10., 100.).1);
    }
    #[test]
    fn failed_delivery_can_retry() {
        let prior = AlertState::default();
        assert!(evaluate(&prior, Some(&w(99., None)), 10., 100.).1);
        assert!(evaluate(&prior, Some(&w(99., None)), 10., 100.).1);
    }
}
