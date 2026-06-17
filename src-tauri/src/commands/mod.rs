//! Tauri command surface. Commands stay thin here and delegate to domain
//! modules as those land (pty, files, sysmon, workspace). M0 ships just a
//! health check so the frontend can confirm it reached its own backend.
//! M3 adds the terminal commands.

pub mod pty;
pub mod sysmon;

use serde::Serialize;

#[derive(Serialize)]
pub struct PingInfo {
    pub app: &'static str,
    pub version: &'static str,
}

#[tauri::command]
pub fn ping() -> PingInfo {
    PingInfo {
        app: "greedgrid",
        version: env!("CARGO_PKG_VERSION"),
    }
}
