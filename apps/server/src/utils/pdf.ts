/* apps/server/src/utils/pdf.ts
 * Offline text extraction for PDFs (pdf-parse + PDF.js) and DOCX (mammoth).
 * - Handles multi-column pages and simple tables → Markdown
 * - Heuristic title/author detection from the first page
 * - Tunables at the top can be adjusted to improve accuracy on tricky docs
 */

import fs from "node:fs";

// ---------- Tunables (adjust if accuracy needs nudging) ----------
const LINE_MERGE_Y = 3.5;         // vertical tolerance to merge fragments into a line
const WORD_JOIN_X = 1.8;          // horizontal gap to join fragments into a word
const COLUMN_GAP_MIN = 70;        // large X-gap implies column boundary
const TABLE_GAP_MIN = 18;         // per-line X-gap implying a new table cell
const TABLE_MIN_ROWS = 3;         // min consecutive rows to treat as a table
const MAX_COLS = 3;               // up to this many columns supported
const PAGE_SEP = "\n\n";

export type ExtractResult = {
  ok: boolean;
  text: string;
  meta?: { title?: string; author?: string };
  warning?: string;
};

type TextItem = {
  str: string;
  transform: number[]; // [a b c d e f]
  width: number;
  height?: number;
  fontName?: string;
};

type Token = {
  s: string; x: number; y: number; w: number; h: number; f: string;
};

function makeTokens(items: TextItem[]): Token[] {
  const out: Token[] = [];
  for (const it of items) {
    const s = (it.str || "").replace(/\s+/g, " ").trim();
    if (!s) continue;
    const t = it.transform || [1, 0, 0, 1, 0, 0];
    const x = Number(t[4]) || 0;
    const y = Number(t[5]) || 0;
    const h = Math.abs(Number(it.height ?? t[3] ?? 0));
    out.push({ s, x, y, w: Number(it.width || 0), h, f: String(it.fontName || "") });
  }
  // PDF y increases upward → sort top→bottom (desc y), then left→right
  out.sort((a, b) => (b.y - a.y) || (a.x - b.x));
  return out;
}

function detectColumns(tokens: Token[], pageWidth: number): number[] {
  if (tokens.length < 20) return [0];
  const xs = [...new Set(tokens.map(t => Math.round(t.x)))].sort((a, b) => a - b);
  let biggestGap = 0;
  const gaps: { g: number; i: number }[] = [];
  for (let i = 1; i < xs.length; i++) {
    const g = xs[i] - xs[i - 1];
    gaps.push({ g, i });
    if (g > biggestGap) biggestGap = g;
  }
  if (biggestGap < COLUMN_GAP_MIN) return [0];

  const splits: number[] = [];
  gaps.sort((a, b) => b.g - a.g);
  for (let k = 0; k < Math.min(MAX_COLS - 1, gaps.length); k++) {
    if (gaps[k].g < COLUMN_GAP_MIN) break;
    const mid = Math.round((xs[gaps[k].i] + xs[gaps[k].i - 1]) / 2);
    splits.push(mid);
  }
  splits.sort((a, b) => a - b);
  return [0, ...splits];
}

function assignColumn(x: number, boundaries: number[]): number {
  let col = 0;
  for (let i = 1; i < boundaries.length; i++) if (x >= boundaries[i]) col = i;
  return col;
}

type Line = { y: number; parts: { x: number; s: string }[] };

function groupIntoLines(tokens: Token[]): Line[] {
  const lines: Line[] = [];
  for (const t of tokens) {
    let L = lines.find(l => Math.abs(l.y - t.y) <= LINE_MERGE_Y);
    if (!L) { L = { y: t.y, parts: [] }; lines.push(L); }
    L.parts.push({ x: t.x, s: t.s });
  }
  for (const L of lines) L.parts.sort((a, b) => a.x - b.x);
  for (const L of lines) {
    const merged: { x: number; s: string }[] = [];
    for (const p of L.parts) {
      if (!merged.length) { merged.push({ ...p }); continue; }
      const prev = merged[merged.length - 1];
      if (p.x - (prev.x + prev.s.length) <= WORD_JOIN_X) {
        prev.s = `${prev.s}${p.s.startsWith("'") ? "" : " "}${p.s}`.replace(/\s+/g, " ");
      } else {
        merged.push({ ...p });
      }
    }
    L.parts = merged;
  }
  lines.sort((a, b) => b.y - a.y);
  return lines;
}

