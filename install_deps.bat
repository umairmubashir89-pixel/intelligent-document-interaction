@echo off
setlocal
REM Create a local venv (optional but recommended)
if not exist ".venv" (
  echo [SETUP] Creating virtualenv...
  python -m venv .venv
)
call ".venv\Scripts\activate.bat"

echo [STEP] Upgrading pip/setuptools/wheel...
python -m pip install --upgrade pip setuptools wheel

echo [STEP] Running installer...
python install_deps.py %*

echo [DONE] Installer finished.
endlocal
