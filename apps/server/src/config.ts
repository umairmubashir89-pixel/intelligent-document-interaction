// apps/server/src/config.ts
const toNumber = (v: string | undefined, d: number) => {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : d;
};

export const PORT = toNumber(process.env.PORT, 8787);

export const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
export const OLLAMA = OLLAMA_URL;

