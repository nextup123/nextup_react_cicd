// Floating legend on the canvas: shape per node kind, colour per what the node
// does, and which node types show their name next to the shape.
import { useMemo } from "react";
import { ChevronDown, ChevronUp, Eye, EyeOff, Palette } from "lucide-react";
import { Button, IconButton } from "../../components/ui";
import { COLOR_GROUPS, KINDS, KIND_ORDER, colourGroupOf, flatten, isWrapperType, kindOf, shapePath } from "./treeModel";

const Shape = ({ shape, color = "var(--text-muted)" }) => (
  <svg width="16" height="16" viewBox="-12 -12 24 24" className="bt-legend-shape" aria-hidden>
    <path d={shapePath(shape, 8)} fill={color} />
  </svg>
);

export default function Legend({ tree, lib, labelTypes, onLabelTypes, open, onOpen }) {
  const { kinds, groups, types } = useMemo(() => {
    const kinds = new Map();
    const groups = new Map();
    const types = new Map();
    for (const n of flatten(tree?.root)) {
      const k = kindOf(n.type, lib);
      const g = colourGroupOf(n.type, lib);
      kinds.set(k, (kinds.get(k) || 0) + 1);
      groups.set(g.key, { ...g, count: (groups.get(g.key)?.count || 0) + 1 });
      types.set(n.type, { kind: k, color: g.color, count: (types.get(n.type)?.count || 0) + 1 });
    }
    const order = (key) => {
      const i = COLOR_GROUPS.findIndex((g) => g.key === key);
      return i < 0 ? 99 : i;
    };
    return {
      kinds: KIND_ORDER.filter((k) => kinds.has(k)).map((k) => ({ k, count: kinds.get(k) })),
      groups: [...groups.values()].sort((a, b) => order(a.key) - order(b.key)),
      types: [...types.entries()].sort((a, b) => KIND_ORDER.indexOf(a[1].kind) - KIND_ORDER.indexOf(b[1].kind) || a[0].localeCompare(b[0])),
    };
  }, [tree, lib]);

  if (!open) {
    return (
      <div className="bt-legend is-closed">
        <Button size="sm" icon={Palette} iconRight={ChevronUp} onClick={() => onOpen(true)}>
          Legend
        </Button>
      </div>
    );
  }

  const toggle = (t) => {
    const next = new Set(labelTypes);
    next.has(t) ? next.delete(t) : next.add(t);
    onLabelTypes(next);
  };
  const setGroup = (pred, on) => {
    const next = new Set(labelTypes);
    types.forEach(([t]) => pred(t) && (on ? next.add(t) : next.delete(t)));
    onLabelTypes(next);
  };

  return (
    <div className="bt-legend">
      <div className="bt-legend-head">
        <Palette size={15} className="muted" />
        <strong className="grow">Legend</strong>
        <IconButton icon={ChevronDown} label="Hide legend" size="sm" onClick={() => onOpen(false)} />
      </div>
      <div className="bt-legend-body">
        <div className="section-label">Shape: node kind</div>
        {kinds.length === 0 && <div className="xs muted">Open a subtree to see its node kinds.</div>}
        {kinds.map(({ k, count }) => (
          <div key={k} className="bt-legend-row" title={KINDS[k].hint}>
            <Shape shape={KINDS[k].shape} />
            <span className="grow">{KINDS[k].label}</span>
            <span className="xs muted">{count}</span>
          </div>
        ))}

        <div className="section-label" style={{ marginTop: 10 }}>
          Colour: what it does
        </div>
        {groups.map((g) => (
          <div key={g.key} className="bt-legend-row">
            <span className="bt-swatch" style={{ background: g.color }} />
            <span className="grow">{g.label}</span>
            <span className="xs muted">{g.count}</span>
          </div>
        ))}
        <div className="xs muted" style={{ marginTop: 4 }}>
          A shadow behind a node and a +N badge mean it is collapsed. Click the small knob under it (or double-click the node) to expand.
        </div>

        <div className="section-label" style={{ marginTop: 10 }}>
          Show names for
        </div>
        <div className="bt-legend-quick">
          <Button size="sm" variant="ghost" onClick={() => setGroup((t) => isWrapperType(t, lib) || t === "SubTreePlus", true)} title="Show names of containers">
            Containers
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setGroup((t) => !isWrapperType(t, lib), true)} title="Show names of single steps">
            Steps
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setGroup(() => true, false)}>
            None
          </Button>
        </div>
        <div className="bt-legend-types">
          {types.map(([t, info]) => {
            const on = labelTypes.has(t);
            return (
              <button key={t} type="button" className="bt-legend-row is-button" onClick={() => toggle(t)} title={on ? "Hide names" : "Show names"}>
                <Shape shape={KINDS[info.kind].shape} color={info.color} />
                <span className="grow truncate">{t}</span>
                <span className="xs muted">{info.count}</span>
                {on ? <Eye size={14} className="bt-eye is-on" /> : <EyeOff size={14} className="bt-eye" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
