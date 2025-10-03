#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Argon installer (Windows-first, idempotent, no-Whisper)

What this does:
- Ensures Node + Python environments are usable.
- For each app (server, web):
  * Ensures minimal package.json/scripts/tsconfig/shims.
  * Installs ONLY missing npm dependencies (skips ones already installed).
- Installs ONLY missing Python deps (skips if already satisfied).
- Optionally builds both apps unless --no-build is passed.
- Supports --rebuild to nuke node_modules/dist and rebuild fresh.

Usage:
  python install_deps.py                # install missing deps + build
  python install_deps.py --no-build     # install missing deps only
  python install_deps.py --rebuild      # remove node_modules/dist and rebuild
"""

import os
import sys
import json
import shutil
import subprocess
from pathlib import Path

ROOT   = Path(__file__).parent.resolve()
SERVER = ROOT / "apps" / "server"
WEB    = ROOT / "apps" / "web"

# --------------------- What we install (unpinned) ---------------------
# Server runtime (fastify + plugins + PDF/DOCX + static ffmpeg for media)
SERVER_RUNTIME = [
    "fastify",
    "@fastify/cors",
    "@fastify/multipart",
    "@fastify/static",
    "pdf-parse",
    "mammoth",
    "pdfjs-dist",
    "ffmpeg-static",
]
SERVER_DEV = ["typescript", "@types/node"]

# Web runtime used in UI (markdown rendering)
WEB_RUNTIME = ["react-markdown", "remark-gfm"]

# Web build/dev (ensure a clean Vite React build exists on bare machines)
WEB_DEV = [
    "vite",
    "@vitejs/plugin-react",
    "react",
    "react-dom",
    "typescript",
]

# Python runtime:
# NOTE: Whisper libraries removed (e.g., faster-whisper, ctranslate2).
# Keep pyinstaller optional if you plan native launchers; safe to skip if not needed.
PY_RUNTIME = ["pyinstaller"]

# ---------------------------------------------------------------------

def run(cmd, cwd=None, allow_fail=False, env=None):
    print(f"\n[RUN] {' '.join(cmd)} (cwd={cwd or os.getcwd()})")
    r = subprocess.run(cmd, cwd=cwd, shell=False, env=env)
    if r.returncode != 0 and not allow_fail:
        print(f"[ERR] exit {r.returncode}")
        sys.exit(r.returncode)
    return r.returncode

def npm_bin():
    p = shutil.which("npm.cmd") or shutil.which("npm")
    if not p:
        sys.exit("[ERR] npm not found on PATH. Install Node.js first: https://nodejs.org/")
    return p

def node_bin():
    p = shutil.which("node") or "node"
    try:
        subprocess.check_call([p, "-v"])
    except Exception:
        sys.exit("[ERR] Node.js not found on PATH. Install from https://nodejs.org/")
    return p

def rm_lockfiles(folder: Path):
    for name in ("package-lock.json", "pnpm-lock.yaml", "yarn.lock"):
        f = folder / name
        if f.exists():
            try:
                f.unlink()
                print(f"[OK] removed {f}")
            except Exception as e:
                print(f"[WARN] could not remove {f}: {e}")

def ensure_pkg_json(folder: Path, name: str):
    pkg = folder / "package.json"
    data = {}
    if pkg.exists():
        try:
            data = json.loads(pkg.read_text(encoding="utf-8"))
        except Exception:
            data = {}
    data.setdefault("name", name)
    data.setdefault("version", "0.1.0")
    data.setdefault("type", "module")  # ESM
    scripts = data.setdefault("scripts", {})
    if folder == SERVER:
        scripts.setdefault("build", "tsc -p tsconfig.json")
        scripts.setdefault("start", "node dist/index.js")
    if folder == WEB:
        # Prefer Vite; fallback to react-scripts if present in repo
        scripts.setdefault("build", "vite build || react-scripts build")
    pkg.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"[OK] ensured {pkg}")

def write_ts_shims(folder: Path):
    """Type shims for CommonJS/legacy modules so TS doesn't block builds."""
    types_dir = folder / "src" / "types"
    types_dir.mkdir(parents=True, exist_ok=True)
    (types_dir / "external.d.ts").write_text(
        "// auto-generated shims\n"
        "declare module 'mammoth' { const x: any; export = x; }\n"
        "declare module 'pdf-parse' { const x: any; export = x; }\n"
        "declare module 'ffmpeg-static' { const path: string; export default path; }\n"
        "declare module 'pdfjs-dist/legacy/build/pdf.js' { const pdfjs: any; export = pdfjs; }\n",
        encoding="utf-8"
    )
    print(f"[OK] wrote TS shims to {types_dir}")

