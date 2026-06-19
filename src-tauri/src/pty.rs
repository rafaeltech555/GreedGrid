//! PTY engine: a registry of live pseudo-terminals keyed by panel instanceId.
//! Kept free of Tauri types so the lifecycle is unit-testable with `cargo test`.

use std::collections::HashMap;
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};

use crate::error::{AppError, AppResult};

/// Default scrollback capacity per session (~256 KB).
pub const SCROLLBACK_CAP: usize = 256 * 1024;

/// Fixed-capacity byte ring buffer. Oldest bytes are dropped once full so a
/// long-running terminal cannot grow memory without bound. On reconnect the
/// snapshot is replayed into the freshly-attached frontend.
pub struct ScrollbackBuffer {
    buf: VecDeque<u8>,
    cap: usize,
}

impl ScrollbackBuffer {
    pub fn new(cap: usize) -> Self {
        Self {
            buf: VecDeque::new(),
            cap,
        }
    }

    pub fn push(&mut self, data: &[u8]) {
        // If a single chunk exceeds capacity, only the trailing `cap` bytes can
        // survive — keep just those and skip the per-byte drain entirely.
        if data.len() >= self.cap {
            self.buf.clear();
            self.buf.extend(data[data.len() - self.cap..].iter().copied());
            return;
        }
        self.buf.extend(data.iter().copied());
        while self.buf.len() > self.cap {
            self.buf.pop_front();
        }
    }

    pub fn snapshot(&self) -> Vec<u8> {
        self.buf.iter().copied().collect()
    }
}

/// Where a session's output bytes are pushed. The command layer adapts a Tauri
/// `Channel` to this trait; tests use an in-memory `Vec`. Keeping the engine
/// generic over this trait is what makes it testable without a frontend.
pub trait OutputSink: Send + Sync {
    fn send(&self, data: Vec<u8>);
}

/// Parameters for spawning a new PTY. Shell/cwd are already resolved to
/// concrete values by the command layer before reaching the engine.
pub struct OpenOpts {
    pub shell: String,
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
}

/// One live PTY. The reader thread is detached; it communicates through the
/// shared `scrollback` + `sink` handles, which is how reconnect swaps the sink
/// out from under a running thread without restarting it.
struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send>,
    scrollback: Arc<Mutex<ScrollbackBuffer>>,
    sink: Arc<Mutex<Option<Arc<dyn OutputSink>>>>,
    /// Resolved shell/cwd captured at spawn, surfaced to the frontend via `list`
    /// so a reattach UI can label detached sessions.
    shell: String,
    cwd: Option<String>,
}

/// Serializable summary of one session, returned by `PtyRegistry::list` for the
/// reattach UI. `camelCase` to match the TS side (same convention as
/// `SysSnapshot` in `sysmon.rs`).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub instance_id: String,
    pub shell: String,
    pub cwd: Option<String>,
    pub alive: bool,
    pub attached: bool,
}

/// Registry of live PTYs keyed by panel `instanceId`. Lives in Tauri app state.
#[derive(Default)]
pub struct PtyRegistry(Mutex<HashMap<String, PtySession>>);

impl PtyRegistry {
    /// Spawn a new session, or — if one already exists for `instance_id` —
    /// replay its scrollback into `sink` and re-attach it (the reconnect path).
    pub fn open(
        &self,
        instance_id: &str,
        opts: OpenOpts,
        sink: Arc<dyn OutputSink>,
    ) -> AppResult<()> {
        let mut map = self.0.lock().unwrap();

        if let Some(session) = map.get(instance_id) {
            let snapshot = session.scrollback.lock().unwrap().snapshot();
            if !snapshot.is_empty() {
                sink.send(snapshot);
            }
            *session.sink.lock().unwrap() = Some(sink);
            // Apply the reconnecting client's viewport so the shell isn't stuck at
            // the previous size until the next resize event.
            let _ = session.master.resize(PtySize {
                rows: opts.rows,
                cols: opts.cols,
                pixel_width: 0,
                pixel_height: 0,
            });
            return Ok(());
        }

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: opts.rows,
                cols: opts.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AppError::Other(format!("openpty: {e}")))?;

