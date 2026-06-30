//! System tray indicator. The tray is created in `lib.rs` setup with id "main";
//! this command swaps its icon (neutral ↔ amber) and tooltip to reflect whether
//! any terminal is idle. Best-effort: if the tray is missing the call is a no-op.

use tauri::image::Image;
use tauri::AppHandle;

use crate::error::AppResult;

// Pre-rendered icon bytes baked into the binary (see icons/gen-tray-icons.py).
const NEUTRAL_PNG: &[u8] = include_bytes!("../../icons/tray-neutral.png");
const IDLE_PNG: &[u8] = include_bytes!("../../icons/tray-idle.png");

/// Update the tray icon + tooltip. `active` = some terminal is idle.
#[tauri::command]
pub fn set_idle_indicator(app: AppHandle, active: bool, tooltip: String) -> AppResult<()> {
    if let Some(tray) = app.tray_by_id("main") {
        let bytes = if active { IDLE_PNG } else { NEUTRAL_PNG };
        let img = Image::from_bytes(bytes)?;
        tray.set_icon(Some(img))?;
        tray.set_tooltip(Some(tooltip.as_str()))?;
    }
    Ok(())
}
