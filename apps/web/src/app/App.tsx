import { useState } from "react";
import ChatPane from "./routes/chat/components/ChatPane";

export default function App() {
  const [tab, setTab] = useState<"chat" | "rag">("chat");
  return (
    <div className="p-4">
      <h1 className="text-4xl font-black mb-2">Argon UI</h1>
      <div className="flex gap-2 mb-3">
        <button onClick={() => setTab("chat")}>Chat</button>
        <button onClick={() => setTab("rag")}>RAG</button>
      </div>
      <ChatPane activeTab={tab} onTab={setTab} />
    </div>
  );
}
