import { useEffect, useRef } from "react";

/** Click-and-drag horizontal scrolling for a strip with its native scrollbar
 * hidden (see .no-scrollbar in index.css). Touch already scrolls natively,
 * so this only wires up mouse drags. A small movement threshold + swallowing
 * the trailing click keeps a drag from also firing a click on whatever
 * button sits under the cursor (e.g. a date tab) when the mouse is released. */
export function useDragScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let dragging = false;
    let moved = false;
    let startX = 0;
    let startScrollLeft = 0;

    function onMouseDown(e: MouseEvent) {
      dragging = true;
      moved = false;
      startX = e.clientX;
      startScrollLeft = el!.scrollLeft;
    }

    function onMouseMove(e: MouseEvent) {
      if (!dragging) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 3) {
        moved = true;
        el!.classList.add("dragging");
      }
      el!.scrollLeft = startScrollLeft - dx;
    }

    function onMouseUp() {
      if (!dragging) return;
      dragging = false;
      el!.classList.remove("dragging");
      if (moved) {
        const suppressClick = (ev: MouseEvent) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        window.addEventListener("click", suppressClick, { capture: true, once: true });
      }
    }

    el.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      el.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  return ref;
}
