#!/usr/bin/env python
# -*- coding: utf-8 -*-

import os, sys, subprocess, webbrowser, shutil
from pathlib import Path
import importlib.util
import platform

ROOT   = Path(__file__).parent.resolve()
SERVER = ROOT / "apps" / "server"
WEB    = ROOT / "apps" / "web"
DATA_DIR = ROOT / "data" / "rag"

DEFAULT_PORT   = os.environ.get("PORT", "8787")
DEFAULT_OLLAMA = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")

# Enhanced RAG Python dependencies
REQUIRED_PYTHON_PACKAGES = [
    "fitz",  # pymupdf
    "pymupdf4llm", 
    "pdfminer",
    "pdfplumber",
    "camelot", 
    "tabula",
    "docx",  # python-docx
    "pytesseract",
    "PIL"  # Pillow
]

def is_windows():
    return platform.system().lower() == "windows"

def npm_path():
    if is_windows():
        return shutil.which("npm.cmd") or shutil.which("npm.exe") or shutil.which("npm") or "npm"
    return shutil.which("npm") or "npm"

def python_path():
    """Find the best Python executable - Windows compatible"""
    if is_windows():
        candidates = ["python.exe", "python3.exe", "py.exe", "python", "python3", "py"]
    else:
        candidates = ["python3", "python", "py"]
    
    for cmd in candidates:
        path = shutil.which(cmd)
        if path:
            return path
    return "python"  # fallback

def sh(cmd, cwd=None, allow_fail=False, env=None, capture_output=False):
    cmd_str = ' '.join(cmd) if isinstance(cmd, list) else cmd
    print(f"\n[RUN] {cmd_str} (cwd={cwd or os.getcwd()})")
    
    try:
        p = subprocess.run(cmd, cwd=cwd, shell=False, env=env, 
                          capture_output=capture_output, text=True)
        if p.returncode != 0 and not allow_fail:
            if capture_output:
                print(f"[ERR] Command failed: {p.stderr}")
            sys.exit(p.returncode)
        return p
    except KeyboardInterrupt:
        print("\n[INFO] Interrupted by user")
        sys.exit(0)
    except Exception as e:
        print(f"[ERR] Command execution failed: {e}")
        if not allow_fail:
            sys.exit(1)
        return None

def ensure_node():
    node = shutil.which("node") or "node"
    npm  = npm_path()
    sh([node, "-v"])
    sh([npm, "-v"])
    return node, npm

def check_python_package(package_name, python_cmd=None):
    """Check if a Python package is available using subprocess for Windows compatibility"""
    if not python_cmd:
        python_cmd = python_path()
    
    try:
        # Use subprocess to check package availability - more reliable on Windows
        result = subprocess.run([
            python_cmd, "-c", f"import {package_name}; print('OK')"
        ], capture_output=True, text=True, timeout=10)
        
        return result.returncode == 0 and "OK" in result.stdout
    except (subprocess.TimeoutExpired, FileNotFoundError, Exception):
        return False

def check_system_command(cmd):
    """Check if a system command is available"""
    return shutil.which(cmd) is not None

def test_python_imports(python_cmd):
    """Test Python package imports with detailed output"""
    test_script = '''
import sys
packages_to_test = {
    "fitz": "pymupdf", 
    "pymupdf4llm": "pymupdf4llm",
    "pdfminer": "pdfminer.six",
    "pdfplumber": "pdfplumber", 
    "camelot": "camelot-py",
    "tabula": "tabula-py",
    "docx": "python-docx",
    "pytesseract": "pytesseract",
    "PIL": "Pillow"
}

results = {}
for import_name, package_name in packages_to_test.items():
    try:
        __import__(import_name)
        results[package_name] = True
        print(f"✓ {package_name}")
    except ImportError as e:
        results[package_name] = False
        print(f"✗ {package_name} - {str(e)}")
    except Exception as e:
        results[package_name] = False
        print(f"? {package_name} - {str(e)}")

available = sum(results.values())
total = len(results)
print(f"\\nSUMMARY: {available}/{total} packages available")
'''
    
    try:
        result = subprocess.run([python_cmd, "-c", test_script], 
                              capture_output=True, text=True, timeout=30)
        print(f"[PYTHON TEST] Output:\n{result.stdout}")
        if result.stderr:
            print(f"[PYTHON TEST] Errors:\n{result.stderr}")
        
        # Count available packages from output
        available = result.stdout.count("✓")
        return available >= len(REQUIRED_PYTHON_PACKAGES) // 2
        
    except Exception as e:
        print(f"[PYTHON TEST] Failed: {e}")
        return False

