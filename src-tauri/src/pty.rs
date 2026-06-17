//! PTY engine: a registry of live pseudo-terminals keyed by panel instanceId.
//! Kept free of Tauri types so the lifecycle is unit-testable with `cargo test`.

use std::collections::VecDeque;

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
        self.buf.extend(data.iter().copied());
        while self.buf.len() > self.cap {
            self.buf.pop_front();
        }
    }

    pub fn snapshot(&self) -> Vec<u8> {
        self.buf.iter().copied().collect()
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
}
