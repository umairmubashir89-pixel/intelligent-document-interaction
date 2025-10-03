export async function* ndjsonStream(res: Response) {
  if (!res.body) throw new Error("No response body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const s = line.trim();
      if (!s) continue;
      let obj: any = s;
      try { obj = JSON.parse(s); } catch { /* accept plain text */ }
      yield obj;
    }
  }
  if (buf.trim()) {
    try { yield JSON.parse(buf.trim()); } catch { yield buf.trim(); }
  }
}
