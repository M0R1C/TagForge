import threading
from abc import ABC, abstractmethod
from typing import Optional, Dict, Any


class BaseManager(ABC):

    def __init__(self):
        self._running = False
        self._lock = threading.Lock()
        self._progress: Dict[str, Any] = {}

    @property
    def is_running(self) -> bool:
        with self._lock:
            return self._running

    def _set_running(self, value: bool) -> None:
        with self._lock:
            self._running = value

    def _update_progress(self, **kwargs) -> None:
        with self._lock:
            self._progress.update(kwargs)

    def get_status(self) -> Dict[str, Any]:
        with self._lock:
            status = {'running': self._running}
            status.update(self._progress)
            return status

    @abstractmethod
    def start(self, *args, **kwargs):
        pass

    def stop(self) -> None:
        self._set_running(False)