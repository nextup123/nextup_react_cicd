// Validation result as a small floating card: one problem at a time with
// Previous / Next, dragged anywhere inside the window by its header. Used by
// the Robot Program editor and the NexRoot runner; each page highlights the
// nodes and focuses the current one (onShow), this card only steps through.
//
// result.issues come from POST /robot/bt/runner/validate (backend
// ros/btIssues.js): { error, text, name, type, tree, idx, paths, inEditor }.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Crosshair, GripVertical, RefreshCw, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { Badge, Button, IconButton, cx } from "../ui";
import { plainText } from "../../lib/plainText";
import { robotApi } from "../../lib/robotApi";
import { toast } from "../../store/toast";
import "./validation.css";

const POS_KEY = "nextup.validation.pos";
const MARGIN = 8;

function readPos() {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY));
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return p;
  } catch {
    /* ignore */
  }
  return null;
}

const clamp = (p, el) => {
  const w = el?.offsetWidth || 360;
  const h = el?.offsetHeight || 180;
  return {
    x: Math.round(Math.min(Math.max(MARGIN, p.x), window.innerWidth - w - MARGIN)),
    y: Math.round(Math.min(Math.max(MARGIN, p.y), window.innerHeight - h - MARGIN)),
  };
};

/** Short "2 errors · 3 warnings". */
export function issueCounts(result) {
  const list = result?.issues || [];
  const e = list.filter((i) => i.error).length;
  const w = list.length - e;
  const part = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;
  return [e ? part(e, "error") : "", w ? part(w, "warning") : ""].filter(Boolean).join(" · ") || "No problems";
}

/**
 * Validate the main program (the tree the runner loads) and keep the answer:
 * { result, issues (the ones stepped through), pos, setPos, busy, run, close,
 *   showWarnings, setShowWarnings }. Errors only while there are errors;
 * warnings too on request, or when they are all there is.
 */
export function useValidation() {
  const [result, setResult] = useState(null);
  const [pos, setPos] = useState(0);
  const [busy, setBusy] = useState(false);
  const [showWarnings, setShowWarnings] = useState(false);
  const run = useCallback(async () => {
    setBusy(true);
    try {
      const r = await robotApi.runnerValidateMain();
      if (!Array.isArray(r?.issues)) {
        toast.error(plainText(r?.message) || "The program runner did not answer", { title: "Validate" });
        return null;
      }
      const errors = r.issues.filter((i) => i.error).length;
      if (!errors) toast.success(r.issues.length ? `No errors · ${r.issues.length} warning${r.issues.length === 1 ? "" : "s"}` : "No problems found", { title: "Program checked" });
      setResult(r.issues.length ? r : null);
      setPos(0);
      return r;
    } catch (err) {
      toast.error(plainText(err.message), { title: "Validate" });
      return null;
    } finally {
      setBusy(false);
    }
  }, []);
  const issues = useMemo(() => {
    const all = result?.issues || [];
    const errs = all.filter((i) => i.error);
    return showWarnings || !errs.length ? all : errs;
  }, [result, showWarnings]);
  const close = useCallback(() => setResult(null), []);
  const toggleWarnings = useCallback((v) => {
    setShowWarnings(v);
    setPos(0);
  }, []);
  return { result, issues, pos, setPos, busy, run, close, showWarnings, setShowWarnings: toggleWarnings };
}

/**
 * result   validation answer · issues  the ones stepped through (errors first)
 * pos      index of the shown issue · onPos(i) moves to another one
 * where(issue) → "" when the page can show the node, else why not (shown under the text)
 * onShow   focus the current node again · onRecheck run the validation again
 */
