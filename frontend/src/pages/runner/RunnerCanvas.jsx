// Live tree for the NexRoot runner page. d3 draws the complete tree once per
// structure / collapse / orientation change; live updates only switch the
// class of nodes whose status character changed (BT_LIVE.st, at most 5 Hz),
// so a running tree costs a few attribute writes per update, no React render
// and no animation.
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as d3 from "d3";
import { STATUS_CLASS, fmtMs } from "./runnerModel";

const W = 168; // node box
const H = 40;
const SCALE_EXTENT = [0.08, 2.5];
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const RunnerCanvas = forwardRef(function RunnerCanvas({ index, st, run, bp, marks, markFocus, selectedUid, collapsed, orientation = "TB", onSelect, onToggle, onContext, onUserMove }, ref) {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const gRef = useRef(null);
  const zoomRef = useRef(null);
  const els = useRef(new Map()); // uid → { g, link, timer, x, y }
  const shown = useRef(""); // status string currently painted
  const timers = useRef(new Set()); // uids with a running time label
  const layoutRef = useRef(null); // { minX, maxX, minY, maxY }
  const cb = useRef({});
  cb.current = { onSelect, onToggle, onContext, onUserMove };

  // zoom / pan
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    const g = d3.select(gRef.current);
    const zoom = d3
      .zoom()
      .scaleExtent(SCALE_EXTENT)
      .on("zoom", (e) => {
        g.attr("transform", e.transform);
        if (e.sourceEvent) cb.current.onUserMove?.();
      });
    svg.call(zoom).on("dblclick.zoom", null);
    zoomRef.current = zoom;
    return () => svg.on(".zoom", null);
  }, []);

  const size = () => ({ w: wrapRef.current?.clientWidth || 800, h: wrapRef.current?.clientHeight || 500 });

  /** Whole tree in view; readable=true keeps the text readable instead (top of the tree, centred on the root). */
  function fit(animate = true, readable = false) {
    const b = layoutRef.current;
    if (!b || !zoomRef.current) return;
    const { w, h } = size();
    const pad = 40;
    let k = Math.max(SCALE_EXTENT[0], Math.min(1, (w - pad) / (b.maxX - b.minX + W), (h - pad) / (b.maxY - b.minY + H)));
    let t = d3.zoomIdentity.translate(w / 2 - (k * (b.minX + b.maxX)) / 2, Math.max(20, h / 2 - (k * (b.minY + b.maxY)) / 2)).scale(k);
    if (readable && k < 0.6) {
      k = 0.6;
      const r = els.current.values().next().value; // the root
      t = d3.zoomIdentity.translate(w / 2 - k * (r?.x || 0), 30 + (k * H) / 2 - k * (r?.y || 0)).scale(k);
    }
    const svg = d3.select(svgRef.current);
    (animate ? svg.transition().duration(180) : svg).call(zoomRef.current.transform, t);
  }

  /** Centre a node; minScale raises the zoom so it is readable. */
  function focus(uid, { minScale = 0.8 } = {}) {
    const e = els.current.get(uid);
    if (!e) return false;
    const cur = d3.zoomTransform(svgRef.current);
    const k = Math.max(cur.k, minScale);
    const { w, h } = size();
    d3.select(svgRef.current)
      .transition()
      .duration(220)
      .call(zoomRef.current.transform, d3.zoomIdentity.translate(w / 2 - k * e.x, h / 2 - k * e.y).scale(k));
    return true;
  }

  /** Pan just enough that the node is in view (follow mode). */
  function reveal(uid) {
    const e = els.current.get(uid);
    if (!e) return;
    const cur = d3.zoomTransform(svgRef.current);
    const { w, h } = size();
    const [sx, sy] = cur.apply([e.x, e.y]);
    const mx = (W / 2) * cur.k + 30;
    const my = (H / 2) * cur.k + 30;
    const dx = sx < mx ? mx - sx : sx > w - mx ? w - mx - sx : 0;
    const dy = sy < my ? my - sy : sy > h - my ? h - my - sy : 0;
    if (!dx && !dy) return;
    d3.select(svgRef.current).transition().duration(200).call(zoomRef.current.transform, cur.translate(dx / cur.k, dy / cur.k));
  }

  const zoomBy = (f) => d3.select(svgRef.current).transition().duration(140).call(zoomRef.current.scaleBy, f);

  useImperativeHandle(ref, () => ({ fit: () => fit(true), focus, reveal, zoomIn: () => zoomBy(1.25), zoomOut: () => zoomBy(0.8), has: (uid) => els.current.has(uid) }));

  // layout + draw (structure, collapse state, orientation)
  const drawnFor = useRef(null);
  useEffect(() => {
    const g = d3.select(gRef.current);
    g.selectAll("*").remove();
    els.current = new Map();
    shown.current = "";
    timers.current = new Set();
    const root = index?.root;
    if (!root) {
      layoutRef.current = null;
      return;
    }
    const kids = (n) => (collapsed?.has(n.uid) ? null : (index.children.get(n.uid) || []).map((u) => index.byUid.get(u)));
    const h = d3.hierarchy(root, kids);
    const lr = orientation === "LR";
    d3.tree()
      .nodeSize(lr ? [H + 14, W + 64] : [W + 18, H + 48])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.15))(h);
    const pos = (d) => (lr ? [d.y, d.x] : [d.x, d.y]);

    const linkG = g.append("g").attr("class", "nr-links");
    const nodeG = g.append("g").attr("class", "nr-nodes");
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;

    for (const d of h.descendants()) {
      const n = d.data;
      const [x, y] = pos(d);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      let link = null;
      if (d.parent) {
        const [px, py] = pos(d.parent);
        const path = lr
          ? `M${px + W / 2},${py}C${(px + x) / 2},${py} ${(px + x) / 2},${y} ${x - W / 2},${y}`
          : `M${px},${py + H / 2}C${px},${(py + y) / 2} ${x},${(py + y) / 2} ${x},${y - H / 2}`;
        link = linkG.append("path").attr("class", "nr-link").attr("d", path).node();
      }
      const kind = index.kind.get(n.uid);
      const isSub = kind === "subtree";
      const hidden = collapsed?.has(n.uid) ? countBelow(index, n.uid) : 0;
      const ng = nodeG
        .append("g")
        .attr("class", `nr-node k-${kind} st-idle`)
        .attr("transform", `translate(${x},${y})`)
        .attr("data-uid", n.uid);
      ng.append("rect").attr("class", "nr-box").attr("x", -W / 2).attr("y", -H / 2).attr("width", W).attr("height", H).attr("rx", isSub ? 3 : 7);
      ng.append("rect").attr("class", "nr-stripe").attr("x", -W / 2).attr("y", -H / 2).attr("width", 5).attr("height", H).attr("rx", 2).attr("fill", index.color.get(n.uid));
      ng.append("text").attr("class", "nr-name").attr("x", -W / 2 + 12).attr("y", -3).text(clip(n.name || n.type, 22));
      ng.append("text").attr("class", "nr-type").attr("x", -W / 2 + 12).attr("y", 12).text(clip(isSub ? `subtree · ${n.type}` : n.type, 26));
      const timer = ng.append("text").attr("class", "nr-timer").attr("x", W / 2 - 6).attr("y", 12).attr("text-anchor", "end").node();
      ng.append("circle").attr("class", "nr-bp").attr("cx", -W / 2 + 2).attr("cy", -H / 2 + 2).attr("r", 5);
      if (hidden) {
        ng.append("rect").attr("class", "nr-more").attr("x", -16).attr("y", H / 2 - 2).attr("width", 32).attr("height", 14).attr("rx", 7);
        ng.append("text").attr("class", "nr-more-text").attr("x", 0).attr("y", H / 2 + 8).attr("text-anchor", "middle").text(`+${hidden}`);
      }
      ng.append("title").text(`${n.name} (${n.type})${n.subtree ? ` · in subtree ${n.subtree}` : ""}${isSub ? "\nDouble-click to fold / unfold" : ""}`);
      els.current.set(n.uid, { g: ng.node(), link, timer, x, y });
    }
    layoutRef.current = { minX, maxX, minY, maxY };

    nodeG
      .on("click", (e) => {
        const uid = uidOf(e.target);
        if (uid) cb.current.onSelect?.(uid);
      })
      .on("dblclick", (e) => {
        const uid = uidOf(e.target);
        if (uid && (index.children.get(uid)?.length || 0) > 0) cb.current.onToggle?.(uid);
      })
      .on("contextmenu", (e) => {
        const uid = uidOf(e.target);
        if (!uid) return;
        e.preventDefault();
        const box = wrapRef.current.getBoundingClientRect();
        cb.current.onContext?.(uid, e.clientX - box.left, e.clientY - box.top);
      });

    const key = `${index.root.uid}:${index.nodes.length}:${orientation}`;
    if (drawnFor.current !== key) {
      drawnFor.current = key;
      fit(false, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, collapsed, orientation]);

  // live status: only nodes whose character changed
  useEffect(() => {
    if (!index) return;
    const prev = shown.current;
    const next = st || "";
    const nodes = index.nodes;
    for (let i = 0; i < nodes.length; i++) {
      const c = next[i] || ".";
      if (prev[i] === c && prev.length === next.length) continue;
      const e = els.current.get(nodes[i].uid);
      if (!e) continue;
      const cls = STATUS_CLASS[c] || "st-idle";
      e.g.setAttribute("class", e.g.getAttribute("class").replace(/\bst-[\w-]+/, cls));
      if (e.link) e.link.setAttribute("class", c === "R" ? "nr-link is-run" : c === "F" || c === "f" ? "nr-link is-fail" : c === "S" || c === "s" ? "nr-link is-ok" : "nr-link");
    }
    shown.current = next;
  }, [st, index, collapsed, orientation]);

  // running time labels
  useEffect(() => {
    const now = new Set();
    for (const [uid, ms] of run || []) {
      const e = els.current.get(uid);
      if (!e?.timer) continue;
      e.timer.textContent = fmtMs(ms);
      now.add(uid);
    }
    for (const uid of timers.current) {
      if (!now.has(uid)) {
        const e = els.current.get(uid);
        if (e?.timer) e.timer.textContent = "";
      }
    }
    timers.current = now;
  }, [run, index, collapsed, orientation]);

  // selection and breakpoint markers
  useEffect(() => {
    for (const [uid, e] of els.current) {
      e.g.classList.toggle("is-selected", uid === selectedUid);
      const name = index?.byUid.get(uid)?.name;
      e.g.classList.toggle("has-bp", Boolean(bp?.name) && name === bp.name);
    }
  }, [selectedUid, bp?.name, index, collapsed, orientation]);

  // validation marks (errors red, warnings amber, the shown one thicker)
  useEffect(() => {
    for (const [uid, e] of els.current) {
      const m = marks?.get(uid);
      e.g.classList.toggle("has-err", m === "e");
      e.g.classList.toggle("has-warn", m === "w");
      e.g.classList.toggle("is-err-focus", uid === markFocus);
    }
  }, [marks, markFocus, index, collapsed, orientation]);

  return (
    <div ref={wrapRef} className="nr-canvas" onContextMenu={(e) => e.preventDefault()}>
      <svg ref={svgRef} className="nr-svg">
        <g ref={gRef} />
      </svg>
    </div>
  );
});

function uidOf(target) {
  const g = target?.closest?.("[data-uid]");
  return g ? Number(g.getAttribute("data-uid")) : 0;
}

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

export default RunnerCanvas;
