//! Native child webview panel (Web panel). Replaces the iframe, which most
//! sites block via X-Frame-Options / CSP frame-ancestors.
//!
//! Linux/WebKitGTK note: Tauri's high-level `add_child` packs child webviews
//! into the window's GtkBox, which auto-distributes space (splitting the window
//! in half) and ignores `set_position`/`set_size`. To position webviews over
//! grid cells we instead overlay a `gtk::Fixed` on top of the main webview (via
//! `gtk::Overlay`) and build raw `wry::WebView`s into it with explicit bounds —
//! the only path that honours coordinates on this backend. Web panels need no
//! IPC, so dropping to raw wry costs nothing.
//!
//! All GTK/wry objects are `!Send` and must live on the main (GTK) thread, so
//! they are kept in a thread-local registry and every mutation is dispatched via
//! `AppHandle::run_on_main_thread`.

use tauri::AppHandle;

use crate::error::AppResult;

#[cfg(target_os = "linux")]
mod imp {
    use std::cell::RefCell;
    use std::collections::HashMap;

    use gtk::prelude::*;
    use tauri::{AppHandle, Manager};
    use wry::dpi::{LogicalPosition, LogicalSize};
    use wry::{Rect, WebViewBuilder, WebViewBuilderExtUnix, WebViewExtUnix};

    use crate::error::{AppError, AppResult};

    /// One live web panel: its webview plus the last url (for reload).
    struct Entry {
        view: wry::WebView,
        url: String,
    }

    /// Per-process GTK state. Lives only on the main thread.
    struct WebState {
        fixed: gtk::Fixed,
        views: HashMap<String, Entry>,
    }

    thread_local! {
        static WEB: RefCell<Option<WebState>> = const { RefCell::new(None) };
    }

    fn rect(x: f64, y: f64, width: f64, height: f64) -> Rect {
        Rect {
            position: LogicalPosition::new(x, y).into(),
            size: LogicalSize::new(width.max(1.0), height.max(1.0)).into(),
        }
    }

    /// Reposition/resize a webview persistently inside the Fixed. wry's
    /// `set_bounds` only `size_allocate`s, which GTK reverts to the widget's
    /// `size_request` on the next relayout — so a splitter drag wouldn't stick.
    /// We instead move the Fixed child and update its size request directly,
    /// mirroring what `build_gtk(with_bounds)` does at creation.
    fn place(fixed: &gtk::Fixed, view: &wry::WebView, x: f64, y: f64, width: f64, height: f64) {
        let widget = view.webview();
        let (w, h) = (width.max(1.0).round() as i32, height.max(1.0).round() as i32);
        fixed.move_(&widget, x.round() as i32, y.round() as i32);
        widget.set_size_request(w, h);
        // GtkFixed allocates children their requested size, but the running
        // WebKitWebView won't shrink until a fresh size-allocate pass — force one.
        widget.size_allocate(&gtk::Allocation::new(
            x.round() as i32,
            y.round() as i32,
            w,
            h,
        ));
        widget.queue_resize();
        fixed.queue_resize();
    }

    /// Wrap the main webview in a `gtk::Overlay` and stack a transparent
    /// `gtk::Fixed` on top to host positioned child webviews. Runs on the main
    /// thread (Tauri setup hook).
    pub fn init_overlay(app: &AppHandle) -> AppResult<()> {
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| AppError::Other("main window not found".into()))?;
        let gtk_win = window
            .gtk_window()
            .map_err(|e| AppError::Other(format!("gtk_window: {e}")))?;
        // Tauri's undecorated-resizing handler is connected to the webview and
        // assumes `webview.parent().parent() == gtk::Window` (webview exactly two
        // levels below the window). So we cannot insert a container into that
        // chain. Instead we replace the window's child (the default GtkBox) with
        // a gtk::Overlay whose *base* is the webview and whose overlay layer is a
        // gtk::Fixed — keeping the webview exactly two levels below the window
        // while giving us a coordinate layer stacked on top of it.
        let vbox = window
            .default_vbox()
            .map_err(|e| AppError::Other(format!("default_vbox: {e}")))?;
        let webview = vbox
            .children()
            .into_iter()
            .last()
            .ok_or_else(|| AppError::Other("default_vbox has no webview child".into()))?;

        vbox.remove(&webview);
        gtk_win.remove(&vbox);

        let overlay = gtk::Overlay::new();
        overlay.add(&webview); // base child auto-fills the overlay

        let fixed = gtk::Fixed::new();
        fixed.set_halign(gtk::Align::Fill);
        fixed.set_valign(gtk::Align::Fill);
        overlay.add_overlay(&fixed);
        // Empty areas of the Fixed must not eat clicks meant for the main UI.
        overlay.set_overlay_pass_through(&fixed, true);

