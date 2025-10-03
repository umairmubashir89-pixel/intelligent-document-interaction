@echo off
setlocal
if not exist ".venv" (
  echo [SETUP] Creating virtualenv...
  python -m venv .venv
)
call ".venv\Scripts\activate.bat"

echo [STEP] Ensuring PyInstaller...
python -m pip install --upgrade pip setuptools wheel
python -m pip install pyinstaller

echo [STEP] Cleaning old builds...
if exist "build" rmdir /s /q build
if exist "dist"  rmdir /s /q dist

echo [STEP] Building InstallDeps.exe...
pyinstaller --noconfirm --onefile --clean ^
  --name InstallDeps ^
  install_deps.py

echo [STEP] Building RunArgon.exe...
pyinstaller --noconfirm --onefile --clean ^
  --name RunArgon ^
  run.py

echo.
echo [DONE] Built EXEs in .\dist\
dir dist
endlocal
