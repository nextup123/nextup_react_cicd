// A window that floats over the page: dragged anywhere by its header,
// resized from any edge or corner, maximised with a double click on the
// header (or the button). Kept inside the browser window; its spot and size
// are remembered per id (localStorage "nextup.win.<id>"). Used by the
// Diagnostics IO watch and black-box viewer.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GripVertical, Maximize2, Minimize2, X } from "lucide-react";
import { IconButton, cx } from "./index";
import "./floatingWindow.css";

const MARGIN = 6;
const EDGES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
let topZ = 930;

function readBox(id) {
  try {
    const b = JSON.parse(localStorage.getItem(`nextup.win.${id}`));
    if (b && [b.x, b.y, b.w, b.h].every(Number.isFinite)) return b;
  } catch {
    /* ignore */
  }
  return null;
}

function fit(b, minW, minH) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.max(minW, Math.min(b.w, vw - 2 * MARGIN));
  const h = Math.max(minH, Math.min(b.h, vh - 2 * MARGIN));
  return {
    w: Math.round(w),
    h: Math.round(h),
    x: Math.round(Math.min(Math.max(MARGIN, b.x), vw - w - MARGIN)),
    y: Math.round(Math.min(Math.max(MARGIN, b.y), vh - h - MARGIN)),
  };
}

/**
 * id        key for the remembered box
 * title     header text · icon a lucide icon · actions extra header buttons
 * size      default { w, h } (first open, centred unless `at` gives { x, y })
 * minSize   { w, h }
 */
export default function FloatingWindow({ id, title, subtitle, icon: Icon, actions, size = { w: 900, h: 600 }, at, minSize = { w: 420, h: 280 }, onClose, children, className, bodyClassName }) {
  const [box, setBox] = useState(() => readBox(id));
  const [max, setMax] = useState(false);
  const [z, setZ] = useState(() => ++topZ);
  const ref = useRef(null);
  const act = useRef(null);

  useLayoutEffect(() => {
    setBox((b) => fit(b || { w: size.w, h: size.h, x: at?.x ?? (window.innerWidth - size.w) / 2, y: at?.y ?? Math.max(70, (window.innerHeight - size.h) / 2) }, minSize.w, minSize.h));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const onResize = () => setBox((b) => (b ? fit(b, minSize.w, minSize.h) : b));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [minSize.w, minSize.h]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !document.querySelector(".overlay") && ref.current?.contains(document.activeElement)) onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = useCallback(
    (b) => {
      try {
        localStorage.setItem(`nextup.win.${id}`, JSON.stringify(b));
      } catch {
        /* ignore */
      }
    },
    [id]
  );

  const front = () => setZ((cur) => (cur === topZ ? cur : ++topZ));

  const start = (e, mode) => {
    if (e.button !== 0 || max) return;
    if (mode === "move" && e.target.closest("button, input, select, a")) return;
    act.current = { mode, sx: e.clientX, sy: e.clientY, b: { ...box } };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const move = (e) => {
    const a = act.current;
    if (!a) return;
    const dx = e.clientX - a.sx;
    const dy = e.clientY - a.sy;
    let { x, y, w, h } = a.b;
    if (a.mode === "move") {
      x += dx;
      y += dy;
    } else {
      if (a.mode.includes("e")) w += dx;
      if (a.mode.includes("s")) h += dy;
      if (a.mode.includes("w")) {
        const nw = Math.max(minSize.w, w - dx);
        x += w - nw;
        w = nw;
      }
      if (a.mode.includes("n")) {
        const nh = Math.max(minSize.h, h - dy);
        y += h - nh;
        h = nh;
      }
    }
    setBox(fit({ x, y, w, h }, minSize.w, minSize.h));
  };
  const end = (e) => {
    if (!act.current) return;
    act.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setBox((b) => {
      save(b);
      return b;
    });
  };

  if (!box) return null;
  const style = max ? { zIndex: z, left: MARGIN, top: MARGIN, width: `calc(100vw - ${2 * MARGIN}px)`, height: `calc(100vh - ${2 * MARGIN}px)` } : { zIndex: z, left: box.x, top: box.y, width: box.w, height: box.h };

  return createPortal(
    <section ref={ref} className={cx("fwin", max && "is-max", className)} style={style} onPointerDownCapture={front} role="dialog" aria-label={typeof title === "string" ? title : undefined}>
      <header className="fwin-head" onPointerDown={(e) => start(e, "move")} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onDoubleClick={(e) => !e.target.closest("button, input, select") && setMax((m) => !m)}>
        <GripVertical size={14} className="fwin-grip" />
        {Icon && <Icon size={16} className="fwin-icon" />}
        <div className="fwin-titles">
          <span className="fwin-title">{title}</span>
          {subtitle && <span className="fwin-sub">{subtitle}</span>}
        </div>
        <div className="fwin-actions">
          {actions}
          <IconButton size="sm" icon={max ? Minimize2 : Maximize2} label={max ? "Restore size" : "Fill the window"} onClick={() => setMax((m) => !m)} />
          <IconButton size="sm" icon={X} label="Close" onClick={onClose} />
        </div>
      </header>
      <div className={cx("fwin-body", bodyClassName)}>{children}</div>
      {!max &&
        EDGES.map((d) => (
          <span key={d} className={`fwin-edge fwin-${d}`} onPointerDown={(e) => start(e, d)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
        ))}
    </section>,
    document.body
  );
}
