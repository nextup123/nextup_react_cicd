// Point dropdown with search: lists the taught points of points.yaml, marks
// the ones the motion server cannot use (no joint values) and keeps a typed
// name that is not taught yet (shown in red; the check lists it too).
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, ChevronDown, MapPin, Plus, X } from "lucide-react";
import { cx } from "../../components/ui";

function useAnchorRect(open, ref) {
  const [rect, setRect] = useState(null);
  useEffect(() => {
    if (!open) return;
    const upd = () => ref.current && setRect(ref.current.getBoundingClientRect());
    upd();
    window.addEventListener("resize", upd);
    window.addEventListener("scroll", upd, true);
    return () => {
      window.removeEventListener("resize", upd);
      window.removeEventListener("scroll", upd, true);
    };
  }, [open, ref]);
  return rect;
}

/**
 * points: [{ name, hasJoints, isTf, nature }]
 * value: name | ""; onChange(name)
 */
export function PointPicker({ value, onChange, points, placeholder = "Choose a point…", invalid, size = "sm", autoFocus, onlyFrames, clearable, id }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const wrap = useRef(null);
  const input = useRef(null);
  const listRef = useRef(null);
  const rect = useAnchorRect(open, wrap);
  const known = points.find((p) => p.name === value);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = onlyFrames ? points.filter((p) => p.isTf) : points;
    const hits = s ? base.filter((p) => p.name.toLowerCase().includes(s)) : base;
    // usable points first, keep the file order otherwise
    return [...hits].sort((a, b) => Number(b.hasJoints || onlyFrames) - Number(a.hasJoints || onlyFrames));
  }, [points, q, onlyFrames]);
  const typedNew = q.trim() && !points.some((p) => p.name === q.trim()) && /^[A-Za-z0-9_-]+$/.test(q.trim());

  useEffect(() => {
    if (!open) return;
    const close = (e) => !wrap.current?.contains(e.target) && !listRef.current?.contains(e.target) && setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  useEffect(() => setHi(0), [q, open]);

  const pick = (name) => {
    onChange(name);
    setOpen(false);
    setQ("");
  };
  const onKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHi((h) => Math.min(h + 1, list.length - 1 + (typedNew ? 1 : 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!open) return setOpen(true);
      if (hi < list.length) pick(list[hi].name);
      else if (typedNew) pick(q.trim());
    } else if (e.key === "Escape") {
      setOpen(false);
      setQ("");
    }
  };

  const status = !value ? null : !known ? "missing" : onlyFrames ? (known.isTf ? null : "noframe") : known.hasJoints ? null : "nojoints";
  return (
    <div ref={wrap} data-tut="mp-picker" className={cx("mp-picker", size === "sm" && "is-sm", open && "is-open", (invalid || status) && "is-invalid")}>
      <MapPin size={13} className="mp-picker-icon" />
      <input
        ref={input}
        id={id}
        className="mp-picker-input"
        value={open ? q : value}
        placeholder={open ? value || "Search points…" : placeholder}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKey}
        autoFocus={autoFocus}
        spellCheck={false}
        autoComplete="off"
      />
      {status && !open && <span className={cx("mp-picker-flag", status === "missing" && "is-danger")}>{status === "missing" ? "not taught" : status === "noframe" ? "not a frame" : "no joints"}</span>}
      {clearable && value && !open && (
        <button type="button" className="mp-picker-clear" aria-label="Clear" onClick={() => onChange("")}>
          <X size={12} />
        </button>
      )}
      <ChevronDown size={14} className="mp-picker-caret" onClick={() => (open ? setOpen(false) : input.current?.focus())} />
      {open &&
        rect &&
        createPortal(
          <div
            ref={listRef}
            data-tut="mp-picker-list"
            className="mp-picker-list"
            style={{ left: rect.left, width: Math.max(rect.width, 220), ...(window.innerHeight - rect.bottom > 260 ? { top: rect.bottom + 4 } : { bottom: window.innerHeight - rect.top + 4 }) }}
          >
            {!list.length && !typedNew && <div className="mp-picker-empty">{points.length ? "No point matches" : onlyFrames ? "No frames (points with is_tf: true)" : "No points taught yet: teach them on Teach Points"}</div>}
            {list.map((p, i) => (
              <button
                key={p.name}
                type="button"
                className={cx("mp-picker-item", i === hi && "is-hi", p.name === value && "is-sel", !p.hasJoints && !onlyFrames && "is-weak")}
                onMouseEnter={() => setHi(i)}
                onClick={() => pick(p.name)}
                title={!p.hasJoints && !onlyFrames ? "Joint values missing: the motion server refuses this point until it is re-taught" : undefined}
              >
                <span className="grow truncate">{p.name}</span>
                {p.isTf && <span className="mp-mini">frame</span>}
                {p.nature && p.nature !== "point" && p.nature.length < 14 && <span className="mp-mini">{p.nature}</span>}
                {!p.hasJoints && !onlyFrames && <span className="mp-mini is-warn">no joints</span>}
              </button>
            ))}
            {typedNew && (
              <button type="button" className={cx("mp-picker-item", hi === list.length && "is-hi")} onMouseEnter={() => setHi(list.length)} onClick={() => pick(q.trim())}>
                <Plus size={13} />
                <span className="grow truncate">Use "{q.trim()}" (teach it later)</span>
              </button>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}

/** Ordered point list (SPLINE): chips with move / remove and a picker to add. */
export function PointListPicker({ value = [], onChange, points, invalid }) {
  const known = new Set(points.filter((p) => p.hasJoints).map((p) => p.name));
  const move = (i, d) => {
    const next = [...value];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className={cx("mp-plist", invalid && "is-invalid")}>
      {value.map((n, i) => (
        <div key={`${n}-${i}`} className={cx("mp-plist-row", !known.has(n) && "is-bad")}>
          <span className="mp-plist-i">{i + 1}</span>
          <span className="grow truncate">{n}</span>
          {!known.has(n) && <span className="mp-mini is-danger">{points.some((p) => p.name === n) ? "no joints" : "not taught"}</span>}
          <button type="button" className="mp-icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
            <ArrowUp size={12} />
          </button>
          <button type="button" className="mp-icon-btn" aria-label="Move down" disabled={i === value.length - 1} onClick={() => move(i, 1)}>
            <ArrowDown size={12} />
          </button>
          <button type="button" className="mp-icon-btn" aria-label="Remove" onClick={() => onChange(value.filter((_, k) => k !== i))}>
            <X size={12} />
          </button>
        </div>
      ))}
      <PointPicker value="" placeholder={value.length ? "Add the next point…" : "Add the first point…"} points={points} onChange={(n) => n && onChange([...value, n])} />
    </div>
  );
}
