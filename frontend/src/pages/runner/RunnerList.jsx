// Compact live tree for the NexRoot runner page: one line per node, like a
// terminal tree listing (├─ └─ guides, name, type, status, time), so a few
// hundred nodes fit on screen at once. Same API as RunnerCanvas (fit, focus,
// reveal, zoomIn / zoomOut = row density), so the page drives either view.
//
// CPU: React renders the rows only when the structure, the folding or the
// selection changes. Live updates (at most 5 Hz) write the data-st attribute
// and the status / time text of the rows whose status character changed;
// React never renders those, so the two never fight.
import { forwardRef, memo, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import { cx } from "../../components/ui";
import { STATUS_LABEL, fmtMs } from "./runnerModel";

const DENSITY = ["tight", "normal", "roomy"];
const ST_TEXT = { R: "RUNNING", S: "SUCCESS", F: "FAILURE", s: "SUCCESS", f: "FAILURE", h: "HALTED", ".": "IDLE" };
const NAME_MAX = 72; // ch: longer names are cut with …
const TYPE_MAX = 26;

/** Visible rows in tree order with their guide prefix ("│  ├─ "). */
function buildRows(index, collapsed) {
  const rows = [];
  const root = index?.root;
  if (!root) return rows;
  const walk = (uid, prefix, isLast, depth) => {
    const n = index.byUid.get(uid);
    if (!n || rows.length > 20000) return;
    const kids = index.children.get(uid) || [];
    const folded = collapsed?.has(uid) && kids.length > 0;
    const guide = depth === 0 ? "" : `${prefix}${isLast ? "└─ " : "├─ "}`;
    rows.push({ uid, n, guide, depth, kids: kids.length, folded, hidden: folded ? countBelow(index, uid) : 0 });
    if (folded) return;
    const next = depth === 0 ? "" : `${prefix}${isLast ? "   " : "│  "}`;
    kids.forEach((k, i) => walk(k, next, i === kids.length - 1, depth + 1));
  };
  walk(root.uid, "", true, 0);
  return rows;
}

const RunnerList = forwardRef(function RunnerList({ index, st, run, bp, marks, markFocus, selectedUid, collapsed, density = "normal", onDensity, lastEvent, onSelect, onToggle, onContext, onUserMove }, ref) {
  const wrapRef = useRef(null);
  const els = useRef(new Map()); // uid → { row, st, time }
  const shown = useRef(""); // status string currently painted
  const timers = useRef(new Set());
  const cb = useRef({});
  cb.current = { onSelect, onToggle, onContext, onUserMove };

  const rows = useMemo(() => buildRows(index, collapsed), [index, collapsed]);
  const cols = useMemo(() => {
    let name = 12;
    let type = 6;
    for (const r of rows) {
      const extra = r.hidden ? String(r.hidden).length + 3 : 0;
      name = Math.max(name, r.guide.length + 4 + Math.min(NAME_MAX, (r.n.name || r.n.type).length) + extra);
      type = Math.max(type, Math.min(TYPE_MAX, (r.n.type || "").length));
    }
    return `${name + 2}ch ${type + 2}ch 9ch 9ch`;
  }, [rows]);

  // rows → element map; repaint every status after the rows changed
  useLayoutEffect(() => {
    const m = new Map();
    for (const row of wrapRef.current?.querySelectorAll("[data-uid]") || []) {
      m.set(Number(row.getAttribute("data-uid")), { row, st: row.querySelector(".nl-st"), time: row.querySelector(".nl-time") });
    }
    els.current = m;
    shown.current = "";
    timers.current = new Set();
  }, [rows]);

  // live status: only rows whose character changed
  useEffect(() => {
    if (!index) return;
    const prev = shown.current;
    const next = st || "";
    const nodes = index.nodes;
    const full = prev.length !== next.length;
    for (let i = 0; i < nodes.length; i++) {
      const c = next[i] || ".";
      if (!full && prev[i] === c) continue;
      const e = els.current.get(nodes[i].uid);
      if (!e) continue;
      e.row.setAttribute("data-st", c);
      if (e.st) {
        e.st.textContent = ST_TEXT[c] || "IDLE";
        e.st.title = STATUS_LABEL[c] || "";
      }
    }
    shown.current = next.length ? next : "";
  }, [st, index, rows]);

  // running time of the running leaves
  useEffect(() => {
    const now = new Set();
    for (const [uid, ms] of run || []) {
      const e = els.current.get(uid);
      if (!e?.time) continue;
      e.time.textContent = fmtMs(ms);
      now.add(uid);
    }
    for (const uid of timers.current) {
      if (!now.has(uid)) {
        const e = els.current.get(uid);
        if (e?.time) e.time.textContent = "";
      }
    }
    timers.current = now;
  }, [run, rows]);

  const scrollTo = (uid, block) => {
    const e = els.current.get(uid);
    if (!e) return false;
    e.row.scrollIntoView({ block, inline: "nearest", behavior: block === "center" ? "smooth" : "auto" });
    return true;
  };

  useImperativeHandle(ref, () => ({
    fit: () => wrapRef.current?.scrollTo({ top: 0, left: 0, behavior: "smooth" }),
    focus: (uid) => {
      const ok = scrollTo(uid, "center");
      const e = els.current.get(uid);
      if (e) {
        e.row.classList.remove("is-flash");
        void e.row.offsetWidth; // restart the highlight
        e.row.classList.add("is-flash");
      }
      return ok;
    },
    reveal: (uid) => scrollTo(uid, "nearest"),
    zoomIn: () => onDensity?.(DENSITY[Math.min(DENSITY.length - 1, DENSITY.indexOf(density) + 1)]),
    zoomOut: () => onDensity?.(DENSITY[Math.max(0, DENSITY.indexOf(density) - 1)]),
    has: (uid) => els.current.has(uid),
  }));

  const uidOf = (target) => {
    const row = target?.closest?.("[data-uid]");
    return row ? Number(row.getAttribute("data-uid")) : 0;
  };

  return (
    <div className={cx("nl-wrap", `d-${density}`)}>
      <div
        ref={wrapRef}
        className="nl-scroll"
        style={{ "--nl-cols": cols }}
        onWheel={() => cb.current.onUserMove?.()}
        onPointerDown={() => cb.current.onUserMove?.()}
        onClick={(e) => {
          if (e.target.closest(".nl-fold")) return;
          const uid = uidOf(e.target);
          if (uid) cb.current.onSelect?.(uid);
        }}
        onDoubleClick={(e) => {
          const uid = uidOf(e.target);
          if (uid && (index.children.get(uid)?.length || 0) > 0) cb.current.onToggle?.(uid);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          const uid = uidOf(e.target);
          if (!uid) return;
          const box = wrapRef.current.parentElement.getBoundingClientRect();
          cb.current.onContext?.(uid, e.clientX - box.left, e.clientY - box.top);
        }}
      >
        <div className="nl-head" aria-hidden>
          <span>Node</span>
          <span>Type</span>
          <span>Status</span>
          <span className="nl-right">Time</span>
        </div>
        <Rows rows={rows} index={index} selectedUid={selectedUid} bpName={bp?.name || ""} marks={marks} markFocus={markFocus} onToggle={(uid) => cb.current.onToggle?.(uid)} />
      </div>
      <div className="nl-foot">
        <span className="nl-legend">
          <i className="nl-sw sw-R" /> running <i className="nl-sw sw-S" /> success <i className="nl-sw sw-F" /> failure <i className="nl-sw sw-s" /> done this cycle
        </span>
        <span className="nl-last mono truncate" title={lastEvent || ""}>
          {lastEvent ? `last: ${lastEvent}` : ""}
        </span>
      </div>
    </div>
  );
});

/** The rows; rendered again only when the tree, the folding, the selection, the breakpoint or the validation marks change (not on live updates). */
const Rows = memo(function Rows({ rows, index, selectedUid, bpName, marks, markFocus, onToggle }) {
  return (
    <>
      {rows.map((r) => {
        const kind = index.kind.get(r.uid);
        const name = r.n.name || r.n.type;
        return (
          <div
            key={r.uid}
            data-uid={r.uid}
            className={cx(
              "nl-row",
              `k-${kind}`,
              r.uid === selectedUid && "is-selected",
              bpName && bpName === r.n.name && "has-bp",
              marks?.get(r.uid) === "e" && "has-err",
              marks?.get(r.uid) === "w" && "has-warn",
              markFocus === r.uid && "is-err-focus"
            )}
            title={`${r.n.name} (${r.n.type})${r.n.subtree ? ` · in subtree ${r.n.subtree}` : ""}${r.kids ? "\nDouble-click to fold / unfold" : ""}`}
          >
            <span className="nl-node">
              <span className="nl-guide">{r.guide}</span>
              {r.kids ? (
                <button
                  type="button"
                  className="nl-fold"
                  tabIndex={-1}
                  onClick={() => onToggle(r.uid)}
                  aria-label={r.folded ? "Unfold" : "Fold"}
                >
                  {r.folded ? "▸" : "▾"}
                </button>
              ) : (
                <span className="nl-fold is-leaf" />
              )}
              <span className="nl-kind" style={{ background: index.color.get(r.uid) }} />
              <span className="nl-name">{name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1)}…` : name}</span>
              {r.folded && <span className="nl-more">+{r.hidden}</span>}
            </span>
            <span className="nl-type">{kind === "subtree" ? `⤷ ${r.n.type}` : r.n.type}</span>
            <span className="nl-st" />
            <span className="nl-time" />
          </div>
        );
      })}
    </>
  );
}, (a, b) => a.rows === b.rows && a.index === b.index && a.selectedUid === b.selectedUid && a.bpName === b.bpName && a.marks === b.marks && a.markFocus === b.markFocus);

function countBelow(index, uid) {
  let n = 0;
  const stack = [...(index.children.get(uid) || [])];
  while (stack.length && n < 9999) {
    const u = stack.pop();
    n += 1;
    stack.push(...(index.children.get(u) || []));
  }
  return n;
}

export default RunnerList;
