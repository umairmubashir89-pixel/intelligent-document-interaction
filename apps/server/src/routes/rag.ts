// apps/server/src/routes/rag.ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import pdfParse from "pdf-parse";

// ──────────────────────────────────────────────────────────────
// Config (OFFLINE via Ollama) & storage
// ──────────────────────────────────────────────────────────────
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const EMBED_MODEL = process.env.EMBED_MODEL || "nomic-embed-text:latest";
const GEN_MODEL = process.env.DEFAULT_MODEL || "gemma3:12b";
const GEN_NUM_CTX = Number(process.env.GEN_NUM_CTX || 32768);

const DATA_DIR = path.resolve(process.cwd(), "data", "rag");
const FILE_DIR = path.join(DATA_DIR, "files");
const TEMP_DIR = path.join(DATA_DIR, "temp");
const INDEX_FN = path.join(DATA_DIR, "index.json");
const RAG_ENABLE_TABLES = (process.env.RAG_ENABLE_TABLES === "1"); // OFF by default
const RAG_ENABLE_OCR = (process.env.RAG_ENABLE_OCR === "1"); // OFF by default
const PYTHON_PATH = process.env.PYTHON_PATH || "python3";

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────
type FileMeta = {
  id: string;
  chatId?: string;
  name: string;
  path: string;
  size: number;
  pages?: number;
  uploadedAt: string;
  authors?: string[];
  documentType?: 'pdf' | 'docx' | 'doc' | 'txt' | 'md' | 'other';
};

type Vec = {
  id: string;
  fileId: string;
  chatId?: string;
  name: string;
  text: string;
  embedding: number[];
  headingPath?: string[];
  sectionType?: 'heading' | 'subheading' | 'section' | 'subsection' | 'table' | 'text' | 'metadata';
  authors?: string[];
  pageNumber?: number;
};

type DocumentStructure = {
  title?: string;
  authors?: string[];
  headings: Array<{
    level: number;
    text: string;
    page?: number;
    sections: string[];
  }>;
  tables: Array<{
    page?: number;
    data: string[][];
    caption?: string;
  }>;
  metadata: Record<string, any>;
};

type IndexData = { files: FileMeta[]; vectors: Vec[] };

let RAG_ROUTES_REGISTERED = false; // avoid double-registration

