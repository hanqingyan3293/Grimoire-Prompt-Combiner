import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Renders a hover-triggered floating preview card anchored near a trigger element.
 * The preview opens after delayHoverMs and hides when the mouse leaves the preview.
 */
export function HoverPreview({
    delayHoverMs = 500,
    previewClassName = "",
    previewContent,
    children,
}: {
    delayHoverMs?: number;
    previewClassName?: string;
    previewContent: ReactNode;
    children: ReactNode;
}) {
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const triggerRef = useRef<HTMLDivElement>(null);

    useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

    const computePosition = () => {
        const trigger = triggerRef.current;
        if (!trigger) return;
        const rect = trigger.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const width = 360;
        let left = rect.right + 12;
        if (left + width > viewportWidth - 8) left = Math.max(8, rect.left - width - 12);
        if (left < 8) left = Math.min(8, Math.max(8, viewportWidth - width - 8));
        setPosition({ top: Math.max(8, rect.top), left });
    };

    const startTimer = () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => { computePosition(); setOpen(true); }, delayHoverMs);
    };
    const cancelTimer = () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        setOpen(false);
    };

    return (
        <>
            <div
                ref={triggerRef}
                onMouseEnter={startTimer}
                onMouseLeave={(event) => { if (!event.relatedTarget || !(event.relatedTarget as HTMLElement).closest?.("[data-hover-preview]")) cancelTimer(); }}
            >
                {children}
            </div>
            {open && position ? createPortal(
                <div
                    data-hover-preview
                    onMouseLeave={() => setOpen(false)}
                    className={`pointer-events-auto fixed z-[9999] w-[360px] max-h-[min(520px,calc(100vh-16px))] overflow-auto rounded-lg border border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-stone-900 ${previewClassName}`}
                    style={{ top: position.top, left: position.left }}
                >
                    {previewContent}
    </div>, document.body
            ) : null}
        </>
    );
}
