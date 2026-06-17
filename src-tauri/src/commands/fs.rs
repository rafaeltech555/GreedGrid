//! Custom filesystem commands for the File Browser panel. Stateless `std::fs`
//! operations; the frontend holds the current path and re-lists after each one.
//! Kept testable by isolating directory listing in `collect_entries`.

use std::fs;
use std::path::Path;

use crate::error::{AppError, AppResult};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64, // bytes; 0 for directories
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListResult {
    pub path: String, // the canonical absolute path actually listed
    pub entries: Vec<FileEntry>,
}

fn home_dir() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
}

/// Read a directory into sorted entries (dirs first, then case-insensitive name,
/// hidden files included). A per-entry metadata failure degrades that entry to
/// size 0 rather than failing the whole listing.
fn collect_entries(dir: &Path) -> std::io::Result<Vec<FileEntry>> {
    let mut entries: Vec<FileEntry> = Vec::new();
    for dent in fs::read_dir(dir)? {
        let dent = dent?;
        let name = dent.file_name().to_string_lossy().to_string();
        let (is_dir, size) = match dent.metadata() {
            Ok(m) => (m.is_dir(), if m.is_dir() { 0 } else { m.len() }),
            Err(_) => (false, 0),
        };
        entries.push(FileEntry { name, is_dir, size });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir) // dirs (true) before files (false)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
pub fn fs_list(path: Option<String>) -> AppResult<ListResult> {
    let raw = path.filter(|s| !s.is_empty()).unwrap_or_else(home_dir);
    let canon = fs::canonicalize(&raw)?;
    let entries = collect_entries(&canon)?;
    Ok(ListResult {
        path: canon.to_string_lossy().to_string(),
        entries,
    })
}

fn validate_name(name: &str) -> AppResult<()> {
    if name.is_empty() || name.contains('/') {
        return Err(AppError::Other(format!("invalid name: {name:?}")));
    }
    Ok(())
}

#[tauri::command]
pub fn fs_delete(path: String) -> AppResult<()> {
    let p = Path::new(&path);
    // symlink_metadata: don't follow links — deleting a symlink removes the link,
    // not its target.
    let meta = fs::symlink_metadata(p)?;
    if meta.file_type().is_dir() {
        fs::remove_dir_all(p)?; // permanent, recursive
    } else {
        fs::remove_file(p)?;
    }
    Ok(())
}

#[tauri::command]
pub fn fs_rename(path: String, new_name: String) -> AppResult<()> {
    validate_name(&new_name)?;
    let p = Path::new(&path);
    let parent = p
        .parent()
        .ok_or_else(|| AppError::Other("path has no parent".into()))?;
    fs::rename(p, parent.join(&new_name))?;
    Ok(())
}

#[tauri::command]
pub fn fs_mkdir(parent: String, name: String) -> AppResult<()> {
    validate_name(&name)?;
    fs::create_dir(Path::new(&parent).join(&name))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_subdir(tag: &str) -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("greedgrid-fs-{}-{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn fs_list_sorts_dirs_first_and_reports_sizes() {
        let dir = temp_subdir("list");
        fs::create_dir(dir.join("subdir")).unwrap();
        fs::write(dir.join("b.txt"), b"hello").unwrap(); // 5 bytes
        fs::write(dir.join("a.txt"), b"hi").unwrap(); // 2 bytes

        let res = fs_list(Some(dir.to_string_lossy().to_string())).unwrap();
        assert_eq!(
            res.path,
            fs::canonicalize(&dir).unwrap().to_string_lossy().to_string()
        );
        assert_eq!(res.entries.len(), 3);
        assert!(res.entries[0].is_dir);
        assert_eq!(res.entries[0].name, "subdir");
        assert_eq!(res.entries[1].name, "a.txt");
        assert_eq!(res.entries[1].size, 2);
        assert_eq!(res.entries[2].name, "b.txt");
        assert_eq!(res.entries[2].size, 5);

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn fs_mkdir_rename_delete_lifecycle() {
        let dir = temp_subdir("life");
        let base = dir.to_string_lossy().to_string();

        fs_mkdir(base.clone(), "foo".into()).unwrap();
        assert!(dir.join("foo").is_dir());

        fs_rename(dir.join("foo").to_string_lossy().to_string(), "bar".into()).unwrap();
        assert!(dir.join("bar").is_dir());
        assert!(!dir.join("foo").exists());

        // non-empty directory deletes recursively
        fs::write(dir.join("bar").join("x.txt"), b"x").unwrap();
        fs_delete(dir.join("bar").to_string_lossy().to_string()).unwrap();
        assert!(!dir.join("bar").exists());

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rename_and_mkdir_reject_bad_names() {
        let dir = temp_subdir("bad");
        let base = dir.to_string_lossy().to_string();

        assert!(fs_mkdir(base.clone(), "".into()).is_err());
        assert!(fs_mkdir(base.clone(), "a/b".into()).is_err());

        fs_mkdir(base.clone(), "ok".into()).unwrap();
        assert!(fs_rename(dir.join("ok").to_string_lossy().to_string(), "a/b".into()).is_err());

        fs::remove_dir_all(&dir).unwrap();
    }
}
