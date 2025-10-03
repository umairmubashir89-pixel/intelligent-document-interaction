import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import mammoth from "mammoth";

const OLLAMA = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const DATA = path.resolve(process.cwd(), "data", "rag");
const FILES = path.join(DATA, "files");
const INDEX = path.join(DATA, "index.json");
const EMBED_MODEL = process.env.EMBED_MODEL || "nomic-embed-text:latest";

type Vec = {
  id: string;
  fileId: string;
  chatId?: string;
  name: string;
  text: string;
  embedding: number[];
};

type FileMeta = {
  id: string;
  chatId?: string;
  name: string;
  path: string;
  size: number;
  uploadedAt: string;
};

async function ensure() {
  await fsp.mkdir(FILES, { recursive: true });
  if (!fs.existsSync(INDEX)) {
    const init = { files: [] as FileMeta[], vectors: [] as Vec[] };
    await fsp.writeFile(INDEX, JSON.stringify(init, null, 2));
  }
}

async function extractPdf(buf: Buffer) {
  // lightweight built-in PDF extraction path omitted here for brevity
  // you already had an implementation; keep it as-is
  // (leave your existing extractPdf code here)
  const pdftxt = buf.toString("binary"); // fallback placeholder if you don’t have pdf-parse
  return pdftxt;
}

async function extractDocx(buf: Buffer) {
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return value || "";
}

function chunk(s: string, size = 1400, overlap = 250) {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    out.push(s.slice(i, i + size));
    i += size - overlap;
  }
  return out.filter(Boolean);
}

async function embed(text: string): Promise<number[]> {
  const r = await fetch(`${OLLAMA}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!r.ok) throw new Error(`/api/embeddings ${r.status}`);
  const j: any = await r.json();
  const v = j?.embeddings?.[0] || j?.embedding || j?.data?.[0]?.embedding;
  if (!Array.isArray(v)) throw new Error("No embedding vector returned");
  return v as number[];
}

function cosine(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

export async function indexFile(id: string, name: string, p: string, chatId?: string) {
  await ensure();
  const buf = await fsp.readFile(p);
  let text = "";
  const lower = name.toLowerCase();

  if (lower.endsWith(".pdf"))        text = await extractPdf(buf);
  else if (lower.endsWith(".docx"))  text = await extractDocx(buf);
  else if (lower.endsWith(".txt") || lower.endsWith(".md")) text = buf.toString("utf8");
  else text = name; // very small fallback

  const blocks = chunk(text, 1400, 250);
  const idx = JSON.parse(await fsp.readFile(INDEX, "utf-8")) as { files: FileMeta[]; vectors: Vec[] };

  const vectors: Vec[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const emb = await embed(blocks[i]);
    vectors.push({ id: `${id}_${i}`, fileId: id, chatId, name, text: blocks[i], embedding: emb });
  }

  idx.files = idx.files || [];
  if (!idx.files.find(f => f.id === id)) {
    idx.files.push({ id, chatId, name, path: p, size: buf.length, uploadedAt: new Date().toISOString() });
  }
  idx.vectors = (idx.vectors || []).concat(vectors);

  await fsp.writeFile(INDEX, JSON.stringify(idx, null, 2));
}

export async function searchRelevant(query: string, fileIds?: string[] | null, k = 6, chatId?: string) {
  await ensure();
  const idx = JSON.parse(await fsp.readFile(INDEX, "utf-8")) as { files: FileMeta[]; vectors: Vec[] };

  let pool: Vec[] = [];
  if (fileIds && fileIds.length) {
    const set = new Set(fileIds);
    pool = (idx.vectors || []).filter(v => set.has(v.fileId));
  } else if (chatId) {
    pool = (idx.vectors || []).filter(v => v.chatId === chatId);
  } else {
    // ⟵ IMPORTANT: no global fallback
    return [];
  }

  if (!pool.length) return [];
  const qv = await embed(query);

  return pool
    .map(v => ({ v, s: cosine(qv, v.embedding) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, Math.min(k, pool.length))
    .map(x => x.v.text);
}

export async function listFiles(chatId?: string) {
  await ensure();
  const idx = JSON.parse(await fsp.readFile(INDEX, "utf-8")) as { files: FileMeta[]; vectors: Vec[] };
  if (!chatId) return idx.files || [];
  return (idx.files || []).filter(f => f.chatId === chatId);
}

export async function deleteByFileId(fileId: string) {
  await ensure();
  const idx = JSON.parse(await fsp.readFile(INDEX, "utf-8")) as { files: FileMeta[]; vectors: Vec[] };
  idx.files = (idx.files || []).filter(f => f.id !== fileId);
  idx.vectors = (idx.vectors || []).filter(v => v.fileId !== fileId);
  await fsp.writeFile(INDEX, JSON.stringify(idx, null, 2));
}

export async function clearByChatId(chatId: string) {
  await ensure();
  const idx = JSON.parse(await fsp.readFile(INDEX, "utf-8")) as { files: FileMeta[]; vectors: Vec[] };
  const fileIds = new Set((idx.files || []).filter(f => f.chatId === chatId).map(f => f.id));
  idx.files = (idx.files || []).filter(f => f.chatId !== chatId);
  idx.vectors = (idx.vectors || []).filter(v => !fileIds.has(v.fileId));
  await fsp.writeFile(INDEX, JSON.stringify(idx, null, 2));
}