// ──────────────────────────────────────────────────────────────
// Python Script Execution Helper
// ──────────────────────────────────────────────────────────────
async function runPythonScript(scriptContent: string, args: string[] = []): Promise<string> {
  return new Promise((resolve, reject) => {
    const tempScript = path.join(TEMP_DIR, `script_${randomUUID()}.py`);
    
    const cleanup = async () => {
      try { await fsp.unlink(tempScript); } catch {}
    };

    fsp.writeFile(tempScript, scriptContent).then(() => {
      const python = spawn(PYTHON_PATH, [tempScript, ...args], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      python.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      python.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      python.on('close', async (code) => {
        await cleanup();
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Python script failed: ${stderr}`));
        }
      });

      python.on('error', async (err) => {
        await cleanup();
        reject(err);
      });
    }).catch(reject);
  });
}

// ──────────────────────────────────────────────────────────────
// Enhanced Document Processing Scripts
// ──────────────────────────────────────────────────────────────
const ENHANCED_PDF_PROCESSOR = `
import json
import sys
import os
from typing import List, Dict, Any

try:
    import fitz  # pymupdf
    import pymupdf4llm
except ImportError:
    fitz = None
    pymupdf4llm = None

try:
    from pdfminer.high_level import extract_text as pdfminer_extract
    from pdfminer.layout import LAParams
except ImportError:
    pdfminer_extract = None

try:
    import pdfplumber
except ImportError:
    pdfplumber = None

try:
    import camelot
except ImportError:
    camelot = None

try:
    import tabula
except ImportError:
    tabula = None

try:
    import pytesseract
    from PIL import Image
except ImportError:
    pytesseract = None
    Image = None

def extract_metadata_pymupdf(pdf_path: str) -> Dict[str, Any]:
    """Extract metadata using PyMuPDF"""
    try:
        doc = fitz.open(pdf_path)
        metadata = doc.metadata
        authors = []
        if metadata.get('author'):
            authors = [metadata['author']]
        
        return {
            'title': metadata.get('title', ''),
            'authors': authors,
            'creator': metadata.get('creator', ''),
            'producer': metadata.get('producer', ''),
            'subject': metadata.get('subject', ''),
            'keywords': metadata.get('keywords', ''),
            'pages': doc.page_count
        }
    except:
        return {}

def extract_structured_content_pymupdf4llm(pdf_path: str) -> Dict[str, Any]:
    """Extract structured content using pymupdf4llm"""
    try:
        md_text = pymupdf4llm.to_markdown(pdf_path, 
                                         page_chunks=True, 
                                         write_images=False,
                                         extract_words=True)
        
        # Parse the markdown to extract headings
        headings = []
        current_heading = None
        lines = md_text.split('\\n')
        
        for i, line in enumerate(lines):
            line = line.strip()
            if line.startswith('#'):
                level = len(line) - len(line.lstrip('#'))
                text = line.lstrip('#').strip()
                headings.append({
                    'level': level,
                    'text': text,
                    'line': i
                })
        
        return {
            'content': md_text,
            'headings': headings
        }
    except:
        return {'content': '', 'headings': []}

def extract_tables_camelot(pdf_path: str) -> List[Dict[str, Any]]:
    """Extract tables using Camelot"""
    if not camelot:
        return []
    
    try:
        tables = camelot.read_pdf(pdf_path, pages='all', flavor='lattice')
        result = []
        
        for i, table in enumerate(tables):
            result.append({
                'page': table.parsing_report['page'],
                'data': table.df.values.tolist(),
                'confidence': table.parsing_report.get('accuracy', 0),
                'method': 'camelot-lattice'
            })
        
        # Try stream method if lattice didn't find tables
        if not result:
            tables = camelot.read_pdf(pdf_path, pages='all', flavor='stream')
            for i, table in enumerate(tables):
                result.append({
                    'page': table.parsing_report['page'],
                    'data': table.df.values.tolist(),
                    'confidence': table.parsing_report.get('accuracy', 0),
                    'method': 'camelot-stream'
                })
        
        return result
    except:
        return []

def extract_tables_tabula(pdf_path: str) -> List[Dict[str, Any]]:
    """Extract tables using Tabula"""
    if not tabula:
        return []
    
    try:
        dfs = tabula.read_pdf(pdf_path, pages='all', multiple_tables=True)
        result = []
        
        for i, df in enumerate(dfs):
            result.append({
                'page': i + 1,  # Approximate page number
                'data': df.values.tolist(),
                'method': 'tabula'
            })
        
        return result
    except:
        return []

def extract_tables_pdfplumber(pdf_path: str) -> List[Dict[str, Any]]:
    """Extract tables using pdfplumber"""
    if not pdfplumber:
        return []
    
    try:
        result = []
        with pdfplumber.open(pdf_path) as pdf:
            for page_num, page in enumerate(pdf.pages, 1):
                tables = page.extract_tables()
                for table in tables:
                    if table:  # Filter out empty tables
                        result.append({
                            'page': page_num,
                            'data': table,
                            'method': 'pdfplumber'
                        })
        
        return result
    except:
        return []

def perform_ocr_on_pdf(pdf_path: str) -> str:
    """Perform OCR on PDF using Tesseract"""
    if not pytesseract or not Image or not fitz:
        return ""
    
    try:
        doc = fitz.open(pdf_path)
        ocr_text = ""
        
        for page_num in range(doc.page_count):
            page = doc[page_num]
            # Convert page to image
            mat = fitz.Matrix(2, 2)  # 2x zoom for better OCR
            pix = page.get_pixmap(matrix=mat)
            img_data = pix.tobytes("png")
            
            # Save temporary image
            temp_img = f"/tmp/page_{page_num}.png"
            with open(temp_img, "wb") as f:
                f.write(img_data)
            
            # Perform OCR
            try:
                text = pytesseract.image_to_string(Image.open(temp_img))
                ocr_text += f"\\n\\n=== Page {page_num + 1} OCR ===\\n{text}"
            finally:
                try:
                    os.unlink(temp_img)
                except:
                    pass
        
        return ocr_text
    except:
        return ""

def process_pdf(pdf_path: str, enable_ocr: bool = False) -> str:
    """Main PDF processing function"""
    result = {
        'metadata': {},
        'content': '',
        'headings': [],
        'tables': [],
        'ocr_text': ''
    }
    
    # Extract metadata
    if fitz:
        result['metadata'] = extract_metadata_pymupdf(pdf_path)
    
    # Extract structured content
    if pymupdf4llm:
        structured = extract_structured_content_pymupdf4llm(pdf_path)
        result['content'] = structured['content']
        result['headings'] = structured['headings']
    elif pdfminer_extract:
        try:
            result['content'] = pdfminer_extract(pdf_path, laparams=LAParams())
        except:
            pass
    
    # Extract tables (try multiple methods)
    tables = []
    if camelot:
        tables.extend(extract_tables_camelot(pdf_path))
    if not tables and tabula:
        tables.extend(extract_tables_tabula(pdf_path))
    if not tables and pdfplumber:
        tables.extend(extract_tables_pdfplumber(pdf_path))
    
    result['tables'] = tables
    
    # OCR if enabled and content is sparse
    if enable_ocr and len(result['content'].strip()) < 100:
        result['ocr_text'] = perform_ocr_on_pdf(pdf_path)
    
    return json.dumps(result, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "PDF path required"}))
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    enable_ocr = len(sys.argv) > 2 and sys.argv[2].lower() == 'true'
    
    try:
        result = process_pdf(pdf_path, enable_ocr)
        print(result)
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
`;

const DOCX_PROCESSOR = `
import json
import sys
from typing import Dict, Any, List

try:
    from docx import Document
    from docx.document import Document as DocumentType
    from docx.oxml.text.paragraph import CT_P
    from docx.oxml.table import CT_Tbl
    from docx.table import _Cell, Table
    from docx.text.paragraph import Paragraph
except ImportError:
    Document = None

def extract_docx_structure(docx_path: str) -> Dict[str, Any]:
    """Extract structured content from DOCX"""
    if not Document:
        return {"error": "python-docx not available"}
    
    try:
        doc = Document(docx_path)
        
        result = {
            'title': '',
            'authors': [],
            'headings': [],
            'content': '',
            'tables': [],
            'metadata': {}
        }
        
        # Extract core properties
        if hasattr(doc, 'core_properties'):
            props = doc.core_properties
            result['title'] = props.title or ''
            result['authors'] = [props.author] if props.author else []
            result['metadata'] = {
                'subject': props.subject or '',
                'keywords': props.keywords or '',
                'created': str(props.created) if props.created else '',
                'modified': str(props.modified) if props.modified else ''
            }
        
        content_parts = []
        heading_level_map = {}
        
        # Process document elements in order
        for element in doc.element.body:
            if isinstance(element, CT_P):
                paragraph = Paragraph(element, doc)
                text = paragraph.text.strip()
                
                if text:
                    # Check if it's a heading
                    style_name = paragraph.style.name if paragraph.style else ''
                    if 'Heading' in style_name:
                        try:
                            level = int(style_name.split()[-1])
                            result['headings'].append({
                                'level': level,
                                'text': text,
                                'style': style_name
                            })
                            content_parts.append(f"{'#' * level} {text}")
                        except:
                            content_parts.append(text)
                    else:
                        content_parts.append(text)
            
            elif isinstance(element, CT_Tbl):
                table = Table(element, doc)
                table_data = []
                
                for row in table.rows:
                    row_data = []
                    for cell in row.cells:
                        row_data.append(cell.text.strip())
                    table_data.append(row_data)
                
                if table_data:
                    result['tables'].append({
                        'data': table_data,
                        'rows': len(table_data),
                        'cols': len(table_data[0]) if table_data else 0
                    })
                    
                    # Add table to content in markdown format
                    if table_data:
                        content_parts.append("\\n### Table\\n")
                        for i, row in enumerate(table_data):
                            content_parts.append("| " + " | ".join(row) + " |")
                            if i == 0:  # Add separator after header
                                content_parts.append("| " + " | ".join(["---"] * len(row)) + " |")
        
        result['content'] = "\\n\\n".join(content_parts)
        return result
        
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "DOCX path required"}))
        sys.exit(1)
    
    docx_path = sys.argv[1]
    
    try:
        result = extract_docx_structure(docx_path)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
`;

const DOC_CONVERTER = `
import json
import sys
import subprocess
import tempfile
import os

def convert_doc_to_docx(doc_path: str) -> str:
    """Convert DOC to DOCX using LibreOffice"""
    try:
        temp_dir = tempfile.mkdtemp()
        
        # Use LibreOffice to convert DOC to DOCX
        cmd = [
            'libreoffice',
            '--headless',
            '--convert-to', 'docx',
            '--outdir', temp_dir,
            doc_path
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        
        if result.returncode == 0:
            # Find the converted file
            base_name = os.path.splitext(os.path.basename(doc_path))[0]
            docx_path = os.path.join(temp_dir, f"{base_name}.docx")
            
            if os.path.exists(docx_path):
                return docx_path
        
        raise Exception(f"Conversion failed: {result.stderr}")
        
    except Exception as e:
        raise Exception(f"DOC conversion error: {str(e)}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "DOC path required"}))
        sys.exit(1)
    
    doc_path = sys.argv[1]
    
    try:
        docx_path = convert_doc_to_docx(doc_path)
        print(json.dumps({"docx_path": docx_path}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
`;

// ──────────────────────────────────────────────────────────────
// FS helpers
// ──────────────────────────────────────────────────────────────
async function ensure() {
  await fsp.mkdir(FILE_DIR, { recursive: true });
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(TEMP_DIR, { recursive: true });
  if (!fs.existsSync(INDEX_FN)) {
    const init: IndexData = { files: [], vectors: [] };
    await fsp.writeFile(INDEX_FN, JSON.stringify(init, null, 2), "utf-8");
  }
}

async function loadIndex(): Promise<IndexData> {
  await ensure();
  const raw = await fsp.readFile(INDEX_FN, "utf-8");
  try { return JSON.parse(raw) as IndexData; }
  catch { return { files: [], vectors: [] }; }
}

async function saveIndex(idx: IndexData) {
  await ensure();
  await fsp.writeFile(INDEX_FN, JSON.stringify(idx, null, 2), "utf-8");
}

// ──────────────────────────────────────────────────────────────
// Math & helpers
// ──────────────────────────────────────────────────────────────
function cosine(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

// ──────────────────────────────────────────────────────────────
// Ollama (OFFLINE) clients
// ──────────────────────────────────────────────────────────────
async function embed(text: string): Promise<number[]> {
  const r = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });
  if (!r.ok) throw new Error(`embeddings failed: ${r.status} ${r.statusText}`);
  const j: any = await r.json();
  const v = j?.embedding ?? j?.embeddings?.[0] ?? j?.data?.[0]?.embedding;
  if (!Array.isArray(v)) throw new Error("No embedding vector returned from Ollama");
  return v as number[];
}

async function chat(messages: { role: "system" | "user" | "assistant"; content: string }[]) {
  const r = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GEN_MODEL,
      messages,
      options: { temperature: 0.2, num_ctx: GEN_NUM_CTX, num_predict: -1 },
    }),
  });
  if (!r.ok) throw new Error(`chat failed: ${r.status} ${r.statusText}`);
  const j: any = await r.json();
  return (
    j?.message?.content ??
    j?.messages?.[j.messages?.length - 1]?.content ??
    j?.content ??
    ""
  ) as string;
}

// ──────────────────────────────────────────────────────────────
// Enhanced Document Processing Functions
// ──────────────────────────────────────────────────────────────

async function processEnhancedPDF(filePath: string): Promise<DocumentStructure> {
  try {
    const result = await runPythonScript(ENHANCED_PDF_PROCESSOR, [filePath, RAG_ENABLE_OCR.toString()]);
    const parsed = JSON.parse(result);
    
    if (parsed.error) {
      throw new Error(parsed.error);
    }
    
    return {
      title: parsed.metadata?.title || '',
      authors: parsed.metadata?.authors || [],
      headings: parsed.headings || [],
      tables: parsed.tables || [],
      metadata: parsed.metadata || {}
    };
  } catch (error) {
    console.warn('Enhanced PDF processing failed, falling back to basic extraction:', error);
    // Fallback to basic PDF extraction
    return { headings: [], tables: [], metadata: {} };
  }
}

async function processEnhancedDOCX(filePath: string): Promise<DocumentStructure> {
  try {
    const result = await runPythonScript(DOCX_PROCESSOR, [filePath]);
    const parsed = JSON.parse(result);
    
    if (parsed.error) {
      throw new Error(parsed.error);
    }
    
    return {
      title: parsed.title || '',
      authors: parsed.authors || [],
      headings: parsed.headings || [],
      tables: parsed.tables || [],
      metadata: parsed.metadata || {}
    };
  } catch (error) {
    console.warn('Enhanced DOCX processing failed, falling back to mammoth:', error);
    // Fallback to mammoth
    return { headings: [], tables: [], metadata: {} };
  }
}

async function processEnhancedDOC(filePath: string): Promise<DocumentStructure> {
  try {
    // First convert DOC to DOCX
    const conversionResult = await runPythonScript(DOC_CONVERTER, [filePath]);
    const parsed = JSON.parse(conversionResult);
    
    if (parsed.error) {
      throw new Error(parsed.error);
    }
    
    // Then process the DOCX
    const docxPath = parsed.docx_path;
    const structure = await processEnhancedDOCX(docxPath);
    
    // Cleanup temporary DOCX
    try {
      await fsp.unlink(docxPath);
    } catch {}
    
    return structure;
  } catch (error) {
    console.warn('Enhanced DOC processing failed:', error);
    return { headings: [], tables: [], metadata: {} };
  }
}

async function extractDocxBuffer(buf: Buffer) {
  try {
    const mammoth = await import("mammoth");
    const { value } = await (mammoth as any).extractRawText({ buffer: buf });
    return value || "";
  } catch { return ""; }
}

async function extractPdfBuffer(buf: Buffer) {
  try {
    const pdf = await pdfParse(buf);
    return (pdf?.text || "").trim();
  } catch { return ""; }
}

/**
 * Enhanced table extraction with multiple fallback methods
 */
async function extractPdfTablesToMarkdown(tempPdfPath: string): Promise<string> {
  // Guard: feature is OFF unless explicitly enabled
  if (!RAG_ENABLE_TABLES) return "";

  try {
    // Try Python-based extraction first
    const result = await runPythonScript(ENHANCED_PDF_PROCESSOR, [tempPdfPath, 'false']);
    const parsed = JSON.parse(result);
    
    if (parsed.tables && parsed.tables.length > 0) {
      const mdChunks: string[] = [];
      
      for (const table of parsed.tables) {
        const data: string[][] = table.data || [];
        if (!data.length) continue;
        
        const cols = Math.max(...data.map((r: string[]) => r.length));
        const norm = data.map((r: string[]) => [...r, ...Array(Math.max(0, cols - r.length)).fill("")]);
        const header = norm[0];
        const sep = Array(cols).fill("---");
        const lines = [
          `| ${header.join(" | ")} |`,
          `| ${sep.join(" | ")} |`,
          ...norm.slice(1).map((r: string[]) => `| ${r.join(" | ")} |`)
        ];
        
        const mdTable = lines.join("\n");
        mdChunks.push(`\n\n#### Extracted Table (Page ${table.page || "?"}) - ${table.method}\n${mdTable}\n`);
      }
      
      return mdChunks.join("\n");
    }
  } catch (error) {
    console.warn('Python table extraction failed, falling back to pdf-table-extractor:', error);
  }

  // Fallback to original pdf-table-extractor method
  let Canvas: any, Image: any;
  try {
    const cnv = await import("canvas");
    Canvas = (cnv as any).Canvas || (cnv as any).default?.Canvas || (cnv as any);
    Image = (cnv as any).Image || (cnv as any).default?.Image;
    (globalThis as any).Canvas = Canvas;
    (globalThis as any).Image = Image;
  } catch {
    return "";
  }

  try {
    const mod: any = await import("pdf-table-extractor");
    const pdf_table_extractor = mod?.default ?? mod;

    const tables = await new Promise<any>((resolve, reject) => {
      try {
        pdf_table_extractor(
          tempPdfPath,
          (res: any) => resolve(res),
          (err: any) => reject(err)
        );
      } catch (e) {
        return reject(e);
      }
    });

    const mdFromArray = (arr: string[][]) => {
      if (!arr || !arr.length) return "";
      const cols = Math.max(...arr.map(r => r.length));
      const norm = arr.map(r => [...r, ...Array(Math.max(0, cols - r.length)).fill("")]);
      const header = norm[0];
      const sep = Array(cols).fill("---");
      const lines = [
        `| ${header.join(" | ")} |`,
        `| ${sep.join(" | ")} |`,
        ...norm.slice(1).map(r => `| ${r.join(" | ")} |`)
      ];
      return lines.join("\n");
    };

    const mdChunks: string[] = [];
    if (tables && Array.isArray(tables.pageTables)) {
      for (const page of tables.pageTables) {
        const data: string[][] = page?.tables || [];
        if (!data.length) continue;
        const md = mdFromArray(data);
        if (md.trim()) mdChunks.push(`\n\n#### Extracted Table (Page ${page?.page || "?"})\n${md}\n`);
      }
    }
    return mdChunks.join("\n");
  } catch {
    return "";
  }
}

// ──────────────────────────────────────────────────────────────
// Enhanced splitting: headings + sections + metadata awareness
// ──────────────────────────────────────────────────────────────
function splitIntoEnhancedSections(
  fullText: string, 
  structure: DocumentStructure, 
  fileName: string
): { headingPath: string[], section: string, sectionType: Vec['sectionType'], pageNumber?: number }[] {
  const lines = (fullText || "").split("\n");
  const blocks: { 
    headingPath: string[]; 
    section: string; 
    sectionType: Vec['sectionType']; 
    pageNumber?: number;
  }[] = [];
  
  // Add metadata section if available
  if (structure.title || structure.authors?.length) {
    const metadataLines = [];
    if (structure.title) metadataLines.push(`Title: ${structure.title}`);
    if (structure.authors?.length) metadataLines.push(`Authors: ${structure.authors.join(', ')}`);
    if (structure.metadata) {
      Object.entries(structure.metadata).forEach(([key, value]) => {
        if (value) metadataLines.push(`${key}: ${value}`);
      });
    }
    
    blocks.push({
      headingPath: ['METADATA'],
      section: metadataLines.join('\n'),
      sectionType: 'metadata'
    });
  }

  let currentHeading = "ROOT";
  let currentHeadingLevel = 0;
  let buf: string[] = [];
  let currentPageNumber: number | undefined;

  const isHeading = (line: string) => {
    const trimmed = line.trim();
    return /^(#+\s.+)|^(\d+(\.\d+)*\s+.+)|^[A-Z][A-Z0-9 ,\-()]{6,}$/.test(trimmed);
  };

  const getHeadingLevel = (line: string): number => {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) {
      return trimmed.length - trimmed.replace(/^#+/, '').length;
    }
    if (/^\d+(\.\d+)*\s/.test(trimmed)) {
      return (trimmed.match(/\./g) || []).length + 1;
    }
    return 1; // Default level for other headings
  };

  const getSectionType = (headingLevel: number): Vec['sectionType'] => {
    if (headingLevel === 1) return 'heading';
    if (headingLevel === 2) return 'subheading';
    if (headingLevel <= 4) return 'section';
    return 'subsection';
  };

  const push = () => {
    if (buf.length) {
      const sectionText = buf.join("\n").trim();
      if (sectionText) {
        blocks.push({ 
          headingPath: [currentHeading], 
          section: sectionText,
          sectionType: currentHeadingLevel > 0 ? getSectionType(currentHeadingLevel) : 'text',
          pageNumber: currentPageNumber
        });
      }
    }
    buf = [];
  };

  for (const line of lines) {
    // Check for page markers
    const pageMatch = line.match(/^=== Page (\d+)/);
    if (pageMatch) {
      currentPageNumber = parseInt(pageMatch[1]);
      continue;
    }

    if (isHeading(line)) {
      push();
      currentHeading = line.trim().replace(/^#+\s*/, '').replace(/^\d+(\.\d+)*\s*/, '');
      currentHeadingLevel = getHeadingLevel(line);
      buf.push(line);
    } else {
      buf.push(line);
    }
  }
  push();

  // Add table sections separately
  if (structure.tables && structure.tables.length > 0) {
    structure.tables.forEach((table, index) => {
      const tableMarkdown = convertTableToMarkdown(table.data);
      if (tableMarkdown) {
        blocks.push({
          headingPath: [`Table ${index + 1}${table.caption ? `: ${table.caption}` : ''}`],
          section: tableMarkdown,
          sectionType: 'table',
          pageNumber: table.page
        });
      }
    });
  }

  return blocks.length ? blocks : [{ 
    headingPath: ["ROOT"], 
    section: fullText,
    sectionType: 'text'
  }];
}

function convertTableToMarkdown(data: string[][]): string {
  if (!data || !data.length) return "";
  
  const cols = Math.max(...data.map(r => r.length));
  const normalized = data.map(r => [...r, ...Array(Math.max(0, cols - r.length)).fill("")]);
  const header = normalized[0];
  const separator = Array(cols).fill("---");
  
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${separator.join(" | ")} |`,
    ...normalized.slice(1).map(r => `| ${r.join(" | ")} |`)
  ];
  
  return lines.join("\n");
}

function chunkText(s: string, size = 1500, overlap = 200) {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    out.push(s.slice(i, i + size));
    i += Math.max(1, size - overlap);
  }
  return out.filter(Boolean);
}

// ──────────────────────────────────────────────────────────────
// Enhanced Indexing with document structure awareness
// ──────────────────────────────────────────────────────────────
async function indexFile(fileId: string, name: string, fullPath: string, chatId?: string) {
  const idx = await loadIndex();
  const buf = await fsp.readFile(fullPath);
  const lower = name.toLowerCase();
  const documentType: FileMeta['documentType'] = 
    lower.endsWith('.pdf') ? 'pdf' :
    lower.endsWith('.docx') ? 'docx' :
    lower.endsWith('.doc') ? 'doc' :
    lower.endsWith('.txt') ? 'txt' :
    lower.endsWith('.md') ? 'md' : 'other';

  let rawText = "";
  let pages: number | undefined;
  let structure: DocumentStructure = { headings: [], tables: [], metadata: {} };

  try {
    if (documentType === 'txt' || documentType === 'md') {
      rawText = buf.toString("utf8");
    } else if (documentType === 'docx') {
      structure = await processEnhancedDOCX(fullPath);
      rawText = structure.metadata?.content || await extractDocxBuffer(buf);
    } else if (documentType === 'doc') {
      structure = await processEnhancedDOC(fullPath);
      rawText = structure.metadata?.content || buf.toString("utf8");
    } else if (documentType === 'pdf') {
      structure = await processEnhancedPDF(fullPath);
      
      // Use enhanced content if available, otherwise fallback to basic extraction
      if (structure.metadata?.content) {
        rawText = structure.metadata.content;
      } else {
        const parsed = await pdfParse(buf);
        rawText = (parsed?.text || "").trim();
      }
      
      pages = structure.metadata?.pages || (await pdfParse(buf))?.numpages;

      // Add table extraction
      const tmpPdf = path.join(FILE_DIR, `${fileId}-tmp.pdf`);
      await fsp.writeFile(tmpPdf, buf);
      const tableMd = await extractPdfTablesToMarkdown(tmpPdf);
      await fsp.rm(tmpPdf, { force: true });
      if (tableMd) rawText += `\n\n${tableMd}`;
    } else {
      rawText = buf.toString("utf8"); // best-effort
    }
  } catch (error) {
    console.warn(`Enhanced processing failed for ${name}:`, error);
    // Fallback to basic extraction
    if (documentType === 'pdf') {
      const parsed = await pdfParse(buf);
      rawText = (parsed?.text || "").trim();
      pages = parsed?.numpages;
    } else if (documentType === 'docx') {
      rawText = await extractDocxBuffer(buf);
    } else {
      rawText = buf.toString("utf8");
    }
  }

  const sections = splitIntoEnhancedSections(rawText || name, structure, name);
  const vecs: Vec[] = [];

  for (const sec of sections) {
    const pieces = chunkText(sec.section, 1500, 200);
    for (const piece of pieces) {
      const emb = await embed(piece);
      vecs.push({
        id: `${fileId}_${vecs.length}`,
        fileId,
        chatId,
        name,
        text: piece,
        embedding: emb,
        headingPath: sec.headingPath,
        sectionType: sec.sectionType,
        authors: structure.authors,
        pageNumber: sec.pageNumber,
      });
    }
  }

  if (!idx.files.find((f) => f.id === fileId)) {
    idx.files.push({
      id: fileId,
      chatId,
      name,
      path: fullPath,
      size: buf.length,
      pages,
      uploadedAt: new Date().toISOString(),
      authors: structure.authors,
      documentType,
    });
  }

  idx.vectors = (idx.vectors || []).concat(vecs);
  await saveIndex(idx);
}

async function indexPdfBuffer(buf: Buffer, fileName: string, chatId?: string) {
  const fileId = createHash("sha1").update(fileName + Date.now().toString()).digest("hex");
  const idx = await loadIndex();

  let rawText = "";
  let pages: number | undefined;
  let structure: DocumentStructure = { headings: [], tables: [], metadata: {} };

  try {
    // Save buffer to temp file for enhanced processing
    const tmpPdf = path.join(FILE_DIR, `${fileId}-buf.pdf`);
    await fsp.writeFile(tmpPdf, buf);
    
    structure = await processEnhancedPDF(tmpPdf);
    
    if (structure.metadata?.content) {
      rawText = structure.metadata.content;
      pages = structure.metadata.pages;
    } else {
      // Fallback to basic extraction
      const parsed = await pdfParse(buf);
      rawText = (parsed?.text || "").trim();
      pages = parsed?.numpages;
    }

    // Add table extraction
    const tableMd = await extractPdfTablesToMarkdown(tmpPdf);
    await fsp.rm(tmpPdf, { force: true });
    if (tableMd) rawText += `\n\n${tableMd}`;
  } catch (error) {
    console.warn('Enhanced PDF buffer processing failed:', error);
    // Fallback to basic extraction
    const parsed = await pdfParse(buf);
    rawText = (parsed?.text || "").trim();
    pages = parsed?.numpages;
  }

  const sections = splitIntoEnhancedSections(rawText || fileName, structure, fileName);
  const vecs: Vec[] = [];

  for (const sec of sections) {
    const pieces = chunkText(sec.section, 1500, 200);
    for (const piece of pieces) {
      const emb = await embed(piece);
      vecs.push({
        id: `${fileId}_${vecs.length}`,
        fileId,
        chatId,
        name: fileName,
        text: piece,
        embedding: emb,
        headingPath: sec.headingPath,
        sectionType: sec.sectionType,
        authors: structure.authors,
        pageNumber: sec.pageNumber,
      });
    }
  }

  if (!idx.files.find((f) => f.id === fileId)) {
    idx.files.push({
      id: fileId,
      chatId,
      name: fileName,
      path: "",
      size: buf.length,
      pages,
      uploadedAt: new Date().toISOString(),
      authors: structure.authors,
      documentType: 'pdf',
    });
  }

  idx.vectors = (idx.vectors || []).concat(vecs);
  await saveIndex(idx);
  
  return { 
    id: fileId, 
    name: fileName, 
    chunks: vecs.length, 
    pages, 
    size: buf.length, 
    chatId,
    authors: structure.authors
  };
}

// ──────────────────────────────────────────────────────────────
// Enhanced Retrieval: MMR + per-section cap + content type awareness
// ──────────────────────────────────────────────────────────────
function mmrSelect(
  candidates: { v: Vec; s: number }[],
  k: number,
  lambda = 0.7,
  perSectionCap = 3
) {
  const selected: { v: Vec; s: number }[] = [];
  const usedBySection: Record<string, number> = {};
  const headingKey = (v: Vec) => (v.headingPath && v.headingPath.join(" / ")) || "ROOT";

  while (selected.length < Math.min(k, candidates.length)) {
    let bestIdx = -1;
    let bestVal = -Infinity;

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const key = headingKey(c.v);
      const used = usedBySection[key] || 0;
      if (used >= perSectionCap) continue;

      const diversity = selected.length
        ? Math.max(...selected.map(s => cosine(c.v.embedding, s.v.embedding)))
        : 0;

      // Boost certain section types based on query context
      let typeBoost = 1.0;
      if (c.v.sectionType === 'heading' || c.v.sectionType === 'subheading') {
        typeBoost = 1.1; // Slight boost for headings
      } else if (c.v.sectionType === 'metadata') {
        typeBoost = 0.9; // Slight penalty for metadata unless specifically relevant
      } else if (c.v.sectionType === 'table') {
        typeBoost = 1.05; // Slight boost for tables
      }

      const val = lambda * (c.s * typeBoost) - (1 - lambda) * diversity;
      if (val > bestVal) { bestVal = val; bestIdx = i; }
    }

    if (bestIdx === -1) break;
    const picked = candidates.splice(bestIdx, 1)[0];
    selected.push(picked);
    const key = headingKey(picked.v);
    usedBySection[key] = (usedBySection[key] || 0) + 1;
  }

  return selected;
}

async function retrieve(
  question: string,
  topK = 10,
  perSectionCap = 3,
  chatId?: string,
  fileIds?: string[],
  contentTypes?: Vec['sectionType'][]
) {
  const idx = await loadIndex();
  
  // CRITICAL FIX: Strict chatId filtering
  const pool = idx.vectors.filter(v => {
    // If chatId is specified, ONLY return vectors from that chat
    if (chatId) {
      if (v.chatId !== chatId) {
        return false;
      }
    }
    
    // If fileIds are specified, filter by those too
    if (fileIds && fileIds.length && !fileIds.includes(v.fileId)) {
      return false;
    }

    // If content types are specified, filter by those
    if (contentTypes && contentTypes.length && !contentTypes.includes(v.sectionType)) {
      return false;
    }
    
    return true;
  });

  console.log(`RAG retrieve: chatId="${chatId}", vectors found: ${pool.length}/${idx.vectors.length}`);
  
  if (!pool.length) {
    console.log("No vectors found for this chat");
    return [];
  }

  const qemb = await embed(question);
  const scored = pool.map(v => ({ v, s: cosine(qemb, v.embedding) }));
  const large = scored.sort((a, b) => b.s - a.s).slice(0, 80);
  const selected = mmrSelect(large, topK, 0.7, perSectionCap);
  return selected.map(s => s.v);
}

// Enhanced retrieveTopK with better parameter parsing
export async function retrieveTopK(
  query: string,
  fileIds?: string[] | number,
  kOrChatId?: number | string,
  maybeChatId?: string
) {
  let fileFilter: string[] | undefined;
  let k = 6;
  let chatId: string | undefined;

  // Better parameter parsing that preserves chatId
  if (Array.isArray(fileIds)) {
    fileFilter = fileIds;
    if (typeof kOrChatId === "number") {
      k = kOrChatId;
      if (typeof maybeChatId === "string") {
        chatId = maybeChatId;
      }
    } else if (typeof kOrChatId === "string") {
      chatId = kOrChatId;
    }
  } else if (typeof fileIds === "number") {
    k = fileIds;
    if (typeof kOrChatId === "string") {
      chatId = kOrChatId;
    }
  } else {
    // fileIds is undefined, check other params
    if (typeof kOrChatId === "number") {
      k = kOrChatId;
      if (typeof maybeChatId === "string") {
        chatId = maybeChatId;
      }
    } else if (typeof kOrChatId === "string") {
      chatId = kOrChatId;
    }
  }

  console.log(`RAG Query: chatId="${chatId}", k=${k}, fileFilter=${JSON.stringify(fileFilter)}`);

  const hits = await retrieve(query, k, 3, chatId, fileFilter);
  return hits.map(h => ({ text: h.text }));
}

// ──────────────────────────────────────────────────────────────
// Enhanced composition with structured context
// ──────────────────────────────────────────────────────────────
function packEnhancedContext(chunks: Vec[], question: string, budgetChars = 48000) {
  // Group by document and section type
  const grouped: Record<string, Record<string, string[]>> = {};
  const metadata: Record<string, { authors?: string[], title?: string }> = {};
  
  for (const v of chunks) {
    const docKey = v.name;
    const sectionKey = v.sectionType || 'content';
    const headingKey = (v.headingPath && v.headingPath.join(" / ")) || "ROOT";
    
    if (!grouped[docKey]) grouped[docKey] = {};
    if (!grouped[docKey][sectionKey]) grouped[docKey][sectionKey] = [];
    
    const contextText = v.pageNumber 
      ? `[Page ${v.pageNumber}] ${v.text}`
      : v.text;
    
    grouped[docKey][sectionKey].push(`### ${headingKey}\n${contextText}`);
    
    // Collect metadata
    if (v.authors && !metadata[docKey]?.authors) {
      metadata[docKey] = { ...metadata[docKey], authors: v.authors };
    }
  }

  const sections: string[] = [];
  let used = question.length + 2000; // headroom

  // Process each document
  for (const [docName, docSections] of Object.entries(grouped)) {
    const docMeta = metadata[docName];
    let docHeader = `## Document: ${docName}`;
    if (docMeta?.authors?.length) {
      docHeader += ` (Authors: ${docMeta.authors.join(', ')})`;
    }
    
    // Prioritize content types: metadata -> headings -> sections -> content -> tables
    const typeOrder: Vec['sectionType'][] = ['metadata', 'heading', 'subheading', 'section', 'subsection', 'text', 'table'];
    
    for (const sectionType of typeOrder) {
      if (docSections[sectionType]) {
        const sectionContent = docSections[sectionType].join('\n\n');
        const fullSection = `${docHeader}\n\n${sectionContent}`;
        
        if (used + fullSection.length <= budgetChars) {
          sections.push(fullSection);
          used += fullSection.length;
        } else {
          break;
        }
      }
    }
    
    if (used >= budgetChars) break;
  }

  return sections.join('\n\n');
}

// ──────────────────────────────────────────────────────────────
// Route handlers (preserve existing functionality)
// ──────────────────────────────────────────────────────────────

// return a PLAIN ARRAY for the legacy UI chip row
async function listSimpleHandler(req: FastifyRequest, reply: FastifyReply) {
  try {
    const q: any = (req as any).query || {};
    const chatId = typeof q.chatId === "string" ? q.chatId.trim() : undefined;

    const idx = await loadIndex();
    const files = (chatId ? idx.files.filter(f => f.chatId === chatId) : idx.files)
      .map(f => ({ id: f.id, name: f.name }));

    return reply.send(files);
  } catch {
    return reply.code(500).send([]);
  }
}

async function listRichHandler(req: FastifyRequest, reply: FastifyReply) {
  try {
    const q: any = (req as any).query || {};
    const chatId = typeof q.chatId === "string" ? q.chatId.trim() : undefined;

    const idx = await loadIndex();
    const files = chatId ? idx.files.filter(f => f.chatId === chatId) : idx.files;

    return reply.send({ ok: true, files });
  } catch (e: any) {
    return reply.code(500).send({ ok: false, error: String(e?.message || e) });
  }
}

async function deleteFileHandler(req: FastifyRequest, reply: FastifyReply) {
  try {
    const body = (req.body as any) || {};
    const fileId = typeof body.fileId === "string" ? body.fileId.trim() : "";
    if (!fileId) return reply.code(400).send({ ok: false, error: "fileId required" });

    const idx = await loadIndex();
    const meta = idx.files.find(f => f.id === fileId);
    if (!meta) return reply.code(404).send({ ok: false, error: "not found" });

    // remove vectors + meta
    idx.vectors = (idx.vectors || []).filter(v => v.fileId !== fileId);
    idx.files = (idx.files || []).filter(f => f.id !== fileId);

    // best-effort: delete stored file if we saved one
    if (meta.path) { 
      try { await fsp.unlink(meta.path); } catch {} 
    }

    await saveIndex(idx);
    return reply.send({ ok: true });
  } catch (e: any) {
    return reply.code(500).send({ ok: false, error: String(e?.message || e) });
  }
}

async function legacyUploadHandler(req: any, reply: FastifyReply) {
  const chatId = typeof req.query?.chatId === "string" ? req.query.chatId.trim() : undefined;
  const file = await req.file();
  if (!file) return reply.code(400).send({ ok: false, error: "No file uploaded" });

  const id = randomUUID();
  const safe = String(file.filename || "upload").replace(/[^\w.\-]+/g, "_");
  const dest = path.join(FILE_DIR, `${id}-${safe}`);

  await pipeline(file.file, fs.createWriteStream(dest));
  await indexFile(id, safe, dest, chatId);

  const stat = await fsp.stat(dest);
  return reply.send({
    ok: true,
    file: {
      id,
      name: safe,
      size: stat.size,
      pages: undefined,
      chatId
    }
  });
}

async function indexMultipartHandler(req: FastifyRequest, reply: FastifyReply) {
  const mp: any = await (req as any).file();
  if (!mp) return reply.code(400).send({ ok: false, error: "expected multipart 'file'" });
  const chatId = (mp.fields?.chatId?.value as string) || undefined;
  const fileName = mp.filename || `upload-${randomUUID()}.pdf`;

  const chunks: Buffer[] = [];
  for await (const part of mp.file) chunks.push(part as Buffer);
  const buf = Buffer.concat(chunks);

  try {
    const info = await indexPdfBuffer(buf, fileName, chatId);
    return reply.send({
      ok: true,
      file: {
        id: info.id,
        name: info.name,
        size: info.size ?? buf.length,
        pages: info.pages,
        chatId,
        authors: info.authors
      }
    });
  } catch (e: any) {
    return reply.code(500).send({ ok: false, error: String(e?.message || e) });
  }
}

async function askHandler(req: FastifyRequest, reply: FastifyReply) {
  const body = (req.body as any) || {};
  const { question, topK = 10, perSectionCap = 3, chatId, fileIds, contentTypes } = body;
  if (!question) return reply.code(400).send({ ok: false, error: "missing 'question'" });

  try {
    const hits = await retrieve(question, topK, perSectionCap, chatId, fileIds, contentTypes);
    return reply.send({
      ok: true,
      count: hits.length,
      chunks: hits.map(h => ({
        id: h.id, 
        fileId: h.fileId, 
        headingPath: h.headingPath, 
        text: h.text,
        sectionType: h.sectionType,
        authors: h.authors,
        pageNumber: h.pageNumber
      })),
    });
  } catch (e: any) {
    return reply.code(500).send({ ok: false, error: String(e?.message || e) });
  }
}

async function qaHandler(req: FastifyRequest, reply: FastifyReply) {
  const body = (req.body as any) || {};
  const { question, topK = 10, perSectionCap = 3, chatId, fileIds, contentTypes } = body;
  if (!question) return reply.code(400).send({ ok: false, error: "missing 'question'" });

  try {
    const hits = await retrieve(question, topK, perSectionCap, chatId, fileIds, contentTypes);
    const context = packEnhancedContext(hits, question);
    
    const system = `You are a precise assistant. Answer ONLY from the provided CONTEXT. 
    When citing information, use the format [Document: filename, Section: heading, Page: X] where available.
    Focus on providing exactly what the user asks for - nothing more, nothing less.
    If the context contains author information or metadata, include it when relevant.`;
    
    const user = `CONTEXT:\n${context}\n\nQUESTION:\n${question}\n\nAnswer the question precisely using only the provided context. Include relevant citations.`;

    const content = await chat([
      { role: "system", content: system }, 
      { role: "user", content: user }
    ]);
    
    return reply.send({
      ok: true,
      answer: content,
      citations: [...new Set(hits.map(h => (h.headingPath || ["ROOT"]).join(" / ")))],
      usedChunks: hits.length,
      sources: [...new Set(hits.map(h => h.name))],
      authors: [...new Set(hits.flatMap(h => h.authors || []))]
    });
  } catch (e: any) {
    return reply.code(500).send({ ok: false, error: String(e?.message || e) });
  }
}

async function clearHandler(_req: FastifyRequest, reply: FastifyReply) {
  try {
    await saveIndex({ files: [], vectors: [] });
    return reply.send({ ok: true });
  } catch (e: any) {
    return reply.code(500).send({ ok: false, error: String(e?.message || e) });
  }
}

// ──────────────────────────────────────────────────────────────
// Register routes (both /api/rag/* and /rag/*)
// ──────────────────────────────────────────────────────────────
export async function registerRagRoutes(app: FastifyInstance) {
  if (RAG_ROUTES_REGISTERED) {
    app.log?.warn?.("registerRagRoutes called more than once — skipping duplicate registration.");
    return;
  }
  RAG_ROUTES_REGISTERED = true;

  await ensure();

  // ── LIST (lets the UI show chips above the composer) ──────────────
  app.get("/api/rag/list", listRichHandler);   // { ok, files: [...] }
  app.get("/rag/list", listRichHandler);       // keep parity
  app.get("/rag/files", listSimpleHandler);    // ✅ plain array [{id,name}] for legacy UI chips

  // ── DELETE (legacy POST: what the ❌ button currently calls) ───────
  app.post("/rag/delete", deleteFileHandler);

  // ── DELETE (new RESTful style; safe to keep alongside) ────────────
  app.delete("/api/rag/file/:id", async (req, reply) => {
    (req as any).body = { fileId: (req.params as any).id };
    return deleteFileHandler(req, reply);
  });
  app.delete("/rag/file/:id", async (req, reply) => {
    (req as any).body = { fileId: (req.params as any).id };
    return deleteFileHandler(req, reply);
  });

  // ── UPLOAD (legacy stream-to-disk → index) ────────────────────────
  app.post("/rag/upload", legacyUploadHandler);

  // ── INDEX (multipart pdf buffer) ─────────────────────────────────
  app.post("/api/rag/index", indexMultipartHandler);
  app.post("/rag/index", indexMultipartHandler);

  // ── ASK (retrieve only) ──────────────────────────────────────────
  app.post("/api/rag/ask", askHandler);
  app.post("/rag/ask", askHandler);
  app.post("/rag/query", askHandler);

  // ── QA (retrieve + compose) ──────────────────────────────────────
  app.post("/api/rag/qa", qaHandler);
  app.post("/rag/qa", qaHandler);

  // ── CLEAR (wipe all files for a chat) ────────────────────────────
  app.post("/api/rag/clear", clearHandler);
  app.post("/rag/clear", clearHandler);

  // ── NEW ENHANCED ENDPOINTS ──────────────────────────────────────
  
  // Search by content type (headings, tables, etc.)
  app.post("/api/rag/search-by-type", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body as any) || {};
    const { question, contentTypes, topK = 10, chatId, fileIds } = body;
    if (!question) return reply.code(400).send({ ok: false, error: "missing 'question'" });
    if (!contentTypes || !Array.isArray(contentTypes)) {
      return reply.code(400).send({ ok: false, error: "missing or invalid 'contentTypes' array" });
    }

    try {
      const hits = await retrieve(question, topK, 3, chatId, fileIds, contentTypes);
      return reply.send({
        ok: true,
        count: hits.length,
        contentTypes,
        chunks: hits.map(h => ({
          id: h.id,
          fileId: h.fileId,
          headingPath: h.headingPath,
          text: h.text,
          sectionType: h.sectionType,
          authors: h.authors,
          pageNumber: h.pageNumber
        })),
      });
    } catch (e: any) {
      return reply.code(500).send({ ok: false, error: String(e?.message || e) });
    }
  });

  // Get document structure/outline
  app.get("/api/rag/document/:fileId/structure", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const fileId = (req.params as any).fileId;
      if (!fileId) return reply.code(400).send({ ok: false, error: "fileId required" });

      const idx = await loadIndex();
      const file = idx.files.find(f => f.id === fileId);
      if (!file) return reply.code(404).send({ ok: false, error: "file not found" });

      const vectors = idx.vectors.filter(v => v.fileId === fileId);
      
      // Group by section types and headings
      const structure = {
        file: {
          name: file.name,
          authors: file.authors || [],
          pages: file.pages,
          documentType: file.documentType
        },
        outline: vectors
          .filter(v => v.sectionType === 'heading' || v.sectionType === 'subheading')
          .map(v => ({
            headingPath: v.headingPath,
            sectionType: v.sectionType,
            pageNumber: v.pageNumber,
            preview: v.text.substring(0, 200) + (v.text.length > 200 ? '...' : '')
          })),
        sections: {
          headings: vectors.filter(v => v.sectionType === 'heading').length,
          subheadings: vectors.filter(v => v.sectionType === 'subheading').length,
          sections: vectors.filter(v => v.sectionType === 'section').length,
          subsections: vectors.filter(v => v.sectionType === 'subsection').length,
          tables: vectors.filter(v => v.sectionType === 'table').length,
          text: vectors.filter(v => v.sectionType === 'text').length,
          metadata: vectors.filter(v => v.sectionType === 'metadata').length
        }
      };

      return reply.send({ ok: true, structure });
    } catch (e: any) {
      return reply.code(500).send({ ok: false, error: String(e?.message || e) });
    }
  });

  // Get all authors from indexed documents
  app.get("/api/rag/authors", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const q: any = (req as any).query || {};
      const chatId = typeof q.chatId === "string" ? q.chatId.trim() : undefined;

      const idx = await loadIndex();
      const files = chatId ? idx.files.filter(f => f.chatId === chatId) : idx.files;
      
      const allAuthors = new Set<string>();
      files.forEach(f => {
        if (f.authors) {
          f.authors.forEach(author => allAuthors.add(author));
        }
      });

      return reply.send({ 
        ok: true, 
        authors: Array.from(allAuthors).sort(),
        count: allAuthors.size
      });
    } catch (e: any) {
      return reply.code(500).send({ ok: false, error: String(e?.message || e) });
    }
  });

  // Search by author
  app.post("/api/rag/search-by-author", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body as any) || {};
    const { question, authors, topK = 10, chatId } = body;
    if (!question) return reply.code(400).send({ ok: false, error: "missing 'question'" });
    if (!authors || !Array.isArray(authors)) {
      return reply.code(400).send({ ok: false, error: "missing or invalid 'authors' array" });
    }

    try {
      const idx = await loadIndex();
      
      // Filter vectors by authors
      const pool = idx.vectors.filter(v => {
        if (chatId && v.chatId !== chatId) return false;
        if (!v.authors || !v.authors.length) return false;
        return authors.some(author => 
          v.authors!.some(vAuthor => 
            vAuthor.toLowerCase().includes(author.toLowerCase()) ||
            author.toLowerCase().includes(vAuthor.toLowerCase())
          )
        );
      });

      if (!pool.length) {
        return reply.send({
          ok: true,
          count: 0,
          chunks: [],
          message: `No content found for authors: ${authors.join(', ')}`
        });
      }

      const qemb = await embed(question);
      const scored = pool.map(v => ({ v, s: cosine(qemb, v.embedding) }));
      const large = scored.sort((a, b) => b.s - a.s).slice(0, Math.min(topK, 50));
      const selected = mmrSelect(large, topK, 0.7, 3);
      const hits = selected.map(s => s.v);

      return reply.send({
        ok: true,
        count: hits.length,
        authors,
        chunks: hits.map(h => ({
          id: h.id,
          fileId: h.fileId,
          headingPath: h.headingPath,
          text: h.text,
          sectionType: h.sectionType,
          authors: h.authors,
          pageNumber: h.pageNumber
        })),
      });
    } catch (e: any) {
      return reply.code(500).send({ ok: false, error: String(e?.message || e) });
    }
  });

  // Enhanced statistics endpoint
  app.get("/api/rag/stats", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const q: any = (req as any).query || {};
      const chatId = typeof q.chatId === "string" ? q.chatId.trim() : undefined;

      const idx = await loadIndex();
      const files = chatId ? idx.files.filter(f => f.chatId === chatId) : idx.files;
      const vectors = chatId ? idx.vectors.filter(v => v.chatId === chatId) : idx.vectors;

      const documentTypes = files.reduce((acc, f) => {
        const type = f.documentType || 'other';
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const sectionTypes = vectors.reduce((acc, v) => {
        const type = v.sectionType || 'text';
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const totalPages = files.reduce((sum, f) => sum + (f.pages || 0), 0);
      const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0);
      const uniqueAuthors = new Set(files.flatMap(f => f.authors || [])).size;

      return reply.send({
        ok: true,
        stats: {
          files: files.length,
          vectors: vectors.length,
          totalPages,
          totalSize,
          uniqueAuthors,
          documentTypes,
          sectionTypes,
          avgVectorsPerFile: files.length ? Math.round(vectors.length / files.length) : 0
        }
      });
    } catch (e: any) {
      return reply.code(500).send({ ok: false, error: String(e?.message || e) });
    }
  });

  app.log?.info?.("Enhanced RAG routes registered successfully");
}