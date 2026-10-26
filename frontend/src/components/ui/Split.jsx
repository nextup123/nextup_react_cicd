// Resizable panes. Drag the handle between two panes to resize them,
// double-click it to go back to the default sizes. Sizes are kept under
// "nextup.split.<id>" in localStorage, which the app mirrors to the robot
// server (see lib/uiPrefs.js), so they come back the same in any browser.
import { Children, useCallback, useEffect, useRef, useState } from "react";
import { cx } from "./index";

const KEY = (id) => `nextup.split.${id}`;

function readSizes(id, defaults) {
  try {
    const v = JSON.parse(localStorage.getItem(KEY(id)));
    if (Array.isArray(v) && v.length === defaults.length && v.every((n) => typeof n === "number" && n > 0)) return v;
  } catch {
    /* ignore */
  }
  return defaults;
}

/** Shared sizes for one split id (also used to size panes outside a <Split>). */
export function useSplitSizes(id, defaults) {
  const [sizes, setSizes] = useState(() => readSizes(id, defaults));
  const save = useCallback(
    (v) => {
      try {
        if (v === defaults) localStorage.removeItem(KEY(id));
        else localStorage.setItem(KEY(id), JSON.stringify(v.map((n) => Math.round(n * 1000) / 1000)));
      } catch {
        /* ignore */
      }
    },
    [id, defaults]
  );
  return [sizes, setSizes, save];
}

/**
 * <Split id="io.columns" defaults={[2, 3]} min={260}>{paneA}{paneB}</Split>
 * direction "row" puts panes side by side, "column" stacks them (the Split
 * then needs a bounded height from its parent). `min` is the smallest pane
 * size in px (a number, or one per pane).
 */
export function Split({ id, defaults, direction = "row", min = 200, gap = 12, className, style, children }) {
  const panes = Children.toArray(children).filter(Boolean);
  const defs = defaults && defaults.length === panes.length ? defaults : panes.map(() => 1);
  const [sizes, setSizes, save] = useSplitSizes(id, defs);
  const ref = useRef(null);
  const op = useRef(null);
  const row = direction === "row";
  const mins = panes.map((_, i) => (Array.isArray(min) ? min[i] ?? 0 : min));
  const cur = sizes.length === panes.length ? sizes : defs;
  // A pane was added or removed (e.g. a side panel opened): use the sizes
  // saved for that number of panes.
  const count = panes.length;
  useEffect(() => {
    if (sizes.length !== count) setSizes(readSizes(id, defs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  const onDown = (i) => (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const box = ref.current.getBoundingClientRect();
    const total = (row ? box.width : box.height) - gap * (panes.length - 1);
    const sum = cur.reduce((a, b) => a + b, 0);
    op.current = { i, start: row ? e.clientX : e.clientY, px: cur.map((s) => (s / sum) * total), total, sizes: cur };
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.classList.add(row ? "is-resizing-x" : "is-resizing-y");
  };
  const onMove = (e) => {
    const o = op.current;
    if (!o) return;
    const d = (row ? e.clientX : e.clientY) - o.start;
    const px = [...o.px];
    const pair = px[o.i] + px[o.i + 1];
    let a = Math.max(mins[o.i], Math.min(pair - mins[o.i + 1], px[o.i] + d));
    if (pair < mins[o.i] + mins[o.i + 1]) a = pair / 2;
    px[o.i] = a;
    px[o.i + 1] = pair - a;
    setSizes(px.map((p) => (p / o.total) * 10));
  };
  const onUp = (e) => {
    if (!op.current) return;
    op.current = null;
    document.body.classList.remove("is-resizing-x", "is-resizing-y");
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    setSizes((s) => {
      save(s);
      return s;
    });
  };
  const reset = () => {
    setSizes(defs);
    save(defs);
  };

  const template = cur.map((s, i) => `minmax(${mins[i]}px, ${s}fr)`).join(` ${gap}px `);
  const items = [];
  panes.forEach((p, i) => {
    items.push(
      <div key={p.key ?? `p${i}`} className="split-pane">
        {p}
      </div>
    );
    if (i < panes.length - 1)
      items.push(
        <div
          key={`h-${p.key ?? i}`}
          className="split-handle"
          role="separator"
          aria-orientation={row ? "vertical" : "horizontal"}
          title="Drag to resize · double-click to reset"
          onPointerDown={onDown(i)}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onDoubleClick={reset}
        />
      );
  });
  return (
    <div ref={ref} className={cx("split", row ? "is-row" : "is-col", className)} style={{ ...style, [row ? "gridTemplateColumns" : "gridTemplateRows"]: template }}>
      {items}
    </div>
  );
}
