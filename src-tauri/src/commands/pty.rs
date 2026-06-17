//! Tauri command layer for the Terminal panel. Thin wrappers that resolve
//! defaults, adapt the frontend `Channel` to the engine's `OutputSink`, and
//! delegate to `PtyRegistry`. All PTY logic lives in `crate::pty`.

use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::State;

use crate::error::AppResult;
use crate::pty::{OpenOpts, OutputSink, PtyRegistry};

/// Adapts a Tauri output `Channel` to the engine's `OutputSink`.
struct ChannelSink(Channel<Vec<u8>>);

impl OutputSink for ChannelSink {
    fn send(&self, data: Vec<u8>) {
        // The frontend went away mid-stream if this errors; the reader thread
        // keeps buffering into scrollback regardless, so just drop the error.
        let _ = self.0.send(data);
    }
}

/// $SHELL, falling back to /bin/bash.
fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
}

#[tauri::command]
pub async fn term_open(
    instance_id: String,
    shell: Option<String>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    channel: Channel<Vec<u8>>,
    state: State<'_, PtyRegistry>,
) -> AppResult<()> {
    let opts = OpenOpts {
        shell: shell.filter(|s| !s.is_empty()).unwrap_or_else(default_shell),
        cwd: cwd.filter(|s| !s.is_empty()),
        // Guard against a not-yet-measured frontend sending 0 — a degenerate PTY
        // size breaks ncurses apps (vim/htop).
        cols: cols.max(1),
        rows: rows.max(1),
    };
    state.open(&instance_id, opts, Arc::new(ChannelSink(channel)))
}

#[tauri::command]
pub async fn term_write(
    instance_id: String,
    data: Vec<u8>,
    state: State<'_, PtyRegistry>,
) -> AppResult<()> {
    state.write(&instance_id, &data)
}

#[tauri::command]
pub async fn term_resize(
    instance_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, PtyRegistry>,
) -> AppResult<()> {
    state.resize(&instance_id, cols, rows)
}

#[tauri::command]
pub async fn term_close(instance_id: String, state: State<'_, PtyRegistry>) -> AppResult<()> {
    state.close(&instance_id)
}
