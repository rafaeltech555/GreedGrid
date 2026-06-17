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
}

/// Registry of live PTYs keyed by panel `instanceId`. Lives in Tauri app state.
#[derive(Default)]
pub struct PtyRegistry(pub Mutex<HashMap<String, PtySession>>);

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
                            let chunk = buf[..n].to_vec();
                            scrollback.lock().unwrap().push(&chunk);
                            // Clone the attached sink out and release the lock before
                            // sending: keeps the (potentially slow) IPC send off the
                            // lock, and a panicking sink can't poison the mutex.
                            let attached = sink_slot.lock().unwrap().clone();
                            if let Some(sink) = attached {
                                sink.send(chunk);
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
        }
        Ok(())
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
}