def check_python_environment():
    """Check Python environment and dependencies - Windows compatible"""
    python_cmd = python_path()
    print(f"\n[CHECK] Using Python: {python_cmd}")
    
    # Check Python version
    try:
        result = subprocess.run([python_cmd, "--version"], 
                               capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            print(f"[INFO] Python version: {result.stdout.strip()}")
        else:
            print(f"[WARN] Could not determine Python version: {result.stderr}")
            return False
    except Exception as e:
        print(f"[WARN] Python check failed: {e}")
        return False
    
    print(f"\n[CHECK] Testing package imports...")
    return test_python_imports(python_cmd)

def setup_enhanced_rag_environment():
    """Setup environment variables for enhanced RAG"""
    python_cmd = python_path()
    
    # Test core packages for table extraction
    has_table_packages = (
        check_python_package("camelot", python_cmd) or 
        check_python_package("tabula", python_cmd) or 
        check_python_package("pdfplumber", python_cmd)
    )
    
    # Test OCR packages
    has_ocr_packages = (
        check_python_package("pytesseract", python_cmd) and 
        check_python_package("PIL", python_cmd)
    )
    
    # Check system dependencies
    has_tesseract = check_system_command("tesseract")
    has_libreoffice = check_system_command("libreoffice") or check_system_command("soffice")
    
    # Set environment variables
    env = os.environ.copy()
    env["PYTHON_PATH"] = python_cmd
    
    # Enable features based on what's actually available
    enable_tables = has_table_packages
    enable_ocr = has_ocr_packages and has_tesseract
    
    env["RAG_ENABLE_TABLES"] = "1" if enable_tables else "0"
    env["RAG_ENABLE_OCR"] = "1" if enable_ocr else "0"
    
    # Ensure data directories exist
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        (DATA_DIR / "files").mkdir(exist_ok=True)
        (DATA_DIR / "temp").mkdir(exist_ok=True)
    except Exception as e:
        print(f"[WARN] Could not create data directories: {e}")
    
    print(f"\n[RAG CONFIG]")
    print(f"  PYTHON_PATH: {python_cmd}")
    print(f"  RAG_ENABLE_TABLES: {env['RAG_ENABLE_TABLES']}")
    print(f"  RAG_ENABLE_OCR: {env['RAG_ENABLE_OCR']}")
    print(f"  Platform: {platform.system()} {platform.release()}")
    
    if enable_tables:
        print("  ✓ Enhanced table extraction enabled")
    else:
        print("  ⚠ Enhanced table extraction disabled")
        print("    Missing: camelot-py, tabula-py, or pdfplumber")
        print("    Install with: pip install camelot-py[cv] tabula-py pdfplumber")
    
    if enable_ocr:
        print("  ✓ OCR functionality enabled") 
    else:
        print("  ⚠ OCR functionality disabled")
        if not has_ocr_packages:
            print("    Missing Python packages: pip install pytesseract Pillow")
        if not has_tesseract:
            print("    Missing tesseract: download from https://github.com/UB-Mannheim/tesseract/wiki")
    
    return env

def build_all(npm_cmd: str):
    # Builds both apps; assumes deps are already installed by install_deps.py
    sh([npm_cmd, "run", "build"], cwd=str(SERVER))
    sh([npm_cmd, "run", "build"], cwd=str(WEB))

def start_server(enhanced_env=None):
    env = enhanced_env or os.environ.copy()
    env.setdefault("PORT", DEFAULT_PORT)
    env.setdefault("OLLAMA_URL", DEFAULT_OLLAMA)

    dist_index = SERVER / "dist" / "index.js"
    if not dist_index.exists():
        print(f"[ERR] Server build not found at {dist_index}.")
        print("       Did you run 'python install_deps.py' first?")
        sys.exit(1)

    url = f"http://localhost:{env['PORT']}"
    try:
        webbrowser.open(url)
    except Exception:
        pass

    print(f"\n[INFO] Starting server on {url}")
    print(f"[INFO] Enhanced RAG features: Tables={env.get('RAG_ENABLE_TABLES', '0')}, OCR={env.get('RAG_ENABLE_OCR', '0')}")
    
    # Run the built server with enhanced environment
    sh(["node", str(dist_index)], cwd=str(SERVER), env=env)

def parse_args(argv):
    opts = {
        "no_build": False,
        "no_python_check": False,
        "force_enable": False,
        "force_basic": False
    }
    for a in argv[1:]:
        if a == "--no-build":
            opts["no_build"] = True
        elif a == "--no-python-check":
            opts["no_python_check"] = True
        elif a == "--force-enable":
            opts["force_enable"] = True
        elif a == "--force-basic":
            opts["force_basic"] = True
    return opts

def main():
    print("[INFO] Argon Enhanced RAG Runner (Windows Compatible)")
    ensure_node()
    npm_cmd = npm_path()

    opts = parse_args(sys.argv)
    
    # Setup enhanced RAG environment
    enhanced_env = None
    if not opts["force_basic"]:
        if opts["force_enable"]:
            print("\n[INFO] Force enabling all features (--force-enable)")
            enhanced_env = os.environ.copy()
            enhanced_env["PYTHON_PATH"] = python_path()
            enhanced_env["RAG_ENABLE_TABLES"] = "1"
            enhanced_env["RAG_ENABLE_OCR"] = "1"
        elif not opts["no_python_check"]:
            print("\n[STEP] Checking Python environment for Enhanced RAG...")
            python_available = check_python_environment()
            enhanced_env = setup_enhanced_rag_environment()
        else:
            enhanced_env = setup_enhanced_rag_environment()
    else:
        print("\n[INFO] Running in basic mode (no Python enhancements)")
        enhanced_env = os.environ.copy()
        enhanced_env["RAG_ENABLE_TABLES"] = "0"
        enhanced_env["RAG_ENABLE_OCR"] = "0"

    if not opts["no_build"]:
        print("\n[STEP] Building...")
        build_all(npm_cmd)
    else:
        print("\n[STEP] Skipping build (per --no-build)")

    start_server(enhanced_env)

if __name__ == "__main__":
    main()