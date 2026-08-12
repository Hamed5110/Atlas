from __future__ import annotations

import logging
import servicemanager
import signal
import sys
import threading
from pathlib import Path

import win32event
import win32service
import win32serviceutil


SERVICE_NAME = "AtlasPythonCore3388"
SERVICE_DISPLAY_NAME = "ATLAS Python Core Service (Port 3388)"
SERVICE_DESCRIPTION = "Greenfield ATLAS Python + MSSQL FastAPI service isolated on port 3388."


class AtlasPythonCore3388Service(win32serviceutil.ServiceFramework):
    _svc_name_ = SERVICE_NAME
    _svc_display_name_ = SERVICE_DISPLAY_NAME
    _svc_description_ = SERVICE_DESCRIPTION

    def __init__(self, args: list[str]) -> None:
        super().__init__(args)
        self.stop_event = win32event.CreateEvent(None, 0, 0, None)
        self.server_thread: threading.Thread | None = None

    def SvcStop(self) -> None:
        self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
        win32event.SetEvent(self.stop_event)
        self._request_shutdown()

    def SvcShutdown(self) -> None:
        win32event.SetEvent(self.stop_event)
        self._request_shutdown()

    def SvcDoRun(self) -> None:
        log_dir = Path(__file__).resolve().parents[1] / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        logging.basicConfig(
            filename=str(log_dir / "windows_service.log"),
            level=logging.INFO,
            format="%(asctime)s %(levelname)s %(name)s %(message)s",
        )
        servicemanager.LogInfoMsg(f"{SERVICE_DISPLAY_NAME} starting.")
        logging.info("service.start")

        self.server_thread = threading.Thread(target=self._run_server, name="atlas-uvicorn-3388", daemon=True)
        self.server_thread.start()
        win32event.WaitForSingleObject(self.stop_event, win32event.INFINITE)
        logging.info("service.stop")
        servicemanager.LogInfoMsg(f"{SERVICE_DISPLAY_NAME} stopped.")

    def _run_server(self) -> None:
        try:
            from app.server import run

            run()
        except BaseException:
            logging.exception("service.server.crashed")
            servicemanager.LogErrorMsg(f"{SERVICE_DISPLAY_NAME} crashed. See logs/windows_service.log.")
            win32event.SetEvent(self.stop_event)

    def _request_shutdown(self) -> None:
        try:
            signal.raise_signal(signal.SIGTERM)
        except BaseException:
            logging.exception("service.shutdown.signal_failed")


def main() -> None:
    if len(sys.argv) == 1:
        servicemanager.Initialize()
        servicemanager.PrepareToHostSingle(AtlasPythonCore3388Service)
        servicemanager.StartServiceCtrlDispatcher()
    else:
        win32serviceutil.HandleCommandLine(AtlasPythonCore3388Service)


if __name__ == "__main__":
    main()

