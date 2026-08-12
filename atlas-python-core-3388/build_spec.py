from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parent
SPEC = ROOT / "AtlasPythonCore3388.spec"


def main() -> None:
    if not SPEC.exists():
        raise SystemExit(f"Missing PyInstaller spec: {SPEC}")
    print(f"OK: PyInstaller spec ready: {SPEC}")
    print("Build command:")
    print(r"  .\.venv\Scripts\python.exe -m PyInstaller --clean --noconfirm AtlasPythonCore3388.spec")


if __name__ == "__main__":
    main()

