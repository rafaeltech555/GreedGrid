//! System-metrics sampler. A single background thread owns one `sysinfo::System`,
//! refreshes it on a fixed cadence, and publishes the latest snapshot behind a
//! mutex. The frontend polls a cheap command that just reads this snapshot, so
//! CPU% deltas stay consistent regardless of poll timing and the cost is O(1)
//! no matter how many sysmon panels are open. Free of Tauri types so it is
//! unit-testable with `cargo test`.

use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use sysinfo::{System, MINIMUM_CPU_UPDATE_INTERVAL};

/// How often the background thread refreshes — the window CPU% is measured over.
const SAMPLE_INTERVAL: Duration = Duration::from_secs(1);

/// One point-in-time reading of host vitals. `camelCase` so it lands on the JS
/// side matching the TS `SysSnapshot` interface with no manual key mapping.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SysSnapshot {
    pub cpu: f32,        // global CPU usage 0.0–100.0
    pub mem_used: u64,   // bytes
    pub mem_total: u64,  // bytes
    pub swap_used: u64,  // bytes
    pub swap_total: u64, // bytes
    pub load: [f64; 3],  // 1 / 5 / 15 min
    pub uptime_secs: u64,
}

fn capture(sys: &System) -> SysSnapshot {
    let la = System::load_average();
    SysSnapshot {
        cpu: sys.global_cpu_usage(),
        mem_used: sys.used_memory(),
        mem_total: sys.total_memory(),
        swap_used: sys.used_swap(),
        swap_total: sys.total_swap(),
        load: [la.one, la.five, la.fifteen],
        uptime_secs: System::uptime(),
    }
}

/// Shared latest snapshot. Lives in Tauri app state via `.manage(...)`.
pub struct Sampler(pub Arc<Mutex<SysSnapshot>>);

impl Sampler {
    /// Seed an initial snapshot (with a primed CPU delta) and spawn the refresh
    /// thread. The thread runs for the app's lifetime.
    pub fn start() -> Self {
        let mut sys = System::new();
        // CPU% needs two refreshes spaced >= MINIMUM_CPU_UPDATE_INTERVAL.
        sys.refresh_cpu_usage();
        sys.refresh_memory();
        thread::sleep(MINIMUM_CPU_UPDATE_INTERVAL);
        sys.refresh_cpu_usage();

        let shared = Arc::new(Mutex::new(capture(&sys)));
        let writer = shared.clone();
        thread::spawn(move || loop {
            sys.refresh_cpu_usage();
            sys.refresh_memory();
            let snap = capture(&sys);
            *writer.lock().unwrap() = snap;
            thread::sleep(SAMPLE_INTERVAL);
        });
        Sampler(shared)
    }

    /// Clone the latest snapshot (cheap mutex read).
    pub fn snapshot(&self) -> SysSnapshot {
        self.0.lock().unwrap().clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sampler_produces_plausible_snapshot() {
        let sampler = Sampler::start();
        let s = sampler.snapshot();
        assert!(s.mem_total > 0, "mem_total should be positive");
        assert!(s.mem_used <= s.mem_total, "used <= total");
        assert!(
            s.cpu >= 0.0 && s.cpu <= 100.0,
            "cpu in 0..100, got {}",
            s.cpu
        );
        assert!(s.uptime_secs > 0, "uptime should be positive");
        for v in s.load {
            assert!(v.is_finite(), "load values finite");
        }
    }
}
