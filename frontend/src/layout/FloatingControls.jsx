// IO controls pinned from IO Control float over every page. Each one is a
// small chip: drag it by its grip, and it stays where it was left (saved in
// the browser). The × unpins it.
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { GripVertical, X } from "lucide-react";
import { cx } from "../components/ui";
import { movePin, syncPins, unpinControl, useFloating } from "../store/floating";
import { useSequences, isOutput, isGpio } from "../pages/io/ioApi";
import { IoLiveControl } from "../pages/io/IoLiveControl";

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

function where(seq) {
  const out = isOutput(seq);
  const id = out ? seq.doId : seq.diId;
  const idLabel = String(id).toLowerCase() === "pi_p" ? "PI_P" : `${out ? "DO" : "DI"}${id ?? "?"}`;
  return isGpio(seq) ? `${seq.gpioId ?? "GPIO"} · ${idLabel}` : `Drv ${seq.driverId ?? "?"} · ${idLabel}`;
}

function FloatingChip({ pin, stale }) {
  const ref = useRef(null);
  const op = useRef(null);
  const seq = pin.seq;
  const out = isOutput(seq);

  const onDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    op.current = { x: e.clientX, y: e.clientY, px: pin.x, py: pin.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const place = (e) => {
    const o = op.current;
    const el = ref.current;
    if (!o || !el) return null;
    const x = clamp(o.px + e.clientX - o.x, 0, window.innerWidth - el.offsetWidth);
    const y = clamp(o.py + e.clientY - o.y, 0, window.innerHeight - el.offsetHeight);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    return { x, y };
  };
  const onMove = (e) => place(e);
  const onUp = (e) => {
    const p = place(e);
    op.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (p) movePin(pin.name, p.x, p.y);
  };

  const x = clamp(pin.x, 0, Math.max(0, window.innerWidth - 120));
  const y = clamp(pin.y, 0, Math.max(0, window.innerHeight - 40));

  return (
    <div ref={ref} className={cx("fio", out ? "is-out" : "is-in", stale && "is-stale")} style={{ left: x, top: y }}>
      <span
        className="fio-grip"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        title="Drag to move"
      >
        <GripVertical size={14} />
      </span>
      <span className="fio-text" title={`${seq.name} (${where(seq)})${stale ? "\nThis step is no longer in the IO list" : ""}`}>
        <span className="fio-name">{seq.name.replace(/\[(DO|DI)\]$/, "")}</span>
        <span className="fio-where">{where(seq)}</span>
      </span>
      <IoLiveControl seq={seq} compact />
      <button type="button" className="fio-close" onClick={() => unpinControl(pin.name)} aria-label={`Unpin ${seq.name}`} title="Unpin">
        <X size={12} />
      </button>
    </div>
  );
}

export function FloatingControls() {
  const pins = useFloating((s) => s.pins);
  const { data: sequences } = useSequences({ enabled: pins.length > 0 });

  useEffect(() => {
    if (Array.isArray(sequences)) syncPins(sequences);
  }, [sequences]);

  // Keep chips on screen when the window shrinks.
  useEffect(() => {
    if (!pins.length) return undefined;
    const onResize = () => {
      for (const p of useFloating.getState().pins) {
        const x = clamp(p.x, 0, Math.max(0, window.innerWidth - 120));
        const y = clamp(p.y, 0, Math.max(0, window.innerHeight - 40));
        if (x !== p.x || y !== p.y) movePin(p.name, x, y);
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [pins.length]);

  if (!pins.length) return null;
  const names = Array.isArray(sequences) ? new Set(sequences.map((s) => s.name)) : null;
  return createPortal(
    <div className="fio-layer">
      {pins.map((p) => (
        <FloatingChip key={p.name} pin={p} stale={names ? !names.has(p.name) : false} />
      ))}
    </div>,
    document.body
  );
}
