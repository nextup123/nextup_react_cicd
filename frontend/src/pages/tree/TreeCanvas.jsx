// d3 tree view. React owns the surrounding UI; d3 owns everything inside the
// <svg>. The zoom/pan transform lives on the svg element and therefore
// survives data refreshes; it is only re-fitted when another subtree opens.
import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import * as d3 from "d3";
import { KINDS, colorOf, countNodes, kindOf, shapePath, visibleAttrs } from "./treeModel";

const SCALE_EXTENT = [0.2, 3];
const ANIM_MS = 280;
const R = 10; // node size (circle radius; other shapes match it)

const TreeCanvas = forwardRef(function TreeCanvas(
  { tree, viewId, lib, spacing = { x: 30, y: 90 }, labelTypes, collapsed, selectedKey, matchKeys, focusKey, runningNames, failedName, breakName, marks, markFocus, readOnly, onSelect, onContextMenu, onDrop, onToggle, onActivate },
  ref
) {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const gRef = useRef(null);
  const zoomRef = useRef(null);
  const rootRef = useRef(null); // d3 hierarchy of the last render
  const fittedFor = useRef(null);
  const cb = useRef({});
  cb.current = { onSelect, onContextMenu, onDrop, onToggle, onActivate, readOnly, canToggle: !!onToggle };
  const [tip, setTip] = useState(null);
  const [version, setVersion] = useState(0);
  const lastTouch = useRef(0); // time of the last touch, to ignore the mouse events a tap emulates
  const touchedRecently = () => Date.now() - lastTouch.current < 1000;

  // One-time setup: svg, layer and zoom behaviour.
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    const g = d3.select(gRef.current);
    const zoom = d3
      .zoom()
      .scaleExtent(SCALE_EXTENT)
      .on("zoom", (e) => g.attr("transform", e.transform));
    svg.call(zoom).on("dblclick.zoom", null);
    zoomRef.current = zoom;
    return () => svg.on(".zoom", null);
  }, []);

  const size = () => {
    const el = wrapRef.current;
    return { w: el?.clientWidth || 800, h: el?.clientHeight || 500 };
  };

  function fit(animate = true) {
    const root = rootRef.current;
    if (!root || !zoomRef.current) return;
    const nodes = root.descendants();
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const pad = 48;
    const minX = Math.min(...xs) - pad,
      maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad,
      maxY = Math.max(...ys) + pad;
    const { w, h } = size();
    const k = Math.max(SCALE_EXTENT[0], Math.min(1, w / (maxX - minX), h / (maxY - minY)));
    const t = d3.zoomIdentity.translate(w / 2 - (k * (minX + maxX)) / 2, Math.max(16, h / 2 - (k * (minY + maxY)) / 2)).scale(k);
    const svg = d3.select(svgRef.current);
    (animate ? svg.transition().duration(160) : svg).call(zoomRef.current.transform, t);
  }

  function panTo(key) {
    const root = rootRef.current;
    const n = root?.descendants().find((d) => d.data.key === key);
    if (!n) return;
    const svg = d3.select(svgRef.current);
    const cur = d3.zoomTransform(svgRef.current);
    const { w, h } = size();
    svg
      .transition()
      .duration(160)
      .call(zoomRef.current.transform, d3.zoomIdentity.translate(w / 2 - cur.k * n.x, h / 2 - cur.k * n.y).scale(cur.k));
  }

  /** Pan (keeping the zoom) just enough that the node is inside the view,
      leaving `bottom` px free at the bottom (the touch action bar). */
  function reveal(key, bottom = 0) {
    const n = rootRef.current?.descendants().find((d) => d.data.key === key);
    if (!n) return;
    const cur = d3.zoomTransform(svgRef.current);
    const { w, h } = size();
    const [sx, sy] = cur.apply([n.x, n.y]);
    const pad = 48;
    const dx = sx < pad ? pad - sx : sx > w - pad ? w - pad - sx : 0;
    const dy = sy < pad ? pad - sy : sy > h - bottom - pad ? h - bottom - pad - sy : 0;
    if (!dx && !dy) return;
    d3.select(svgRef.current).transition().duration(200).call(zoomRef.current.transform, cur.translate(dx / cur.k, dy / cur.k));
  }

  const zoomBy = (f) => d3.select(svgRef.current).transition().duration(140).call(zoomRef.current.scaleBy, f);

  useImperativeHandle(ref, () => ({ fit: () => fit(true), zoomIn: () => zoomBy(1.25), zoomOut: () => zoomBy(0.8), panTo, reveal }));

  // Draw the tree whenever its data, collapse state, spacing or label
  // settings change. Nodes are joined by key so expanding, collapsing,
  // adding and removing nodes animate from / to their parent.
  const posRef = useRef(new Map()); // key → {x, y} of the last drawn layout
  const drawnFor = useRef(null);
  useEffect(() => {
    const g = d3.select(gRef.current);
    setTip(null);
    if (!tree?.root) {
      g.selectAll("*").remove();
      rootRef.current = null;
      posRef.current = new Map();
      return;
    }
    const fresh = drawnFor.current !== viewId;
    drawnFor.current = viewId;
    if (fresh) {
      g.selectAll("*").remove();
      posRef.current = new Map();
    }
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const dur = fresh || reduce ? 0 : ANIM_MS;

    const isClosed = (d) => !!collapsed?.has(d.key) && d.children.length > 0;
    const root = d3.hierarchy(tree.root, (d) => (isClosed(d) ? null : d.children));
    // Neighbours that show a name get enough room for it, so labels never
    // overlap; unlabelled steps stay as tight as the spacing setting says.
    const labelled = (d) => !labelTypes || labelTypes.has(d.data.type) || isClosed(d.data);
    const halfWidth = (d) => (labelled(d) ? Math.min(150, (d.data.name || d.data.type).length * 3.4 + 6) : R + 4) + (isClosed(d.data) ? 14 : 0);
    const sx = Math.max(spacing.x, 6);
    d3.tree()
      .nodeSize([sx, Math.max(spacing.y, 20)])
      .separation((a, b) => Math.max(a.parent === b.parent ? 1 : 1.2, (halfWidth(a) + halfWidth(b) + 6) / sx))(root);
    rootRef.current = root;

    const prev = posRef.current;
    const next = new Map(root.descendants().map((d) => [d.data.key, { x: d.x, y: d.y }]));
    // Where a node appears from / disappears to: its nearest ancestor that is
    // drawn in the given layout.
    const anchor = (key, layout) => {
      let n = tree.byKey.get(key);
      while (n) {
        if (n.key !== key && layout.has(n.key)) return layout.get(n.key);
        n = n.parentKey ? tree.byKey.get(n.parentKey) : null;
      }
      return layout.get(key) || layout.get("__root__") || { x: 0, y: 0 };
    };
    const at = (p) => `translate(${p.x},${p.y})`;
    const linkPath = d3.linkVertical().x((d) => d.x).y((d) => d.y);
    const flat = (p) => linkPath({ source: p, target: p });
    const tx = (sel) => (dur ? sel.transition().duration(dur).ease(d3.easeCubicOut) : sel);

    let linkLayer = g.select("g.bt-links");
    if (linkLayer.empty()) linkLayer = g.append("g").attr("class", "bt-links");
    let nodeLayer = g.select("g.bt-nodes");
    if (nodeLayer.empty()) nodeLayer = g.append("g").attr("class", "bt-nodes");

    /* links (keyed by the child) */
    const links = linkLayer.selectAll("path.bt-link").data(root.links(), (l) => l.target.data.key);
    links.exit().interrupt().call((ex) =>
      tx(ex).attr("d", (l) => flat(anchor(l.target.data.key, next))).style("opacity", 0).remove()
    );
    const linkEnter = links
      .enter()
      .append("path")
      .attr("class", "bt-link")
      .attr("d", (l) => flat(prev.get(l.source.data.key) || anchor(l.target.data.key, prev)))
      .style("opacity", 0);
    tx(linkEnter.merge(links).interrupt()).attr("d", linkPath).style("opacity", 1);

    /* nodes */
    const nodes = nodeLayer.selectAll("g.bt-node").data(root.descendants(), (d) => d.data.key);
    nodes
      .exit()
      .interrupt()
      .classed("bt-node", false)
      .classed("bt-node-exit", true)
      .call((ex) => tx(ex).attr("transform", function () {
        return at(anchor(this.getAttribute("data-key"), next));
      }).style("opacity", 0).remove());
    const enter = nodes
      .enter()
      .append("g")
      .attr("data-key", (d) => d.data.key)
      .attr("transform", (d) => at(prev.get(d.data.key) || anchor(d.data.key, prev)))
      .style("opacity", 0);
    const node = enter.merge(nodes);
    node.interrupt();
    node.attr("class", (d) => `bt-node${readOnly ? "" : " is-interactive"}`);
    tx(node).attr("transform", (d) => `translate(${d.x},${d.y})`).style("opacity", 1);
    posRef.current = next;

    node.each(function (d) {
      const el = d3.select(this);
      el.selectAll("*").remove();
      const kind = kindOf(d.data.type, lib);
      const shape = d.depth === 0 ? "root" : KINDS[kind].shape;
      const color = colorOf(d.data.type, lib);
      const closed = isClosed(d.data);
      el.classed("is-collapsed", closed).classed(`shape-${shape}`, true);
      // Finger-sized hit area; only takes pointer events in touch mode (CSS).
      el.append("circle").attr("class", "bt-hit").attr("r", R * 2.2);
      if (closed) {
        // A second shape peeking out behind: "there is more inside".
        el.append("path").attr("class", "bt-stack").attr("d", shapePath(shape, R)).attr("transform", "translate(4,4)").attr("fill", color);
      }
      el.append("path").attr("class", "bt-shape").attr("d", shapePath(shape, R)).attr("fill", color);
      if (shape === "folder") el.append("path").attr("class", "bt-glyph").attr("d", `M${-R * 0.55},${R * 0.25}H${R * 0.55}`);
      el.append("text")
        .attr("class", "bt-label")
        .attr("dy", -R - 8)
        .attr("text-anchor", "middle")
        .text(d.data.name || d.data.type);

      const kids = d.data.children.length;
      if (kids && cb.current.canToggle) {
        const knob = el
          .append("g")
          .attr("class", "bt-knob")
          .attr("transform", `translate(0,${R + 11})`)
          .on("click", (e) => {
            e.stopPropagation();
            cb.current.onToggle?.(d.data.key);
          })
          .on("dblclick", (e) => e.stopPropagation())
          .on("mouseenter", (e) => e.stopPropagation());
        knob.append("title").text(closed ? `Expand (${countNodes(d.data) - 1} inside)` : "Collapse");
        knob.append("circle").attr("r", 6.5);
        knob.append("path").attr("d", closed ? "M-3,0H3M0,-3V3" : "M-3,0H3");
        if (closed) {
          const label = `+${countNodes(d.data) - 1}`;
          const w = 8 + label.length * 6.2;
          const badge = el.append("g").attr("class", "bt-count").attr("transform", `translate(${R + 5},${-R - 2})`);
          badge.append("rect").attr("width", w).attr("height", 15).attr("rx", 7.5).attr("fill", color);
          badge.append("text").attr("x", w / 2).attr("y", 11).attr("text-anchor", "middle").text(label);
        }
      }
    });
    node.classed("show-label", (d) => !labelTypes || labelTypes.has(d.data.type) || isClosed(d.data));

    node
      .on("click", (e, d) => {
        if (cb.current.readOnly) return;
        e.stopPropagation();
        cb.current.onSelect?.(d.data.key);
      })
      .on("dblclick", (e, d) => {
        if (cb.current.readOnly) return;
        e.stopPropagation();
        if (d.data.children.length && cb.current.canToggle) cb.current.onToggle?.(d.data.key);
        else cb.current.onActivate?.(d.data.key);
      })
      .on("contextmenu", (e, d) => {
        if (cb.current.readOnly) return;
        e.preventDefault();
        e.stopPropagation();
        // A long press on touch screens is handled by the hold gesture below.
        if (touchedRecently()) return;
        cb.current.onContextMenu?.(d.data.key, e.clientX, e.clientY);
      })
      .on("mouseenter", (e, d) => {
        if (touchedRecently()) return;
        const r = wrapRef.current.getBoundingClientRect();
        setTip({ x: e.clientX - r.left, y: e.clientY - r.top, node: d.data });
      })
      .on("mousemove", (e) => {
        const r = wrapRef.current.getBoundingClientRect();
        setTip((t) => (t ? { ...t, x: e.clientX - r.left, y: e.clientY - r.top } : t));
      })
      .on("mouseleave", () => setTip(null));

    if (!readOnly) {
      // Drag a node onto a sibling: move it right after that sibling
      // (hold Shift while dropping to swap the two instead).
      let moved = false;
      let target = null;
      const drag = d3
        .drag()
        .clickDistance(5)
        // Mouse only: on touch, a finger moving over a node pans the view;
        // moving a node starts with a hold (see the touch gesture below).
        .filter((e, d) => d.depth > 0 && !e.button && e.type !== "touchstart" && !e.target.closest?.(".bt-knob"))
        .on("start", () => {
          moved = false;
          target = null;
        })
        .on("drag", function (e, d) {
          if (!moved && Math.hypot(e.x - d.x, e.y - d.y) < 6) return;
          if (!moved) {
            moved = true;
            setTip(null);
            d3.select(this).interrupt().raise().classed("is-dragging", true);
          }
          d3.select(this).attr("transform", `translate(${e.x},${e.y})`);
          let best = null;
          let bestDist = 44;
          for (const s of d.parent.children) {
            if (s === d) continue;
            const dist = Math.hypot(s.x - e.x, s.y - e.y);
            if (dist < bestDist) {
              bestDist = dist;
              best = s;
            }
          }
          target = best;
          node.classed("is-drop-target", (n) => n === best);
        })
        .on("end", function (e, d) {
          d3.select(this).classed("is-dragging", false).attr("transform", `translate(${d.x},${d.y})`);
          node.classed("is-drop-target", false);
          if (!moved) return;
          if (target) cb.current.onDrop?.(d.data.key, target.data.key, !!e.sourceEvent?.shiftKey);
          else cb.current.onDrop?.(d.data.key, null, false);
        });
      node.call(drag);
    }

    if (fittedFor.current !== viewId) {
      fittedFor.current = viewId;
      fit(false);
    }
    setVersion((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, collapsed, spacing.x, spacing.y, labelTypes, lib, readOnly, viewId]);

  // Touch: a tap selects (through the click it produces) and a finger moving
  // over a node pans the view as usual. Holding a node for a moment picks it
  // up: drag it onto a sibling to move it after that sibling, or lift the
  // finger without moving to open the node's action menu. Mouse input never
  // goes through here.
  useEffect(() => {
    const svg = svgRef.current;
    const HOLD_MS = 450;
    const SLOP = 10; // px a finger may wobble before a hold becomes a pan
    const EDGE = 48; // px from the edge where a carried node scrolls the view
    const LIFT = 36; // px the carried node floats above the finger
    let g = null; // the gesture in progress

    const nodesSel = () => d3.select(gRef.current).selectAll("g.bt-node");
    const reset = () => {
      if (!g) return;
      clearTimeout(g.timer);
      cancelAnimationFrame(g.raf);
      if (g.armed) {
        d3.select(g.el).classed("is-lifted", false).classed("is-dragging", false).attr("transform", `translate(${g.d.x},${g.d.y})`);
        nodesSel().classed("is-drop-target", false);
      }
      g = null;
    };
    // Carry the node just above the finger (so it stays visible) and find
    // the sibling it is over.
    const place = () => {
      const [x, y] = d3.zoomTransform(svg).invert(d3.pointer({ clientX: g.cx, clientY: g.cy - LIFT }, svg));
      d3.select(g.el).attr("transform", `translate(${x},${y})`);
      const k = d3.zoomTransform(svg).k;
      let best = null;
      let bestDist = Math.max(44, 56 / k);
      for (const s of g.d.parent.children) {
        if (s === g.d) continue;
        const dist = Math.hypot(s.x - x, s.y - y);
        if (dist < bestDist) {
          bestDist = dist;
          best = s;
        }
      }
      g.target = best;
      nodesSel().classed("is-drop-target", (n) => n === best);
    };
    // Carrying a node to the edge of the view scrolls the view.
    const edgeScroll = () => {
      if (!g?.moved) return;
      const r = svg.getBoundingClientRect();
      const dx = g.cx < r.left + EDGE ? 1 : g.cx > r.right - EDGE ? -1 : 0;
      const dy = g.cy < r.top + EDGE ? 1 : g.cy > r.bottom - EDGE ? -1 : 0;
      if (dx || dy) {
        const k = d3.zoomTransform(svg).k;
        d3.select(svg).call(zoomRef.current.translateBy, (dx * 8) / k, (dy * 8) / k);
        place();
      }
      g.raf = requestAnimationFrame(edgeScroll);
    };

    const start = (e) => {
      lastTouch.current = Date.now();
      if (e.touches.length !== 1) return reset(); // second finger: pinch zoom
      if (cb.current.readOnly) return;
      const el = e.target.closest?.("g.bt-node");
      if (!el || e.target.closest(".bt-knob")) return;
      const t = e.touches[0];
      g = { el, d: d3.select(el).datum(), x0: t.clientX, y0: t.clientY, cx: t.clientX, cy: t.clientY, armed: false, moved: false, target: null };
      g.timer = setTimeout(() => {
        if (!g) return;
        g.armed = true;
        setTip(null);
        d3.select(el).interrupt().raise().classed("is-lifted", true);
        navigator.vibrate?.(15);
      }, HOLD_MS);
    };
    const move = (e) => {
      lastTouch.current = Date.now();
      if (!g) return;
      const t = e.touches[0];
      if (!g.armed) {
        if (e.touches.length > 1 || Math.hypot(t.clientX - g.x0, t.clientY - g.y0) > SLOP) reset();
        return;
      }
      // The node is picked up: the view must not pan under the finger.
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      g.cx = t.clientX;
      g.cy = t.clientY;
      if (!g.d.parent) return; // the root can be held for its menu, not moved
      if (!g.moved && Math.hypot(g.cx - g.x0, g.cy - g.y0) < SLOP) return;
      if (!g.moved) {
        g.moved = true;
        d3.select(g.el).classed("is-dragging", true);
        g.raf = requestAnimationFrame(edgeScroll);
      }
      place();
    };
    const end = (e) => {
      lastTouch.current = Date.now();
      if (!g || e.touches.length) return;
      if (!g.armed) {
        clearTimeout(g.timer);
        g = null;
        return;
      }
      // Lets d3-zoom see the end (it keeps its own touch list) but stops the
      // click and emulated mouse events a tap would produce.
      if (e.cancelable) e.preventDefault();
      const { d, moved, target, cx, cy } = g;
      reset();
      if (moved) cb.current.onDrop?.(d.data.key, target ? target.data.key : null, false);
      else cb.current.onContextMenu?.(d.data.key, cx, cy);
    };

    const opt = { capture: true, passive: false };
    svg.addEventListener("touchstart", start, { capture: true, passive: true });
    svg.addEventListener("touchmove", move, opt);
    svg.addEventListener("touchend", end, opt);
    svg.addEventListener("touchcancel", reset, opt);
    return () => {
      reset();
      svg.removeEventListener("touchstart", start, { capture: true });
      svg.removeEventListener("touchmove", move, opt);
      svg.removeEventListener("touchend", end, opt);
      svg.removeEventListener("touchcancel", reset, opt);
    };
  }, []);

  // Selection and search highlight (no re-layout).
  useEffect(() => {
    const nodes = d3.select(gRef.current).selectAll("g.bt-node");
    nodes
      .classed("is-selected", (d) => d.data.key === selectedKey)
      .classed("is-match", (d) => !!matchKeys?.has(d.data.key))
      .classed("is-focus", (d) => d.data.key === focusKey);
  }, [selectedKey, matchKeys, focusKey, version]);

  // Live program state: running node(s), last failure, breakpoint (matched by node name).
  useEffect(() => {
    const nameOf = (d) => d.data.name || d.data.type;
    d3.select(gRef.current)
      .selectAll("g.bt-node")
      .classed("is-running", (d) => !!runningNames?.has(nameOf(d)))
      .classed("is-failed", (d) => !!failedName && nameOf(d) === failedName)
      .classed("is-break", (d) => !!breakName && nameOf(d) === breakName);
  }, [runningNames, failedName, breakName, version]);

  // Validation problems (errors red, warnings amber, the shown one thicker).
  useEffect(() => {
    d3.select(gRef.current)
      .selectAll("g.bt-node")
      .classed("has-err", (d) => marks?.get(d.data.key) === "e")
      .classed("has-warn", (d) => marks?.get(d.data.key) === "w")
      .classed("is-err-focus", (d) => !!markFocus && d.data.key === markFocus);
  }, [marks, markFocus, version]);

  useEffect(() => {
    if (focusKey) panTo(focusKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  // If the tree was first drawn while the panel had no size (hidden view,
  // modal still opening), fit it once the panel gets a real size.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let wasEmpty = el.clientWidth < 10 || el.clientHeight < 10;
    const ro = new ResizeObserver(() => {
      const empty = el.clientWidth < 10 || el.clientHeight < 10;
      if (wasEmpty && !empty && rootRef.current) fit(false);
      wasEmpty = empty;
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="bt-canvas" ref={wrapRef} onClick={() => !readOnly && onSelect?.(null)}>
      <svg ref={svgRef} className="bt-svg" role="img" aria-label="Behaviour tree diagram">
        <g ref={gRef} />
      </svg>
      {tip && <NodeTip tip={tip} lib={lib} host={wrapRef.current} />}
    </div>
  );
});

function NodeTip({ tip, lib, host }) {
  const attrs = visibleAttrs(tip.node.attributes).filter(([k]) => k !== "name");
  const w = host?.clientWidth || 800;
  const left = Math.min(tip.x + 14, w - 270);
  return (
    <div className="bt-tip" style={{ left: Math.max(4, left), top: tip.y + 14 }}>
      <div className="bt-tip-head">
        <span className="bt-swatch" style={{ background: colorOf(tip.node.type, lib) }} />
        <strong className="truncate">{tip.node.name}</strong>
      </div>
      <div className="xs muted">{tip.node.type}</div>
      {attrs.length > 0 && (
        <div className="bt-tip-attrs">
          {attrs.slice(0, 8).map(([k, v]) => (
            <div key={k} className="bt-tip-row">
              <span className="muted">{k}</span>
              <span className="truncate">{String(v) || "—"}</span>
            </div>
          ))}
          {attrs.length > 8 && <div className="xs muted">+{attrs.length - 8} more</div>}
        </div>
      )}
    </div>
  );
}

export default TreeCanvas;
