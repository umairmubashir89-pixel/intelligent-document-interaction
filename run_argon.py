#!/usr/bin/env python
# -*- coding: utf-8 -*-

import os, sys, subprocess, webbrowser, shutil
from pathlib import Path

ROOT   = Path(__file__).parent.resolve()
SERVER = ROOT / "apps" / "server"
WEB    = ROOT / "apps" / "web"

DEFAULT_PORT = os.environ.get("PORT", "8787")
DEFAULT_OLLAMA = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")

def npm_path():
    return shutil.which("npm.cmd") or shutil.which("npm") or "npm"

def sh(cmd, cwd=None, allow_fail=False, env=None):
    print(f"\n[RUN] {' '.join(cmd)} (cwd={cwd or os.getcwd()})")
    p = subprocess.run(cmd, cwd=cwd, shell=False, env=env)
    if p.returncode != 0 and not allow_fail:
        sys.exit(p.returncode)
    return p.returncode

def ensure_node():
    node = shutil.which("node") or "node"
    npm  = npm_path()
    sh([node, "-v"])
    sh([npm, "-v"])
    return node, npm

def npm_install_no_lock(npm_cmd: str, folder: Path):
    sh([npm_cmd, "install", "--no-package-lock"], cwd=str(folder))

def build_all(npm_cmd: str):
    sh([npm_cmd, "run", "build"], cwd=str(SERVER))
    sh([npm_cmd, "run", "build"], cwd=str(WEB))

def start_server():
    env = os.environ.copy()
    env.setdefault("PORT", DEFAULT_PORT)
    env.setdefault("OLLAMA_URL", DEFAULT_OLLAMA)
    dist_index = SERVER / "dist" / "index.js"
    if not dist_index.exists():
        print(f"[ERR] Server build not found at {dist_index}")
        sys.exit(1)
    url = f"http://localhost:{env['PORT']}"
    try:
        webbrowser.open(url)
    except Exception:
        pass
    sh(["node", str(dist_index)], cwd=str(SERVER), env=env)

def parse_args(argv):
    opts = {"skip_install": False, "no_build": False}
    it = iter(argv[1:])
    for a in it:
        if a == "--skip-install": opts["skip_install"] = True
        elif a == "--no-build":   opts["no_build"] = True
    return opts

def main():
    print("[INFO] Argon runner (unpinned)")
    ensure_node()
    npm_cmd = npm_path()

    opts = parse_args(sys.argv)
    if not opts["skip_install"]:
        print("\n[STEP] Installing Node deps (no lockfiles)…")
        npm_install_no_lock(npm_cmd, SERVER)
        npm_install_no_lock(npm_cmd, WEB)
    else:
        print("\n[STEP] Skipping install (per --skip-install)")

    if not opts["no_build"]:
        print("\n[STEP] Building…")
        build_all(npm_cmd)
    else:
        print("\n[STEP] Skipping build (per --no-build)")

    start_server()

if __name__ == "__main__":
    main()
