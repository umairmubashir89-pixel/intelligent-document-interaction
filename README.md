# intelligent-document-interaction
#  Offline Chat + RAG (Ollama) | Detailed README
_Last updated: 2025-10-03_

## 1) What this project does
 it is a fully offline Chat + Retrieval‑Augmented Generation (RAG) system that runs on your machine with **Ollama**.  
You can **chat with documents** (PDF/DOCX, etc.), and the system will:
- **Index** your files (extract text, headings, tables, and optional OCR on scanned pages),
- **Embed** the content into a local vector store,
- **Retrieve** the most relevant chunks for your question (diverse via MMR),
- **Compose** an answer strictly from the retrieved context using your selected local LLM.

It ships with:
- A Fastify TypeScript server** exposing endpoints for chat, models, RAG indexing/search/QA.
- A simple static UI (`tools.html`) that works without building anything.
- An **optional React UI** for a nicer experience.
- Python extractors (PDF/DOCX parsing, tables, OCR) called by the server when indexing.

Everything is designed for **replication**: pull models with Ollama, install the dependencies, and you can reproduce exactly what you see.

---

## 2) High‑level architecture & how things work
```
+---------------------+         +------------------+
|  Web UI / tools.html|  HTTP   |  Fastify Server  |
|  (client)           +-------->+  (TypeScript)    |
+----------+----------+         +---------+--------+
           ^                              |
           | SSE (stream)                 | Calls Python extractors
           |                              v
           |                     +--------+--------+
           |                     |  Python Extract. |  (PyMuPDF/pdfplumber/
           |                     |  (PDF/DOCX/OCR)  |   Camelot/Tabula/Tesseract)
           |                     +--------+--------+
           |                               |
           |                               v
           |                     +---------+---------+
           |                     |  Embeddings (Ollama)|
           |                     +---------+---------+
           |                               |
           |                               v
           |                     +---------+---------+
           |                     | Local Vector Store |
           |                     |  (JSON index)      |
           |                     +---------+---------+
           |                               |
           |             Retrieval (cosine + MMR) and QA
           |                               |
           +<------------------------------+
```

**Flow**  
1) **Upload** a file to `/rag/index`. The server saves it under `apps/server/data/rag/files/`.  
2) **Parse & chunk** (server invokes Python):  
   - PDFs via **PyMuPDF / pdfminer.six / pdfplumber**; **OCR** via **Tesseract** if turned on.  
   - Tables via **Camelot** (Ghostscript) and/or **Tabula** (Java).  
   - DOCX via `python-docx` (Node `mammoth` as fallback if code path uses it).  
   - Headings, subheadings, and page numbers are captured when available.  
3) **Embed** chunks using **Ollama** (e.g., `nomic-embed-text`).  
4) **Store** vectors + metadata in a local JSON (`apps/server/data/rag/index.json`).  
5) **Retrieve** with cosine similarity + **MMR** (diversity) + per‑section caps.  
6) **Answer** with your **DEFAULT_MODEL**; responses are grounded strictly in retrieved context (citations included where implemented).

**Notable server routes (short list)**  
- `GET /models` — list Ollama models.  
- `POST /model/select` — choose/warm a model.  
- `POST /model/stop` — stop.  
- `POST /chat` and `POST /chat/stream` — chat (SSE stream).  
- `POST /rag/index` — upload+index a file.  
- `GET /rag/list` / `GET /rag/files` — list files.  
- `POST /rag/ask` — retrieve chunks only.  
- `POST /rag/qa` — retrieve + compose an answer.  
- `GET /api/rag/document/:fileId/structure` — what was extracted.  
- `POST /rag/clear` — wipe the index.

---

## 3) Tech used (what and why)
- **Fastify (TypeScript)** — fast Node server with compact routing.  
- **Ollama** — local LLM runtime (for both generation and embeddings).  
- **Python extractors** — more robust PDF/DOCX handling than pure JS.  
  - **PyMuPDF / pdfminer.six / pdfplumber** — text, layout, page structure.  
  - **Camelot / Tabula** — tables (line‑based vs stream‑based parsers).  
  - **Tesseract** — OCR for scanned PDFs.  
  - **python-docx** — DOCX parsing.  
- **MMR Retrieval** — ensures diverse context, not just repeating the same section.  
- **Local JSON Vector Store** — easy to inspect, backup, and replicate.

---

## 4) Setup at a glance
- **Prereqs (Windows)**: Node 20+, Python 3.10+, Git, Java (Temurin 17 JRE), Ghostscript, Tesseract, LibreOffice (optional).  
- **Prereqs (Ubuntu/macOS)**: same tools; system installers differ.  
- **Python venv**: `python -m venv .venv && .\.venv\Scripts\Activate.ps1` (Windows) or `source .venv/bin/activate` (Linux/macOS).  
- **Python libs**: `pip install -r argon_docs/requirements.txt`  
- **Ollama**: install, then `ollama pull <model>`.  
- **Server**: `cd apps/server && npm install && npm run build && node dist/index.js`  
- **Static UI**: open `http://localhost:8787/tools.html`  
- **React UI (optional)**: `cd apps/web && npm install && npm run dev`