def ensure_tsconfig_server():
    ts = SERVER / "tsconfig.json"
    data = {
        "compilerOptions": {
            "target": "ES2020",
            "module": "ES2022",
            "moduleResolution": "Bundler",
            "rootDir": "src",
            "outDir": "dist",
            "types": ["node"],
            "esModuleInterop": True,
            "allowSyntheticDefaultImports": True,
            "resolveJsonModule": True,
            "skipLibCheck": True,
            "strict": False
        },
        "include": ["src/**/*.ts", "src/types/**/*.d.ts"],
        "exclude": ["dist", "node_modules"]
    }
    ts.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(f"[OK] ensured tsconfig at {ts}")

def clean(folder: Path):
    for d in ("node_modules", "dist"):
        p = folder / d
        if p.exists():
            shutil.rmtree(p, ignore_errors=True)
            print(f"[OK] removed {p}")

def npm_has_pkg(npm: str, folder: Path, pkg: str) -> bool:
    # `npm ls <pkg> --depth=0` returns 0 if installed locally
    r = subprocess.run([npm, "ls", pkg, "--depth=0"], cwd=folder, shell=False,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return r.returncode == 0

def npm_install_if_missing(npm: str, folder: Path, pkgs: list[str], dev: bool = False):
    flag = ["-D"] if dev else []
    missing = [p for p in pkgs if not npm_has_pkg(npm, folder, p)]
    if not missing:
        print(f"[OK] all {'dev ' if dev else ''}packages already present in {folder}")
        return
    print(f"[STEP] Installing missing {'dev ' if dev else ''}packages in {folder}: {', '.join(missing)}")
    run([npm, "install", "--no-package-lock", *flag, *missing], cwd=folder)

def ensure_local_install(npm: str, folder: Path):
    """If node_modules is missing, do a plain npm install to satisfy repo deps."""
    if not (folder / "node_modules").exists():
        print(f"[STEP] node_modules missing in {folder}, running npm install to sync repo deps")
        run([npm, "install", "--no-package-lock"], cwd=folder)
    else:
        print(f"[OK] node_modules present in {folder}; skipping bulk install")

def pip_show(pkg: str) -> bool:
    r = subprocess.run([sys.executable, "-m", "pip", "show", pkg],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return r.returncode == 0

def pip_install_if_missing(pkgs: list[str]):
    missing = [p for p in pkgs if not pip_show(p)]
    if not missing:
        print("[OK] all Python packages already satisfied")
        return
    run([sys.executable, "-m", "pip", "install", *missing])

def main():
    # ------------- args -------------
    want_build = True
    do_rebuild = False
    if "--no-build" in sys.argv: want_build = False
    if "--rebuild" in sys.argv:  do_rebuild = True

    # ------------- env / tools -------------
    node_bin()
    npm = npm_bin()

    # ------------- optional cleanup -------------
    if do_rebuild:
        print("[STEP] Rebuilding from scratch…")
        clean(SERVER); clean(WEB)

    print("[STEP] Installing Node + Python deps (idempotent)…")
    run([sys.executable, "-V"])
    run([npm, "-v"])

    # ---- Server ----
    ensure_pkg_json(SERVER, "@argon/server")
    rm_lockfiles(SERVER)
    npm_install_if_missing(npm, SERVER, SERVER_RUNTIME, dev=False)
    npm_install_if_missing(npm, SERVER, SERVER_DEV, dev=True)
    ensure_local_install(npm, SERVER)
    write_ts_shims(SERVER)
    ensure_tsconfig_server()

    # ---- Web ----
    ensure_pkg_json(WEB, "@argon/web")
    rm_lockfiles(WEB)
    npm_install_if_missing(npm, WEB, WEB_RUNTIME, dev=False)
    npm_install_if_missing(npm, WEB, WEB_DEV, dev=True)
    ensure_local_install(npm, WEB)
    write_ts_shims(WEB)   # harmless; future-proof

    # ---- Python ----
    # Minimal bootstrap upgrades (safe, quick), then idempotent install for runtime.
    run([sys.executable, "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"])
    pip_install_if_missing(PY_RUNTIME)

    # ------------- Build (one-time) -------------
    if want_build:
        print("\n[STEP] Building server + web…")
        run([npm, "run", "build"], cwd=SERVER)
        run([npm, "run", "build"], cwd=WEB)
        print("\n[OK] Build complete.")
    else:
        print("\n[STEP] Skipping build (per --no-build)")

    print("\n[DONE] Installs finished (idempotent).")
    print("Next: run -> python run.py")

if __name__ == "__main__":
    main()
