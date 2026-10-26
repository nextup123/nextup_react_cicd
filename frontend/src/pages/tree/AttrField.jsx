// One attribute input. Point attributes get a searchable list of taught
// points; true/false attributes get a select; everything else is text.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Field, Input, Select } from "../../components/ui";
import { usePoints } from "../../lib/queries";
import { usePrograms } from "../programs/programsApi";
import { POINT_ATTRIBUTES, isBoolLike } from "./treeModel";

export function usePointNames() {
  const { data } = usePoints();
  return useMemo(
    () => (Array.isArray(data) ? data.map((p) => (typeof p === "string" ? p : p?.name || p?.point_name || p?.id)).filter(Boolean) : []),
    [data]
  );
}

export default function AttrField({ name, value, onChange, defaultValue, readOnly, hint }) {
  let control;
  if (readOnly) control = <Input value={value} readOnly size="sm" />;
  else if (POINT_ATTRIBUTES.has(name)) control = <PointInput value={value} onChange={onChange} />;
  else if (name === "program") control = <ProgramSelect value={value} onChange={onChange} />;
  else if (isBoolLike(value) || isBoolLike(defaultValue))
    control = (
      <Select size="sm" value={value} onChange={(e) => onChange(e.target.value)}>
        {!isBoolLike(value) && <option value={value}>{value || "(empty)"}</option>}
        <option value="true">true</option>
        <option value="false">false</option>
      </Select>
    );
  else control = <Input size="sm" value={value} placeholder={defaultValue || ""} onChange={(e) => onChange(e.target.value)} />;
  return (
    <Field label={<span className="bt-attr-name">{name}</span>} hint={hint}>
      {control}
    </Field>
  );
}

/** Motion program of a RunProgram node: the programs of the Motion Programs page. */
function ProgramSelect({ value, onChange }) {
  const { data } = usePrograms();
  const names = (data?.programs || []).map((p) => p.name);
  return (
    <Select size="sm" value={value} onChange={(e) => onChange(e.target.value)}>
      {!names.includes(value) && <option value={value}>{value ? `${value}${data ? " (not found)" : ""}` : "Choose a program…"}</option>}
      {names.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </Select>
  );
}

/** Text input with a dropdown of point names (rendered in a portal so the
 *  scrolling inspector cannot clip it). */
export function PointInput({ value, onChange }) {
  const names = usePointNames();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState(false);
  const [rect, setRect] = useState(null);
  const ref = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => !ref.current?.contains(e.target) && !listRef.current?.contains(e.target) && setOpen(false);
    const reposition = () => ref.current && setRect(ref.current.getBoundingClientRect());
    document.addEventListener("mousedown", close);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  const q = filter ? (value || "").toLowerCase() : "";
  const matches = names.filter((n) => n.toLowerCase().includes(q)).slice(0, 60);
  const show = (all) => {
    setFilter(!all);
    setRect(ref.current.getBoundingClientRect());
    setOpen(true);
  };

  return (
    <div ref={ref}>
      <Input
        size="sm"
        value={value}
        placeholder={names.length ? "Pick or type a point name" : "Point name"}
        autoComplete="off"
        onFocus={() => show(true)}
        onChange={(e) => {
          onChange(e.target.value);
          show(false);
        }}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      />
      {open &&
        rect &&
        matches.length > 0 &&
        createPortal(
          <div
            ref={listRef}
            className="bt-point-list"
            style={{ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 180) }}
          >
            {matches.map((n) => (
              <button
                key={n}
                type="button"
                className={n === value ? "is-active" : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(n);
                  setOpen(false);
                }}
              >
                {n}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