        let mut cmd = CommandBuilder::new(&opts.shell);
        if let Some(cwd) = &opts.cwd {
            cmd.cwd(cwd);
        }
        // Native terminals set TERM/COLORTERM for the child shell; when greedgrid is
        // launched from a desktop icon the GUI process has no TERM, so the child
        // would otherwise inherit an empty $TERM and colour-aware tools (bash
        // prompt, git, less, vim, tput) disable colour. Set them explicitly so
        // colour behaviour is consistent regardless of how the app was started.
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| AppError::Other(format!("spawn: {e}")))?;
        // Slave is held by the child now; drop our handle so EOF propagates on exit.
        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| AppError::Other(format!("clone reader: {e}")))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| AppError::Other(format!("take writer: {e}")))?;

        let scrollback = Arc::new(Mutex::new(ScrollbackBuffer::new(SCROLLBACK_CAP)));
        let sink_slot: Arc<Mutex<Option<Arc<dyn OutputSink>>>> =
            Arc::new(Mutex::new(Some(sink)));

        // Detached reader thread: append to scrollback, forward to the attached
        // sink (if any). Exits on EOF/error when the child dies.
        {
            let scrollback = scrollback.clone();
            let sink_slot = sink_slot.clone();
            thread::spawn(move || {
                let mut buf = [0u8; 8192];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            scrollback.lock().unwrap().push(&buf[..n]);
                            // Clone the attached sink out and release the lock before
                            // sending: keeps the (potentially slow) IPC send off the
                            // lock, and a panicking sink can't poison the mutex.
                            let attached = sink_slot.lock().unwrap().clone();
                            if let Some(sink) = attached {
                                sink.send(buf[..n].to_vec());
                            }
                        }
                    }
                }
            });
        }

        map.insert(
            instance_id.to_string(),
            PtySession {
                master: pair.master,
                writer,
                child,
                scrollback,
                sink: sink_slot,
                shell: opts.shell,
                cwd: opts.cwd,
            },
        );
        Ok(())
    }

    pub fn write(&self, instance_id: &str, data: &[u8]) -> AppResult<()> {
        let mut map = self.0.lock().unwrap();
        let session = map
            .get_mut(instance_id)
            .ok_or_else(|| AppError::Other(format!("no pty session: {instance_id}")))?;
        session.writer.write_all(data)?;
        session.writer.flush()?;
        Ok(())
    }

    pub fn resize(&self, instance_id: &str, cols: u16, rows: u16) -> AppResult<()> {
        let map = self.0.lock().unwrap();
        let session = map
            .get(instance_id)
            .ok_or_else(|| AppError::Other(format!("no pty session: {instance_id}")))?;
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AppError::Other(format!("resize: {e}")))?;
        Ok(())
    }

    pub fn close(&self, instance_id: &str) -> AppResult<()> {
        let mut map = self.0.lock().unwrap();
        // Idempotent: closing an unknown/already-closed session is a no-op, since
        // removal may race with the panel already being gone.
        if let Some(mut session) = map.remove(instance_id) {
            let _ = session.child.kill();
            let _ = session.child.wait(); // reap so we don't leak a zombie process
        }
        Ok(())
    }

    /// Detach the frontend from a session without killing it: clear the sink
    /// slot so the reader thread stops forwarding, while the child + reader keep
    /// running and scrollback keeps filling. Reattach later via `open`, which
    /// replays scrollback. Idempotent on unknown ids, like `close`.
    pub fn detach(&self, instance_id: &str) -> AppResult<()> {
        let map = self.0.lock().unwrap();
        if let Some(session) = map.get(instance_id) {
            *session.sink.lock().unwrap() = None;
        }
        Ok(())
    }

    /// Snapshot every live session for the reattach UI. `alive` reflects whether
    /// the child is still running (`try_wait` → `Ok(None)`); `attached` reflects
    /// whether a frontend sink is currently bound.
    pub fn list(&self) -> Vec<SessionInfo> {
        let mut map = self.0.lock().unwrap();
        // We hold the registry lock across `child.try_wait()`; that's fine because
        // `try_wait()` is non-blocking (same as `close` holding the lock across
        // `kill`/`wait`).
        map.iter_mut()
            .map(|(instance_id, session)| {
                let alive = matches!(session.child.try_wait(), Ok(None));
                let attached = session.sink.lock().unwrap().is_some();
                SessionInfo {
                    instance_id: instance_id.clone(),
                    shell: session.shell.clone(),
                    cwd: session.cwd.clone(),
                    alive,
                    attached,
                }
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrollback_keeps_bytes_under_capacity() {
        let mut sb = ScrollbackBuffer::new(8);
        sb.push(b"abc");
        assert_eq!(sb.snapshot(), b"abc");
    }

    #[test]
    fn scrollback_drops_oldest_over_capacity() {
        let mut sb = ScrollbackBuffer::new(4);
        sb.push(b"abc");
        sb.push(b"de"); // total "abcde" (5) > cap 4 → drop leading "a"
        assert_eq!(sb.snapshot(), b"bcde");
    }

    #[test]
    fn scrollback_handles_chunk_larger_than_capacity() {
        let mut sb = ScrollbackBuffer::new(3);
        sb.push(b"abcdef"); // 6 bytes into cap 3 → keep trailing "def"
        assert_eq!(sb.snapshot(), b"def");
    }

    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    #[derive(Default)]
    struct VecSink(Mutex<Vec<u8>>);

    impl OutputSink for VecSink {
        fn send(&self, data: Vec<u8>) {
            self.0.lock().unwrap().extend(data);
        }
    }

    impl VecSink {
        fn contains(&self, needle: &[u8]) -> bool {
            let g = self.0.lock().unwrap();
            g.windows(needle.len()).any(|w| w == needle)
        }
    }

    /// Poll a sink for up to ~3s waiting for `needle` to appear.
    fn wait_for(sink: &VecSink, needle: &[u8]) -> bool {
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            if sink.contains(needle) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        false
    }

    fn opts() -> OpenOpts {
        OpenOpts {
            shell: "/bin/sh".to_string(),
            cwd: None,
            cols: 80,
            rows: 24,
        }
    }

    #[test]
    fn open_write_then_reconnect_replays_scrollback() {
        let reg = PtyRegistry::default();

        // New session: spawn, write a command, observe its output on sink1.
        let sink1 = Arc::new(VecSink::default());
        reg.open("t1", opts(), sink1.clone()).unwrap();
        reg.write("t1", b"printf GREEDGRID_OK\n").unwrap();
        assert!(
            wait_for(&sink1, b"GREEDGRID_OK"),
            "expected command output on the live sink"
        );

        // Reconnect the same instanceId with a fresh sink: scrollback replays.
        let sink2 = Arc::new(VecSink::default());
        reg.open("t1", opts(), sink2.clone()).unwrap();
        assert!(
            sink2.contains(b"GREEDGRID_OK"),
            "reconnect must replay prior scrollback into the new sink"
        );

        // Resize is accepted while live.
        reg.resize("t1", 100, 30).unwrap();

        // Close removes the session; a subsequent write errors.
        reg.close("t1").unwrap();
        assert!(reg.write("t1", b"x").is_err(), "write after close must fail");
    }

    #[test]
    fn write_to_unknown_session_errors() {
        let reg = PtyRegistry::default();
        assert!(reg.write("nope", b"x").is_err());
    }

    #[test]
    fn detach_then_reattach_replays_scrollback() {
        let reg = PtyRegistry::default();

        let sink1 = Arc::new(VecSink::default());
        reg.open("t1", opts(), sink1.clone()).unwrap();
        reg.write("t1", b"printf GREEDGRID_OK\n").unwrap();
        assert!(
            wait_for(&sink1, b"GREEDGRID_OK"),
            "expected command output on the live sink"
        );

        // Detach clears the sink but keeps the session alive.
        reg.detach("t1").unwrap();
        let listed = reg.list();
        let entry = listed
            .iter()
            .find(|s| s.instance_id == "t1")
            .expect("detached session must still be listed");
        assert!(!entry.attached, "detached session must report attached=false");
        assert!(entry.alive, "detached session must still be alive");

        // Reattach with a fresh sink: scrollback replays.
        let sink2 = Arc::new(VecSink::default());
        reg.open("t1", opts(), sink2.clone()).unwrap();
        assert!(
            sink2.contains(b"GREEDGRID_OK"),
            "reattach must replay prior scrollback into the new sink"
        );
    }

    #[test]
    fn detach_keeps_child_alive() {
        let reg = PtyRegistry::default();

        let sink = Arc::new(VecSink::default());
        reg.open("t2", opts(), sink.clone()).unwrap();
        reg.write("t2", b"printf GREEDGRID_MARK\n").unwrap();
        assert!(wait_for(&sink, b"GREEDGRID_MARK"), "expected marker output");

        reg.detach("t2").unwrap();
        // The session survived detach: a write still reaches the live child.
        assert!(
            reg.write("t2", b"x").is_ok(),
            "write after detach must succeed (session still alive)"
        );
    }

    #[test]
    fn spawn_sets_term_for_colour_support() {
        // Reproduce the GUI-launch condition: when greedgrid is started from a
        // desktop icon the parent process has no TERM/COLORTERM, so plain
        // inheritance yields an empty $TERM. Clear them here so the test only
        // passes if the engine sets them explicitly on the child. (CommandBuilder
        // snapshots the parent env at spawn, so clearing before `open` is what the
        // child sees absent an explicit override.)
        std::env::remove_var("TERM");
        std::env::remove_var("COLORTERM");

        let reg = PtyRegistry::default();

        let sink = Arc::new(VecSink::default());
        reg.open("t_term", opts(), sink.clone()).unwrap();
        // Wrap the values in markers so we match the echoed value, not the command
        // we just typed (which the pty echoes back verbatim).
        reg.write(
            "t_term",
            b"printf 'TERMVAL[%s]COLORVAL[%s]' \"$TERM\" \"$COLORTERM\"\n",
        )
        .unwrap();
        assert!(
            wait_for(&sink, b"TERMVAL[xterm-256color]"),
            "spawned shell must get TERM=xterm-256color so colour-aware tools enable colour"
        );
        assert!(
            wait_for(&sink, b"COLORVAL[truecolor]"),
            "spawned shell must get COLORTERM=truecolor for 24-bit colour"
        );
    }

    #[test]
    fn list_reports_exited_session() {
        let reg = PtyRegistry::default();

        let sink = Arc::new(VecSink::default());
        reg.open("t3", opts(), sink.clone()).unwrap();
        reg.write("t3", b"exit\n").unwrap();

        // Poll until the session reports as exited; it stays in the map until close.
        let deadline = Instant::now() + Duration::from_secs(3);
        let mut exited = false;
        while Instant::now() < deadline {
            if let Some(entry) = reg.list().iter().find(|s| s.instance_id == "t3") {
                if !entry.alive {
                    exited = true;
                    break;
                }
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(
            exited,
            "list must eventually report the exited session with alive == false"
        );
    }
}