function tryMarkdownTable(lines: Line[]): string | null {
  const rows: string[][] = [];
  for (const L of lines) {
    if (L.parts.length < 2) return null;
    const cells: string[] = [];
    let buf = L.parts[0].s;
    for (let i = 1; i < L.parts.length; i++) {
      const gap = L.parts[i].x - L.parts[i - 1].x;
      if (gap > TABLE_GAP_MIN) { cells.push(buf.trim()); buf = L.parts[i].s; }
      else buf += " " + L.parts[i].s;
    }
    cells.push(buf.trim());
    rows.push(cells);
  }
  if (rows.length < TABLE_MIN_ROWS) return null;
  const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  for (const r of rows) while (r.length < cols) r.push("");
  const md: string[] = [];
  md.push("| " + rows[0].join(" | ") + " |");
  md.push("| " + new Array(cols).fill("---").join(" | ") + " |");
  for (let i = 1; i < rows.length; i++) md.push("| " + rows[i].join(" | ") + " |");
  return md.join("\n");
}

function pageToText(tokens: Token[], pageWidth: number, meta?: { first?: boolean; title?: string; author?: string }): string {
  const boundaries = detectColumns(tokens, pageWidth);
  const cols: Token[][] = new Array(boundaries.length).fill(0).map(() => []);
  for (const t of tokens) cols[assignColumn(t.x, boundaries)].push(t);

  // first-page heuristics
  if (meta && meta.first) {
    const bySize = [...tokens].sort((a, b) => b.h - a.h);
    const top = bySize.slice(0, Math.min(20, bySize.length)).sort((a, b) => (b.h - a.h) || (b.y - a.y));
    const title = top.find(t => t.s.length > 6 && /^[A-Za-z0-9]/.test(t.s));
    if (title) meta.title = title.s.trim();
    const vicinityY = title ? title.y - 60 : undefined;
    const near = tokens
      .filter(t => t !== title && (vicinityY === undefined || Math.abs(t.y - vicinityY) < 100))
      .sort((a, b) => (b.h - a.h) || (b.y - a.y))
      .map(t => t.s.trim());
    const explicit = near.find(s => /\b(by|author|authors|prepared by|written by)\b/i.test(s));
    if (explicit) meta.author = explicit.replace(/\b(by|author|authors|prepared by|written by)[:\s]*/i, "").trim();
    else {
      const maybe = near.find(s => /^[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z.'-]+){0,4}$/.test(s));
      if (maybe) meta.author = maybe;
    }
    meta.first = false;
  }

  const parts: string[] = [];
  for (const col of cols) {
    if (!col.length) continue;
    const lines = groupIntoLines(col);
    let i = 0;
    while (i < lines.length) {
      const window: Line[] = [lines[i]];
      let j = i + 1;
      while (j < lines.length && (lines[j].parts.length >= 2 || window[window.length - 1].parts.length >= 2)) {
        window.push(lines[j]); j++;
      }
      const md = window.length >= TABLE_MIN_ROWS ? tryMarkdownTable(window) : null;
      if (md) { parts.push(md); i = j; }
      else {
        for (; i < j; i++) parts.push(lines[i].parts.map(p => p.s).join(" "));
      }
    }
  }
  return parts.join("\n");
}

export async function extractPdfSmart(filePath: string): Promise<ExtractResult> {
  const buf = fs.readFileSync(filePath);
  const { default: pdf } = await import("pdf-parse");

  const meta = { first: true, title: undefined as string | undefined, author: undefined as string | undefined };

  const data = await pdf(buf, {
    pagerender: async (pageData: any) => {
      const textContent = await pageData.getTextContent();
      const items: TextItem[] = textContent.items || [];
      const tokens = makeTokens(items);
      const view = pageData?.pageInfo?.view || [0, 0, 612, 792];
      const pageWidth = Math.abs(view[2] - view[0]) || 612;
      return pageToText(tokens, pageWidth, meta);
    },
    max: 0,
  });

  let text = (data?.text || "").trim();
  if (!text) {
    const data2 = await pdf(buf);
    text = (data2?.text || "").trim();
  }

  return { ok: true, text, meta: { title: meta.title, author: meta.author } };
}

export async function extractDocx(filePath: string): Promise<ExtractResult> {
  const mammothMod: any = await import("mammoth");
  const mammoth = mammothMod?.default || mammothMod;
  const res = await mammoth.convertToMarkdown({ path: filePath }, { convertImage: mammoth.images.none() });
  return { ok: true, text: (res.value || "").trim() };
}

export async function extractFromFile(filePath: string): Promise<ExtractResult> {
  const ext = filePath.toLowerCase().split(".").pop();
  if (ext === "pdf") return extractPdfSmart(filePath);
  if (ext === "docx") return extractDocx(filePath);
  return { ok: false, text: "", warning: "Unsupported file type" };
}
