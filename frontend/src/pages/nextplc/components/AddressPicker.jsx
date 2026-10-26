// AddressPicker -- pick an address (raw, with its alias if the program has one, and the live
// value when the PLC is online). Used by the rung form, the ladder editor, the block wizard and the editor.
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { I_NAMES, Q_NAMES, M_NAMES, R_NAMES, S_NAMES, S_HELP, I_HELP } from "../lib/addresses";
import { usePlc } from "../store/plc";
import { Tabs, cx } from "./ui";

const AREAS = [
  { id: "I", label: "Inputs", names: I_NAMES },
  { id: "Q", label: "Outputs", names: Q_NAMES },
  { id: "M", label: "M bits", names: M_NAMES },
  { id: "R", label: "Registers", names: R_NAMES },
  { id: "S", label: "System", names: S_NAMES },
];

/**
 * props: aliases (Map canonical -> alias), onPick(name, {alias, area}), allow: ['I','Q','M','R','S'],
 *        extra: [{name, alias, hint}] e.g. block locals / sequence names
 */
export default function AddressPicker({ aliases, onPick, allow, extra = [], preferAlias = true }) {
  const state = usePlc((s) => s.state);
  const areas = useMemo(() => {
    const base = AREAS.filter((a) => !allow || allow.includes(a.id));
    return extra.length ? [{ id: "X", label: "This program", names: [] }, ...base] : base;
  }, [allow, extra]);
  const [area, setArea] = useState(areas[0]?.id || "I");
  const [q, setQ] = useState("");
  const items = useMemo(() => {
    const list = area === "X" ? extra : (areas.find((a) => a.id === area)?.names || []).map((n) => ({ name: n, alias: aliases?.get(n) || "", hint: area === "S" ? S_HELP[n] : area === "I" ? I_HELP(n) : "" }));
    const all = list;
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((x) => x.name.toLowerCase().includes(needle) || x.alias.toLowerCase().includes(needle) || (x.hint || "").toLowerCase().includes(needle)) : all;
  }, [area, q, aliases, extra, areas]);
  const live = (n) => { if (!state) return undefined; return n.startsWith("R") && !n.includes(".") ? state.regs[n] : state.bits[n]; };
  return (
    <div className="picker">
      <div className="row">
        <Tabs value={area} onChange={setArea} items={areas.map((a) => ({ id: a.id, label: a.label }))} />
        <div className="row grow" style={{ position: "relative" }}>
          <Search size={14} style={{ position: "absolute", left: 8, color: "var(--text-faint)" }} />
          <input className="input grow" style={{ paddingLeft: 26 }} placeholder="Search address or name" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </div>
      </div>
      <div className="list">
        {items.map((it) => {
          const v = live(it.name);
          return (
            <button key={it.name} className="item" onClick={() => onPick(preferAlias && it.alias ? it.alias : it.name, it)} title={it.hint || ""}>
              <span>{it.name}</span>
              {it.alias && <span className="alias">{it.alias}</span>}
              {it.hint && !it.alias && <span className="alias">{it.hint}</span>}
              {v !== undefined && <span className={cx("v", v === 1 && "on")}>{v}</span>}
            </button>
          );
        })}
        {!items.length && <div className="empty">Nothing matches.</div>}
      </div>
    </div>
  );
}
