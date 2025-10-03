import { useEffect, useState } from "react";

export default function Ping() {
  const [server, setServer] = useState<"pending" | "ok" | "fail">("pending");

  useEffect(() => {
    fetch(`/health`)
      .then((r) => setServer(r.ok ? "ok" : "fail"))
      .catch(() => setServer("fail"));
  }, []);

  return (
    <div className="mb-3 flex items-center gap-2 text-xs">
      <span className="opacity-70">Server:</span>
      {server === "pending" && (
        <span className="rounded px-2 py-0.5 bg-gray-200 dark:bg-gray-800">checking…</span>
      )}
      {server === "ok" && (
        <span className="rounded px-2 py-0.5 bg-green-200 text-green-900 dark:bg-green-900 dark:text-green-200">OK</span>
      )}
      {server === "fail" && (
        <span className="rounded px-2 py-0.5 bg-red-200 text-red-900 dark:bg-red-900 dark:text-red-200">UNREACHABLE</span>
      )}
    </div>
  );
}
