//! Workspace persistence: save/load/list/delete named grid layouts as JSON files
//! under the app config's `workspaces/` dir. The layout is stored as an opaque
//! JSON string (its schema lives in the frontend `GridLayout`); we only validate
//! that it parses. File logic is isolated in dir-taking helpers so it is
//! unit-testable without a Tauri AppHandle.

use std::fs;
use std::path::Path;

use tauri::AppHandle;

use crate::error::{AppError, AppResult};
use crate::paths::{atomic_write, workspaces_dir};

fn validate_ws_name(name: &str) -> AppResult<()> {
    if name.is_empty() || name == "." || name == ".." || name.contains('/') {
        return Err(AppError::Other(format!("invalid workspace name: {name:?}")));
    }
    Ok(())
}

fn save_to(dir: &Path, name: &str, layout: &str) -> AppResult<()> {
    validate_ws_name(name)?;
    // Reject garbage before persisting; the frontend always sends valid JSON.
    serde_json::from_str::<serde_json::Value>(layout)
        .map_err(|e| AppError::Other(format!("invalid layout json: {e}")))?;
    atomic_write(&dir.join(format!("{name}.json")), layout.as_bytes())?;
    Ok(())
}

fn load_from(dir: &Path, name: &str) -> AppResult<String> {
    validate_ws_name(name)?;
    let contents = fs::read_to_string(dir.join(format!("{name}.json")))?;
    Ok(contents)
}

fn list_in(dir: &Path) -> AppResult<Vec<String>> {
    let mut names: Vec<String> = Vec::new();
    if !dir.exists() {
        return Ok(names);
    }
    for dent in fs::read_dir(dir)? {
        let path = dent?.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                names.push(stem.to_string());
            }
        }
    }
    names.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    Ok(names)
}

fn delete_in(dir: &Path, name: &str) -> AppResult<()> {
    validate_ws_name(name)?;
    let path = dir.join(format!("{name}.json"));
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

#[tauri::command]
pub fn ws_save(name: String, layout: String, app: AppHandle) -> AppResult<()> {
    save_to(&workspaces_dir(&app)?, &name, &layout)
}

#[tauri::command]
pub fn ws_load(name: String, app: AppHandle) -> AppResult<String> {
    load_from(&workspaces_dir(&app)?, &name)
}

#[tauri::command]
pub fn ws_list(app: AppHandle) -> AppResult<Vec<String>> {
    list_in(&workspaces_dir(&app)?)
}

#[tauri::command]
pub fn ws_delete(name: String, app: AppHandle) -> AppResult<()> {
    delete_in(&workspaces_dir(&app)?, &name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("greedgrid-ws-{}-{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn save_list_load_delete_lifecycle() {
        let dir = temp_dir("life");
        save_to(&dir, "beta", r#"{"grid":{"cols":[1],"rows":[1],"gap":4},"cells":[]}"#).unwrap();
        save_to(&dir, "alpha", r#"{"grid":{},"cells":[]}"#).unwrap();

        assert_eq!(list_in(&dir).unwrap(), vec!["alpha", "beta"]); // sorted, ext stripped

        let loaded = load_from(&dir, "beta").unwrap();
        assert!(loaded.contains("\"cells\""));

        delete_in(&dir, "alpha").unwrap();
        assert_eq!(list_in(&dir).unwrap(), vec!["beta"]);

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn save_rejects_bad_name_and_bad_json() {
        let dir = temp_dir("bad");
        assert!(save_to(&dir, "", "{}").is_err());
        assert!(save_to(&dir, "a/b", "{}").is_err());
        assert!(save_to(&dir, "..", "{}").is_err());
        assert!(save_to(&dir, "ok", "not json").is_err());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn list_in_returns_empty_for_missing_dir() {
        let mut p = std::env::temp_dir();
        p.push(format!("greedgrid-ws-missing-{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        assert_eq!(list_in(&p).unwrap(), Vec::<String>::new());
    }
}
