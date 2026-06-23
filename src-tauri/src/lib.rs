mod commands;
mod error;
mod paths;
mod pty;
mod sysmon;

use pty::PtyRegistry;
use sysmon::Sampler;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(PtyRegistry::default())
        .manage(Sampler::start())
        .setup(|app| {
            // Install the gtk::Fixed overlay that hosts web-panel webviews.
            let handle = app.handle().clone();
            if let Err(e) = commands::web::init_overlay(&handle) {
                eprintln!("web overlay init failed: {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::pty::term_open,
            commands::pty::term_write,
            commands::pty::term_resize,
            commands::pty::term_close,
            commands::pty::term_detach,
            commands::pty::term_list,
            commands::sysmon::sysmon_sample,
            commands::fs::fs_list,
            commands::fs::fs_delete,
            commands::fs::fs_rename,
            commands::fs::fs_mkdir,
            commands::workspace::ws_save,
            commands::workspace::ws_load,
            commands::workspace::ws_list,
            commands::workspace::ws_delete,
            commands::web::web_upsert,
            commands::web::web_set_bounds,
            commands::web::web_set_visible,
            commands::web::web_reload,
            commands::web::web_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
