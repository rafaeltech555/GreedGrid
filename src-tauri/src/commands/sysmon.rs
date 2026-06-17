//! Tauri command for the System Monitor panel. A thin, synchronous reader of the
//! shared `Sampler` snapshot — no refresh work happens here (the background
//! thread owns that), so this is just a mutex read + clone.

use tauri::State;

use crate::sysmon::{Sampler, SysSnapshot};

#[tauri::command]
pub fn sysmon_sample(state: State<'_, Sampler>) -> SysSnapshot {
    state.snapshot()
}