---

## 5) Environment variables (server reads from process env)
| Variable | Purpose | Example |
|---|---|---|
| `PORT` | Server port | `8787` |
| `HOST` | Bind address | `0.0.0.0` |
| `OLLAMA_URL` | Ollama endpoint | `http://127.0.0.1:11434` |
| `DEFAULT_MODEL` | Generation model | `gemma3:12b` |
| `EMBED_MODEL` | Embedding model | `nomic-embed-text:latest` |
| `GEN_NUM_CTX` | Context window request | `32768` |
| `RAG_ENABLE_OCR` | Enable OCR pass | `true`/`false` |
| `RAG_ENABLE_TABLES` | Enable tables | `true`/`false` |
| `PYTHON_PATH` | Optional Python path | `C:\\Python312\\python.exe` |

> Windows (PowerShell): `$env:VAR = "value"`  
> Linux/macOS: `export VAR=value`

---

## 6) Full dependency & tools list **with one‑liner install commands**
**Note:** pick the column that matches your OS. Commands are **one‑liners** per dependency/tool, as requested.

### 6.1 System Tools
| Tool | Purpose | Windows (winget) | Windows (choco) | Ubuntu/Debian (apt) | macOS (brew) |
|---|---|---|---|---|---|
| Node.js 20+ | Server runtime | `winget install OpenJS.NodeJS.LTS` | `choco install -y nodejs-lts` | `sudo apt update && sudo apt install -y nodejs npm`* | `brew install node` |
| Python 3.10+ | Python extractors | `winget install Python.Python.3.12` | `choco install -y python` | `sudo apt install -y python3 python3-venv python3-pip` | `brew install python` |
| Git | Dev utility | `winget install Git.Git` | `choco install -y git` | `sudo apt install -y git` | `brew install git` |
| Java JRE 17 | Tabula | `winget install EclipseAdoptium.Temurin.17.JRE` | `choco install -y temurin17jre` | `sudo apt install -y default-jre` | `brew install temurin` |
| Ghostscript | Camelot backend | `winget install ArtifexSoftware.GhostScript` | `choco install -y ghostscript` | `sudo apt install -y ghostscript` | `brew install ghostscript` |
| Tesseract OCR | OCR backend | `winget install UB-Mannheim.TesseractOCR` | `choco install -y tesseract` | `sudo apt install -y tesseract-ocr` | `brew install tesseract` |
| LibreOffice *(optional)* | DOC→DOCX | `winget install TheDocumentFoundation.LibreOffice` | `choco install -y libreoffice-fresh` | `sudo apt install -y libreoffice` | `brew install --cask libreoffice` |
| VS Build Tools | node-gyp toolchain | *(download GUI installer)* | `choco install -y visualstudio2022buildtools` | *(gcc/clang already via build-essential)* | Xcode CLT: `xcode-select --install` |

\* On Ubuntu, consider NodeSource or nvm for modern Node LTS.

### 6.2 Python Libraries (RAG extractors)
One‑liner (recommended):  
`pip install -r argon_docs/requirements.txt`

Includes (for reference): `pymupdf`, `pymupdf4llm`, `pdfminer.six`, `pdfplumber`, `camelot-py`, `tabula-py`, `pytesseract`, `Pillow`, `python-docx`, `numpy`, `pandas`.

### 6.3 Node dependencies
One‑liner per app:  
- Server: `cd apps/server && npm install`  
- Web (optional): `cd apps/web && npm install`

---

## 7) Quick start (Windows)
```powershell
# Install system tools via winget (pick what you need)
winget install OpenJS.NodeJS.LTS; winget install Python.Python.3.12; winget install EclipseAdoptium.Temurin.17.JRE; winget install ArtifexSoftware.GhostScript; winget install UB-Mannheim.TesseractOCR

# Python venv + libs
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install -r argon_docs/requirements.txt

# Pull models
ollama pull gemma3:12b
ollama pull nomic-embed-text:latest

# Build + run server
cd apps/server
npm install
npm run build
$env:OLLAMA_URL = "http://127.0.0.1:11434"
$env:DEFAULT_MODEL = "gemma3:12b"
$env:EMBED_MODEL = "nomic-embed-text:latest"
$env:GEN_NUM_CTX = "32768"
$env:RAG_ENABLE_OCR = "true"
$env:RAG_ENABLE_TABLES = "true"
node .\dist\index.js
```

Open **http://localhost:8787/tools.html** to test instantly.

---

## 8) Tips & replication notes
- Keep your **Ollama** models the same versions for consistent results.  
- Back up `apps/server/data/rag/` if you want to preserve the index.  
- If Camelot fails on certain PDFs, try **Tabula** mode or enable OCR for scanned docs.  
- For production, put the server behind a reverse proxy and add auth.

---

## 9) License / credits
Please comply with licenses for Ollama models and individual libraries (PyMuPDF, Camelot, Tabula, Tesseract, etc.).


