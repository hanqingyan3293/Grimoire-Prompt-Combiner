import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export function FloatingPreview({ open, title, onClose, children, footer }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const [rect, setRect] = useState({ left: 120, top: 80, width: 720, height: 560 });
  const dragRef = useRef<{ x: number; y: number; rect: typeof rect } | null>(null);
  const resizeRef = useRef<{ edge: ResizeEdge; x: number; y: number; rect: typeof rect } | null>(null);
  useEffect(() => {
    if (!open) return;
    const move = (event: PointerEvent) => {
      if (dragRef.current) {
        const d = dragRef.current;
        setRect({ ...d.rect, left: Math.max(8, d.rect.left + event.clientX - d.x), top: Math.max(8, d.rect.top + event.clientY - d.y) });
      } else if (resizeRef.current) {
        const r = resizeRef.current; const dx = event.clientX - r.x; const dy = event.clientY - r.y; const minW = 320; const minH = 220;
        let { left, top, width, height } = r.rect;
        if (r.edge.includes("e")) width = Math.max(minW, r.rect.width + dx);
        if (r.edge.includes("s")) height = Math.max(minH, r.rect.height + dy);
        if (r.edge.includes("w")) { width = Math.max(minW, r.rect.width - dx); left = r.rect.left + r.rect.width - width; }
        if (r.edge.includes("n")) { height = Math.max(minH, r.rect.height - dy); top = r.rect.top + r.rect.height - height; }
        setRect({ left: Math.max(8, left), top: Math.max(8, top), width, height });
      }
    };
    const up = () => { dragRef.current = null; resizeRef.current = null; document.body.style.userSelect = ""; };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
  }, [open]);
  if (!open) return null;
  const startDrag = (event: React.PointerEvent) => { event.preventDefault(); dragRef.current = { x: event.clientX, y: event.clientY, rect }; document.body.style.userSelect = "none"; };
  const startResize = (edge: ResizeEdge, event: React.PointerEvent) => { event.preventDefault(); event.stopPropagation(); resizeRef.current = { edge, x: event.clientX, y: event.clientY, rect }; document.body.style.userSelect = "none"; };
  return <div className="fixed inset-0 z-[1200] bg-black/45 backdrop-blur-[2px]" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="absolute flex flex-col overflow-visible rounded-2xl border-2 border-stone-400 bg-[var(--color-bg-primary)] shadow-[0_24px_80px_rgba(0,0,0,.42)] dark:border-stone-600" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>
      <header onPointerDown={startDrag} className="flex h-12 shrink-0 cursor-move items-center justify-between border-b-2 border-[var(--color-border-strong)] bg-[var(--color-bg-secondary)] px-4 font-semibold">
        <span className="truncate">{title}</span><button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={onClose} className="grid size-8 place-items-center rounded-lg hover:bg-black/10 dark:hover:bg-white/10"><X size={18} /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
      {footer ? <footer className="shrink-0 border-t-2 border-[var(--color-border-strong)] bg-[var(--color-bg-secondary)] p-3">{footer}</footer> : null}
      {(["n","s","e","w","ne","nw","se","sw"] as ResizeEdge[]).map(edge => <span key={edge} onPointerDown={event => startResize(edge, event)} className={`absolute z-10 ${edge.includes("n") ? "top-[-5px]" : edge.includes("s") ? "bottom-[-5px]" : "top-2 bottom-2"} ${edge.includes("e") ? "right-[-5px]" : edge.includes("w") ? "left-[-5px]" : "left-2 right-2"} ${edge.length === 2 ? "size-4" : edge === "n" || edge === "s" ? "h-3" : "w-3"} cursor-${edge}-resize`} />)}
    </section>
  </div>;
}
