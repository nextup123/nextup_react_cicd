// "Ladder" view: the same tree as an indented, collapsible list.
import { useEffect, useRef } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cx } from "../../components/ui";
import { longPress, touchedRecently } from "./touch";
import { KINDS, colorOf, countNodes, kindOf, shapePath, visibleAttrs } from "./treeModel";

export default function LadderView({ tree, lib, collapsed, onToggle, selectedKey, matchKeys, focusKey, marks, markFocus, onSelect, onContextMenu }) {
  const ref = useRef(null);

  useEffect(() => {
    const key = focusKey || selectedKey;
    if (!key || !ref.current) return;
    const el = ref.current.querySelector(`[data-key="${CSS.escape(key)}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [focusKey, selectedKey, tree]);

  if (!tree?.root) return null;
  return (
    <div className="bt-ladder" ref={ref} onClick={() => onSelect(null)}>
      <LadderNode
        node={tree.root}
        lib={lib}
        collapsed={collapsed}
        onToggle={onToggle}
        selectedKey={selectedKey}
        matchKeys={matchKeys}
        focusKey={focusKey}
        marks={marks}
        markFocus={markFocus}
        onSelect={onSelect}
        onContextMenu={onContextMenu}
      />
    </div>
  );
}

function LadderNode({ node, lib, collapsed, onToggle, selectedKey, matchKeys, focusKey, marks, markFocus, onSelect, onContextMenu }) {
  const color = colorOf(node.type, lib);
  const hasKids = node.children.length > 0;
  const isClosed = collapsed.has(node.key);
  const attrs = visibleAttrs(node.attributes).filter(([k]) => k !== "ID" && k !== "name");
  const shape = node.depth === 0 ? "root" : KINDS[kindOf(node.type, lib)].shape;

  return (
    <div className={cx("bt-ln", node.depth > 0 && "is-nested")} style={{ "--bt-c": color }}>
      <div
        className={cx(
          "bt-ln-row",
          node.key === selectedKey && "is-selected",
          matchKeys?.has(node.key) && "is-match",
          node.key === focusKey && "is-focus",
          marks?.get(node.key) === "e" && "has-err",
          marks?.get(node.key) === "w" && "has-warn",
          node.key === markFocus && "is-err-focus"
        )}
        data-key={node.key}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(node.key);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (hasKids) onToggle(node.key);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!touchedRecently()) onContextMenu(node.key, e.clientX, e.clientY);
        }}
        {...longPress((x, y) => onContextMenu(node.key, x, y))}
      >
        {hasKids ? (
          <button
            type="button"
            className="bt-ln-toggle"
            aria-label={isClosed ? "Expand" : "Collapse"}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.key);
            }}
          >
            {isClosed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
        ) : (
          <span className="bt-ln-toggle is-spacer" />
        )}
        <svg className="bt-ln-shape" width="15" height="15" viewBox="-12 -12 24 24" aria-hidden>
          <path d={shapePath(shape, 8)} fill={color} />
        </svg>
        <span className="bt-ln-type">{node.type}</span>
        {node.name && node.name !== node.type && <span className="bt-ln-name truncate">{node.name}</span>}
        <span className="bt-ln-attrs">
          {attrs.slice(0, 4).map(([k, v]) => (
            <span key={k} className="bt-pill" title={`${k} = ${v}`}>
              {k}: {String(v) || "—"}
            </span>
          ))}
          {attrs.length > 4 && <span className="bt-pill is-more">+{attrs.length - 4}</span>}
          {hasKids && isClosed && (
            <span className="bt-ln-count" title={`${countNodes(node) - 1} nodes inside (collapsed)`}>
              +{countNodes(node) - 1}
            </span>
          )}
        </span>
      </div>
      {hasKids && (
        <div className={cx("bt-ln-children", isClosed && "is-closed")} aria-hidden={isClosed}>
          <div className="bt-ln-children-inner">
          {node.children.map((c) => (
            <LadderNode
              key={c.key}
              node={c}
              lib={lib}
              collapsed={collapsed}
              onToggle={onToggle}
              selectedKey={selectedKey}
              matchKeys={matchKeys}
              focusKey={focusKey}
              marks={marks}
              markFocus={markFocus}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
            />
          ))}
          </div>
        </div>
      )}
    </div>
  );
}
