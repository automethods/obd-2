"""High-level deterministic JSON-lines plant bridge, not a binary ECU emulator.

One JSON command per line on stdin, one response per line on stdout.
Commands: reset, step, observe, diagnostic, quit. Time advances only on step.
"""
import json
import sys

from .core import Sim
from .runner import diagnostic_server


def main():
    sim = Sim(profile="phev", scenario="manual")
    diag = diagnostic_server(sim)
    for line in sys.stdin:
        try:
            command = json.loads(line)
            op = command.get("op", "observe")
            if op == "quit":
                print(json.dumps({"ok": True, "stopped": True}), flush=True)
                break
            if op == "reset":
                sim = Sim(profile=command.get("profile", "phev"), scenario="manual", config=command.get("config", {}))
                diag = diagnostic_server(sim)
            elif op == "step":
                seconds = float(command.get("dt_s", .02))
                if not 0 < seconds <= 1:
                    raise ValueError("dt_s must be in (0, 1].")
                sim.advance(seconds, command.get("inputs", {}))
            elif op == "diagnostic":
                result = diag.request(command.get("payload", "01 0C"), int(str(command.get("can_id", "7DF")), 16))
                print(json.dumps({"ok": True, "diagnostic": result}, allow_nan=False), flush=True)
                continue
            elif op != "observe":
                raise ValueError("Unknown operation.")
            print(json.dumps({"ok": True, "schema": "obdii-lab.state.v1", "state": sim.snapshot()}, allow_nan=False), flush=True)
        except (ValueError, TypeError, KeyError, AttributeError) as exc:
            print(json.dumps({"ok": False, "error": str(exc)}), flush=True)


if __name__ == "__main__":
    main()
