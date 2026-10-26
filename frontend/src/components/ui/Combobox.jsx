// Text field with a searchable suggestion list: type to filter, arrows + Enter to
// pick, or keep whatever was typed (custom entry). Shows a limited number of
// matches so long lists (128 M bits, 56 inputs…) stay short. The list floats
// above dialogs (portal, fixed position).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X } from "lucide-react";
import { cx } from "./index";
import "./combobox.css";

const LIMIT = 40;

/**
 * options  [{ value, label?, hint?, group? }] (strings are fine too)
 * value / onChange(text)   the field text (custom text allowed)
 * limit    how many matches to show at once
 */
export function Combobox({ value, onChange, options, placeholder, limit = LIMIT, className, ariaLabel, emptyText = "No match: the typed text is used as is" }) {
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(null); // null = show everything (just opened)
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState(null);

  const all = useMemo(() => (options || []).map((o) => (typeof o === "string" ? { value: o } : o)), [options]);
  const matches = useMemo(() => {
    const q = (query ?? "").trim().toLowerCase();
    if (!q) return all;
    const starts = [];
    const contains = [];
    for (const o of all) {
      const v = String(o.value).toLowerCase();
      const text = `${v} ${o.label || ""} ${o.hint || ""}`.toLowerCase();
      if (v.startsWith(q)) starts.push(o);
      else if (text.includes(q)) contains.push(o);
    }
    return [...starts, ...contains];
  }, [all, query]);
  const shown = matches.slice(0, limit);

  const place = () => {
    const r = inputRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    const up = below < 240 && r.top > below;
    setPos({ left: r.left, width: r.width, top: up ? undefined : r.bottom + 4, bottom: up ? window.innerHeight - r.top + 4 : undefined, maxH: Math.max(160, Math.min(320, (up ? r.top : below) - 16)) });
  };
  useLayoutEffect(() => {
    if (!open) return;
    place();
    const onMove = () => place();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (inputRef.current?.parentElement?.contains(e.target) || listRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);
  useEffect(() => setHi(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(".cbx-opt.is-hi")?.scrollIntoView({ block: "nearest" });
  }, [hi]);

  const pick = (o) => {
    onChange(String(o.value));
    setQuery(null);
    setOpen(false);
  };
  const onKey = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return setOpen(true);
      const n = shown.length;
      if (n) setHi((h) => (h + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
    } else if (e.key === "Enter") {
      if (open && shown[hi]) {
        e.preventDefault();
        pick(shown[hi]);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    } else if (e.key === "Tab") setOpen(false);
  };

  let lastGroup = null;
  return (
    <div className={cx("cbx", className)}>
      <input
        ref={inputRef}
        className="input cbx-input"
        value={value || ""}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-expanded={open}
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          onChange(e.target.value);
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setQuery(null);
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onKeyDown={onKey}
      />
      {value ? (
        <button type="button" className="cbx-btn" tabIndex={-1} title="Clear" onClick={() => { onChange(""); setQuery(""); inputRef.current?.focus(); }}>
          <X size={14} />
        </button>
      ) : (
        <button type="button" className="cbx-btn" tabIndex={-1} title="Show the list" onClick={() => { setOpen((o) => !o); inputRef.current?.focus(); }}>
          <ChevronDown size={14} />
        </button>
      )}
      {open && pos &&
        createPortal(
          <div ref={listRef} className="cbx-list" role="listbox" style={{ left: pos.left, width: Math.max(pos.width, 240), top: pos.top, bottom: pos.bottom, maxHeight: pos.maxH }}>
            {shown.map((o, i) => {
              const head = o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              return (
                <div key={`${o.group || ""}:${o.value}`}>
                  {head && <div className="cbx-group">{head}</div>}
                  <div
                    role="option"
                    aria-selected={i === hi}
                    className={cx("cbx-opt", i === hi && "is-hi", String(o.value) === String(value) && "is-sel")}
                    onPointerDown={(e) => e.preventDefault()}
                    onPointerEnter={() => setHi(i)}
                    onClick={() => pick(o)}
                  >
                    <span className="cbx-val">{o.label || o.value}</span>
                    {o.hint && <span className="cbx-hint">{o.hint}</span>}
                  </div>
                </div>
              );
            })}
            {!shown.length && <div className="cbx-empty">{emptyText}</div>}
            {matches.length > shown.length && <div className="cbx-more">{matches.length - shown.length} more: type to narrow the list</div>}
          </div>,
          document.body
        )}
    </div>
  );
}