export default function ValidationPopup({ result, issues = [], pos, onPos, where, onShow, onRecheck, rechecking, onClose, showWarnings, onShowWarnings, title = "Validation" }) {
  const ref = useRef(null);
  const [xy, setXy] = useState(readPos);
  const n = issues.length;
  const cur = n ? issues[((pos % n) + n) % n] : null;
  const reason = cur && where ? where(cur) : "";

  // first open: low in the middle (clear of the toolbars and the node editor); keep it inside the window
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setXy((p) => clamp(p || { x: (window.innerWidth - el.offsetWidth) / 2 + 110, y: window.innerHeight - el.offsetHeight - 96 }, el));
  }, []);
  useEffect(() => {
    const onResize = () => setXy((p) => (p ? clamp(p, ref.current) : p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !document.querySelector(".overlay")) onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const drag = useRef(null);
  const onDown = (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    const box = ref.current.getBoundingClientRect();
    drag.current = { dx: e.clientX - box.left, dy: e.clientY - box.top };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onMove = (e) => {
    if (!drag.current) return;
    setXy(clamp({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }, ref.current));
  };
  const onUp = (e) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setXy((p) => {
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(p));
      } catch {
        /* ignore */
      }
      return p;
    });
  };

  const errors = (result?.issues || []).filter((i) => i.error).length;
  const warnings = (result?.issues?.length || 0) - errors;
  const ok = errors === 0;
  return createPortal(
    <div
      ref={ref}
      className={cx("vp", ok ? (n ? "is-warn" : "is-ok") : "is-err")}
      style={xy ? { left: xy.x, top: xy.y } : { visibility: "hidden" }}
      role="dialog"
      aria-label={title}
    >
      <div className="vp-head" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} title="Drag to move">
        <GripVertical size={14} className="vp-grip" />
        {ok ? <ShieldCheck size={16} className="vp-icon" /> : <ShieldAlert size={16} className="vp-icon" />}
        <strong className="truncate">{title}</strong>
        <span className="xs vp-counts">{issueCounts(result)}</span>
        <span className="grow" />
        {onRecheck && <IconButton icon={RefreshCw} size="sm" label="Check again" disabled={rechecking} onClick={onRecheck} />}
        <IconButton icon={X} size="sm" label="Close (Esc)" onClick={onClose} />
      </div>
      {cur ? (
        <div className="vp-body">
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <Badge tone={cur.error ? "danger" : "warning"}>{cur.error ? "Error" : "Warning"}</Badge>
            <span className="xs muted">
              {((pos % n) + n) % n + 1} of {n}
            </span>
          </div>
          {cur.name && (
            <div className="vp-node">
              <button type="button" className="vp-node-name truncate" onClick={() => onShow?.(cur)} disabled={Boolean(reason)} title={reason ? "" : "Show this node"}>
                {cur.name}
              </button>
              {cur.type && cur.type !== cur.name && <span className="xs muted">{cur.type}</span>}
              {cur.tree && cur.tree !== cur.name && <span className="xs muted">· in {cur.tree}</span>}
            </div>
          )}
          <div className="vp-text">{plainText(cur.text)}</div>
          {reason && <div className="xs muted">{reason}</div>}
        </div>
      ) : (
        <div className="vp-body">
          <div className="vp-text">{plainText(result?.summary) || "The program has no problems."}</div>
        </div>
      )}
      {n > 0 && (
        <div className="vp-foot">
          <Button size="sm" icon={ChevronLeft} onClick={() => onPos(pos - 1)} disabled={n < 2}>
            Previous
          </Button>
          {errors > 0 && warnings > 0 && onShowWarnings ? (
            <label className="vp-check xs" title="Step through the warnings too">
              <input type="checkbox" checked={Boolean(showWarnings)} onChange={(e) => onShowWarnings(e.target.checked)} /> Warnings
            </label>
          ) : null}
          <IconButton icon={Crosshair} size="sm" label="Show this node again" onClick={() => onShow?.(cur)} disabled={Boolean(reason)} />
          <Button size="sm" iconRight={ChevronRight} variant="primary" onClick={() => onPos(pos + 1)} disabled={n < 2}>
            Next
          </Button>
        </div>
      )}
    </div>,
    document.body
  );
}
