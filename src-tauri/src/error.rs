//! Central error type. All Tauri commands return `AppResult<T>` so failures
//! cross the IPC boundary as a plain serialized string the frontend can show,
//! instead of panicking. New domains (pty, fs, sysmon, workspace) add variants
//! here as they land in later milestones.
#![allow(dead_code)] // variants/alias consumed as domain modules land

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Other(String),
}

pub type AppResult<T> = Result<T, AppError>;

// Tauri commands require their error type to be `Serialize`. We flatten to the
// human-readable message — the frontend only needs the text, not the variant.
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
