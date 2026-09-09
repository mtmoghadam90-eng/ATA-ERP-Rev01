import { useRef } from 'react';

/**
 * The grip on a column's edge, in a right-to-left table.
 *
 * The whole of the risk here is the **direction**, and it is why this is its
 * own component with its own render test rather than a few lines inside the
 * grid. This application is RTL throughout: the first column sits at the right,
 * so a column's *start* edge is its right one and the divider a person grabs is
 * on its **left**. Dragging that divider leftwards makes the column wider.
 *
 * A delta of `clientX - startX` therefore has to be **negated**, and a sign
 * written the wrong way round is invisible to a type-checker, to the pure rules
 * and to anybody reading it — the columns simply resize the wrong way. So the
 * width is not computed from a sign at all: it is measured from the edge that
 * does **not** move. `right - clientX` *is* the new width, in any direction,
 * and there is nothing to get backwards.
 *
 * The pointer is captured, so a drag that leaves the four-pixel strip — which
 * every drag does — keeps reporting.
 */
export default function ColumnResizeHandle({
  onResize,
  onDone,
  title,
}: {
  /** The column's new width in pixels, as the pointer moves. */
  onResize: (widthPx: number) => void;
  /** The drag ended; the screen stores what it has. */
  onDone: () => void;
  title?: string;
}) {
  const dragging = useRef(false);

  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    const cell = e.currentTarget.closest('th') as HTMLElement | null;
    if (!cell) return;

    /*
      The edge the drag does not move. In RTL that is the right one, and
      measuring from it means the arithmetic never depends on which way the
      pointer went.
    */
    const anchorRight = cell.getBoundingClientRect().right;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    // Or the browser selects the header text across the whole row instead.
    e.preventDefault();

    const move = (ev: PointerEvent) => {
      if (!dragging.current) return;
      onResize(anchorRight - ev.clientX);
    };
    const end = () => {
      if (!dragging.current) return;
      dragging.current = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      onDone();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title={title ?? 'برای تغییر عرض ستون بکشید'}
      onPointerDown={start}
      data-column-resizer
      /*
        Wider than it looks: the visible hairline is 1px and the grab area is
        the whole strip, because a one-pixel target is one nobody can hit.
      */
      className="absolute inset-y-0 left-0 w-2 -ml-1 cursor-col-resize touch-none z-10
        flex justify-center group"
    >
      <span className="w-px h-full bg-transparent group-hover:bg-sky-400 transition" />
    </div>
  );
}
