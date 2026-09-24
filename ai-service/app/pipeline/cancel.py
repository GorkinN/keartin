from __future__ import annotations

import threading


class CancelRegistry:
    """One threading.Event per pipeline job. The Flux worker thread can see it."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._flags: dict[str, threading.Event] = {}

    def open(self, job_id: str) -> threading.Event:
        with self._lock:
            flag = self._flags.get(job_id)
            if flag is None:
                flag = threading.Event()
                self._flags[job_id] = flag
            return flag

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            flag = self._flags.get(job_id)
            if flag is None:
                return False
            flag.set()
            return True

    def close(self, job_id: str) -> None:
        with self._lock:
            self._flags.pop(job_id, None)
