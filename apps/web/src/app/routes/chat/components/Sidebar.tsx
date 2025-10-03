import React from "react";

export default function Sidebar(props: { collapsed: boolean; setCollapsed: (v: boolean) => void }) {
  return (
    <aside className={`${props.collapsed ? "w-[64px]" : "w-[260px]"} transition-all border-r border-zinc-800 h-full overflow-hidden`}>
      <div className="h-14 flex items-center justify-between px-3">
        <div className="text-lg tracking-wider">{props.collapsed ? "A" : "ARGON"}</div>
        <button
          className="h-8 w-8 rounded-lg bg-zinc-800 hover:bg-zinc-700 grid place-items-center"
          onClick={() => props.setCollapsed(!props.collapsed)}
          title={props.collapsed ? "Expand" : "Collapse"}
        >{props.collapsed ? "»" : "«"}</button>
      </div>

      <div className="px-3">
        <button className="w-full h-10 rounded-xl bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center gap-2">
          <span>＋</span> {!props.collapsed && <span>New</span>}
        </button>
      </div>

      {/* chats list placeholder (dots in collapsed view) */}
      <div className="mt-4 px-3 space-y-2 overflow-auto h-[calc(100%-100px)]">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={`h-9 rounded-lg ${props.collapsed ? "w-9 bg-zinc-800" : "bg-zinc-900 border border-zinc-800"}`} />
        ))}
      </div>
    </aside>
  );
}
