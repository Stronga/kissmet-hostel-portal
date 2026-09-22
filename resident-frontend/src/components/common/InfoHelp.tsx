import { CircleHelp } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

interface InfoHelpProps {
  /** Accessible name, e.g. "About application status" */
  label: string;
  children: ReactNode;
}

type PanelPos = { top: number; left: number; width: number };

/**
 * Contextual help control (?). Click/tap/keyboard open; Escape and outside click close.
 * Desktop hover is optional and does not replace click/tap.
 */
export function InfoHelp({ label, children }: InfoHelpProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PanelPos | null>(null);
  const id = useId();
  const panelId = `${id}-panel`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const hoverCapable = useRef(false);

  useEffect(() => {
    hoverCapable.current = Boolean(
      typeof window.matchMedia === "function" &&
        window.matchMedia("(hover: hover) and (pointer: fine)").matches
    );
  }, []);

  const placePanel = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const width = Math.min(288, Math.max(200, window.innerWidth - 32));
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(16, Math.min(left, window.innerWidth - width - 16));
    let top = rect.bottom + 8;
    const estimatedHeight = 140;
    if (top + estimatedHeight > window.innerHeight - 16) {
      top = Math.max(16, rect.top - estimatedHeight - 8);
    }
    setPos({ top, left, width });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    placePanel();
    const onResize = () => placePanel();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [open, placePanel]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    function onPointer(event: MouseEvent | TouchEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
    };
  }, [open]);

  return (
    <span className="relative inline-flex shrink-0 align-middle">
      <button
        ref={buttonRef}
        type="button"
        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-text-secondary transition hover:bg-muted hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        onMouseEnter={() => {
          if (hoverCapable.current) setOpen(true);
        }}
        onFocus={() => {
          if (hoverCapable.current) setOpen(true);
        }}
      >
        <CircleHelp size={15} strokeWidth={2.25} aria-hidden="true" />
      </button>
      {open && pos ? (
        <div
          ref={panelRef}
          id={panelId}
          role="tooltip"
          className="fixed z-40 rounded-xl border border-[#eaeff2] bg-white p-3 text-left text-[13px] leading-snug text-text-secondary shadow-[0_8px_24px_rgba(20,35,40,0.12)]"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
          onMouseLeave={() => {
            if (hoverCapable.current) setOpen(false);
          }}
        >
          {children}
        </div>
      ) : null}
    </span>
  );
}
