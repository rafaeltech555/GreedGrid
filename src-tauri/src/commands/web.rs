//! Native child webview panel (Web panel). Replaces the iframe, which most
//! sites block via X-Frame-Options / CSP frame-ancestors. Each web panel owns
//! a child `Webview` labelled `web-{instanceId}`, positioned over its grid cell.
//!
//! Requires the Tauri `unstable` feature for the multi-webview API
//! (`Window::add_child`, `Manager::get_webview`).

use tauri::webview::WebviewBuilder;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl};

use crate::error::{AppError, AppResult};

/// Default singleton window label (no explicit label set in tauri.conf.json).
const MAIN_WINDOW: &str = "main";

/// Child-webview label for a panel instance.
fn label(instance_id: &str) -> String {
    format!("web-{instance_id}")
}

/// Parse a user-entered URL, mapping failure to a readable AppError.
fn parse_url(url: &str) -> AppResult<Url> {
    url.parse::<Url>()
        .map_err(|e| AppError::Other(format!("invalid url '{url}': {e}")))
}

#[tauri::command]
pub async fn web_upsert(
    app: AppHandle,
    instance_id: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> AppResult<()> {
    let parsed = parse_url(&url)?;
    let lbl = label(&instance_id);

    if let Some(existing) = app.get_webview(&lbl) {
        existing.navigate(parsed)?;
        return Ok(());
    }

    let wv_window = app
        .get_webview_window(MAIN_WINDOW)
        .ok_or_else(|| AppError::Other("main window not found".into()))?;
    let window = wv_window.as_ref().window();

    let builder = WebviewBuilder::new(&lbl, WebviewUrl::External(parsed));
    window.add_child(
        builder,
        LogicalPosition::new(x, y),
        LogicalSize::new(width.max(1.0), height.max(1.0)),
    )?;
    Ok(())
}

#[tauri::command]
pub async fn web_set_bounds(
    app: AppHandle,
    instance_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> AppResult<()> {
    if let Some(wv) = app.get_webview(&label(&instance_id)) {
        wv.set_position(LogicalPosition::new(x, y))?;
        wv.set_size(LogicalSize::new(width.max(1.0), height.max(1.0)))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn web_set_visible(
    app: AppHandle,
    instance_id: String,
    visible: bool,
) -> AppResult<()> {
    if let Some(wv) = app.get_webview(&label(&instance_id)) {
        if visible {
            wv.show()?;
        } else {
            wv.hide()?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn web_reload(app: AppHandle, instance_id: String) -> AppResult<()> {
    if let Some(wv) = app.get_webview(&label(&instance_id)) {
        wv.reload()?;
    }
    Ok(())
}

#[tauri::command]
pub async fn web_close(app: AppHandle, instance_id: String) -> AppResult<()> {
    if let Some(wv) = app.get_webview(&label(&instance_id)) {
        wv.close()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn label_prefixes_instance_id() {
        assert_eq!(label("abc123"), "web-abc123");
    }

    #[test]
    fn parse_url_accepts_https() {
        assert!(parse_url("https://example.com").is_ok());
    }

    #[test]
    fn parse_url_rejects_garbage() {
        assert!(parse_url("not a url").is_err());
    }
}
