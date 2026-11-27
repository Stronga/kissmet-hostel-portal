import { useEffect, useRef, type RefObject } from "react";

const CANDIDATES = "a[href], button, textarea, input, select, [tabindex]";

function focusable(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(CANDIDATES)).filter((element) => {
    if (element.getAttribute("tabindex") === "-1") return false;
    if (element.getAttribute("aria-hidden") === "true") return false;
    if ((element as HTMLButtonElement).disabled) return false;
    if (element.closest("[hidden]")) return false;
    return true;
  });
}

/** Traps Tab inside the dialog, closes on Escape, and restores focus to the opener. */
export function useDialogBehavior(open: boolean, onClose: () => void, containerRef: RefObject<HTMLElement | null>) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const node = containerRef.current;
    if (!node) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const preferred = node.querySelector<HTMLElement>("[data-autofocus]");
    const initial = preferred ?? focusable(node)[0] ?? node;
    initial.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !node) return;
      const items = focusable(node);
      if (!items.length) {
        event.preventDefault();
        node.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !node.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, [open, containerRef]);
}