        gtk_win.add(&overlay);
        overlay.show_all();

        WEB.with(|w| {
            *w.borrow_mut() = Some(WebState {
                fixed,
                views: HashMap::new(),
            });
        });
        Ok(())
    }

    /// Dispatch `f` to the main thread with mutable access to the registry.
    fn on_main<F>(app: &AppHandle, f: F) -> AppResult<()>
    where
        F: FnOnce(&mut WebState) + Send + 'static,
    {
        app.run_on_main_thread(move || {
            WEB.with(|w| {
                if let Some(state) = w.borrow_mut().as_mut() {
                    f(state);
                }
            });
        })
        .map_err(|e| AppError::Other(format!("run_on_main_thread: {e}")))
    }

    pub fn upsert(
        app: &AppHandle,
        instance_id: String,
        url: String,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> AppResult<()> {
        on_main(app, move |state| {
            if let Some(entry) = state.views.get_mut(&instance_id) {
                if let Err(e) = entry.view.load_url(&url) {
                    eprintln!("web: load_url failed: {e}");
                } else {
                    entry.url = url;
                }
                place(&state.fixed, &entry.view, x, y, width, height);
                return;
            }
            match WebViewBuilder::new()
                .with_url(&url)
                .with_bounds(rect(x, y, width, height))
                .build_gtk(&state.fixed)
            {
                Ok(view) => {
                    state.views.insert(instance_id, Entry { view, url });
                }
                Err(e) => eprintln!("web: build_gtk failed: {e}"),
            }
        })
    }

    pub fn set_bounds(
        app: &AppHandle,
        instance_id: String,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> AppResult<()> {
        on_main(app, move |state| {
            if let Some(entry) = state.views.get(&instance_id) {
                place(&state.fixed, &entry.view, x, y, width, height);
            }
        })
    }

    pub fn set_visible(app: &AppHandle, instance_id: String, visible: bool) -> AppResult<()> {
        on_main(app, move |state| {
            if let Some(entry) = state.views.get(&instance_id) {
                let _ = entry.view.set_visible(visible);
            }
        })
    }

    pub fn reload(app: &AppHandle, instance_id: String) -> AppResult<()> {
        on_main(app, move |state| {
            if let Some(entry) = state.views.get(&instance_id) {
                if let Err(e) = entry.view.load_url(&entry.url) {
                    eprintln!("web: reload failed: {e}");
                }
            }
        })
    }

    pub fn close(app: &AppHandle, instance_id: String) -> AppResult<()> {
        on_main(app, move |state| {
            // Dropping the WebView removes its GTK widget from the Fixed.
            state.views.remove(&instance_id);
        })
    }
}

#[cfg(not(target_os = "linux"))]
mod imp {
    use tauri::AppHandle;

    use crate::error::AppResult;

    pub fn init_overlay(_app: &AppHandle) -> AppResult<()> {
        Ok(())
    }
    pub fn upsert(
        _app: &AppHandle,
        _instance_id: String,
        _url: String,
        _x: f64,
        _y: f64,
        _width: f64,
        _height: f64,
    ) -> AppResult<()> {
        Ok(())
    }
    pub fn set_bounds(
        _app: &AppHandle,
        _instance_id: String,
        _x: f64,
        _y: f64,
        _width: f64,
        _height: f64,
    ) -> AppResult<()> {
        Ok(())
    }
    pub fn set_visible(_app: &AppHandle, _instance_id: String, _visible: bool) -> AppResult<()> {
        Ok(())
    }
    pub fn reload(_app: &AppHandle, _instance_id: String) -> AppResult<()> {
        Ok(())
    }
    pub fn close(_app: &AppHandle, _instance_id: String) -> AppResult<()> {
        Ok(())
    }
}

/// Install the web-panel overlay. Call from Tauri's `setup` hook (main thread).
pub fn init_overlay(app: &AppHandle) -> AppResult<()> {
    imp::init_overlay(app)
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
    imp::upsert(&app, instance_id, url, x, y, width, height)
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
    imp::set_bounds(&app, instance_id, x, y, width, height)
}

#[tauri::command]
pub async fn web_set_visible(app: AppHandle, instance_id: String, visible: bool) -> AppResult<()> {
    imp::set_visible(&app, instance_id, visible)
}

#[tauri::command]
pub async fn web_reload(app: AppHandle, instance_id: String) -> AppResult<()> {
    imp::reload(&app, instance_id)
}

#[tauri::command]
pub async fn web_close(app: AppHandle, instance_id: String) -> AppResult<()> {
    imp::close(&app, instance_id)
}
