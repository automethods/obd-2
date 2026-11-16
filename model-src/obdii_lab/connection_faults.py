"""Deterministic contact dropouts on the simulator's integer time grid.

The contact schedule changes topology only. Sensor sampling, missing-signal
debounce, controller effects and retained fault memory belong to their existing
models. There is no wall-clock timer or random state shared between connectors.
"""
from __future__ import annotations

import hashlib
import math


MIN_PHASE_SECONDS = 0.002
MAX_PHASE_SECONDS = 3600.0


def validate_connection_fault_settings(mode, pattern, connected_s, dropout_s):
    """Validate the complete request without changing any live state."""
    if not isinstance(mode, str) or mode not in ("normal", "open", "intermittent"):
        raise ValueError("Fault mode must be normal, open or intermittent")
    if not isinstance(pattern, str) or pattern not in ("regular", "irregular"):
        raise ValueError("Fault pattern must be regular or irregular")
    durations = []
    for name, value in (("connected_s", connected_s), ("dropout_s", dropout_s)):
        if (isinstance(value, bool) or not isinstance(value, (int, float)) or
                not math.isfinite(value) or not MIN_PHASE_SECONDS <= value <= MAX_PHASE_SECONDS):
            raise ValueError(f"{name} must be a finite number in [{MIN_PHASE_SECONDS}, {MAX_PHASE_SECONDS}] seconds")
        durations.append(float(value))
    return mode, pattern, *durations


class ConnectionFaultSchedule:
    """A contact starts connected, then alternates connected/dropout phases.

    Regular phase durations round upward to a complete plant tick. Irregular
    phases select an integer tick duration within ±25% of that base duration,
    clipped to the same [2 ms, 3600 s] bounds. The small explicit integer PRNG
    makes a connector's sequence reproducible across process runs and avoids
    interference from the order in which other faults are configured.
    """
    def __init__(self, connection_id, pattern, connected_s, dropout_s, *, started_tick, tick_seconds):
        self.connection_id = connection_id
        self.pattern = pattern
        self.connected_s = connected_s
        self.dropout_s = dropout_s
        self.started_tick = started_tick
        self.tick_seconds = tick_seconds
        self.seed = int.from_bytes(hashlib.sha256(("obdii-lab.contact.v1:" + connection_id).encode("utf-8")).digest()[:4], "big")
        self._random_state = self.seed
        self._base_ticks = {"connected": self._to_ticks(connected_s), "dropout": self._to_ticks(dropout_s)}
        self.phase = "connected"
        self.transition_count = 0
        self.dropout_count = 0
        self.next_change_tick = started_tick + self._duration_ticks(self.phase)

    def _to_ticks(self, seconds):
        return max(1, int(math.ceil(seconds / self.tick_seconds - 1e-9)))

    def _duration_ticks(self, phase):
        base = self._base_ticks[phase]
        if self.pattern == "regular":
            return base
        minimum = max(1, int(math.ceil(base * .75)))
        maximum = min(self._to_ticks(MAX_PHASE_SECONDS), max(minimum, int(math.floor(base * 1.25))))
        self._random_state = (1664525 * self._random_state + 1013904223) & 0xffffffff
        return minimum + self._random_state % (maximum - minimum + 1)

    def advance_to(self, tick):
        """Return contact transitions due at this tick, at most once each."""
        changes = []
        while tick >= self.next_change_tick:
            transition_tick = self.next_change_tick
            self.phase = "dropout" if self.phase == "connected" else "connected"
            self.transition_count += 1
            if self.phase == "dropout":
                self.dropout_count += 1
            changes.append((transition_tick, self.phase == "connected"))
            self.next_change_tick += self._duration_ticks(self.phase)
        return changes

    def snapshot(self, tick, effective_connected):
        return {
            "mode": "intermittent", "pattern": self.pattern,
            "connected_s": self.connected_s, "dropout_s": self.dropout_s,
            "phase": self.phase, "effective_connected": bool(effective_connected),
            "next_change_s": round(self.next_change_tick * self.tick_seconds, 9),
            "time_to_change_s": round(max(0, self.next_change_tick - tick) * self.tick_seconds, 9),
            "transition_count": self.transition_count, "dropout_count": self.dropout_count,
            "seed": self.seed, "started_at_s": round(self.started_tick * self.tick_seconds, 9),
        }
