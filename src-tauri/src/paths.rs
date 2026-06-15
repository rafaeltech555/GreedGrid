//! Filesystem locations and safe write helpers. The workspace-persistence
//! milestone (M6) builds on these; for M0 we only expose the app config dir and
//! an atomic write so later code never invents its own path logic.
#![allow(dead_code)] // wired up in M6 (workspace persistence)

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

/// Per-user config directory for GreedGrid (e.g. ~/.config/com.rafaeltech555.greedgrid).
/// Created on first access.
pub fn config_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::Other(format!("no app config dir: {e}")))?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// The directory holding named workspace layout files (created on demand).
pub fn workspaces_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = config_dir(app)?.join("workspaces");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Write `contents` to `path` atomically: write a sibling temp file then rename,
/// so a crash mid-write can never leave a half-written layout document.
pub fn atomic_write(path: &Path, contents: &[u8]) -> AppResult<()> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, contents)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}
