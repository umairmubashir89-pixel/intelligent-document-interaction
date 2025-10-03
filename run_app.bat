@echo off
setlocal
if exist ".venv\Scripts\activate.bat" (
  call ".venv\Scripts\activate.bat"
)
REM run.py builds if needed (or use --no-build if you want only to start)
python run.py %*
endlocal
