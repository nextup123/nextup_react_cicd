// Hover help for the Motion Programs page. <Tip text> shows a small card next
// to its child after a short hover (or on keyboard focus); <InfoTip> is the
// (i) icon that does the same and also opens on a tap (touch screens).
import { cloneElement, isValidElement, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

const DELAY = 280;

function TipCard({ anchor, title, text, extra }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useEffect(() => {
    const a = anchor.getBoundingClientRect();
    const el = ref.current;
    const w = el?.offsetWidth || 280;
    const h = el?.offsetHeight || 60;
    let top = a.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, a.top - h - 6);
    let left = a.left + a.width / 2 - w / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    setPos({ top, left });
  }, [anchor]);
  return createPortal(
    <div ref={ref} className="mp-tip" role="tooltip" style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden", top: 0, left: 0 }}>
      {title && <div className="mp-tip-title">{title}</div>}
      <div>{text}</div>
      {extra}
    </div>,
    document.body
  );
}

function useTip() {
  const [anchor, setAnchor] = useState(null);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    anchor,
    show: (el, now) => {
      clearTimeout(timer.current);
      if (now) setAnchor(el);
      else timer.current = setTimeout(() => setAnchor(el), DELAY);
    },
    hide: () => {
      clearTimeout(timer.current);
      setAnchor(null);
    },
  };
}

/** Wraps one element; the tip opens on hover / focus. */
export function Tip({ text, title, extra, children, disabled }) {
  const t = useTip();
  if (!text || disabled || !isValidElement(children)) return children;
  const child = cloneElement(children, {
    onMouseEnter: (e) => {
      children.props.onMouseEnter?.(e);
      t.show(e.currentTarget);
    },
    onMouseLeave: (e) => {
      children.props.onMouseLeave?.(e);
      t.hide();
    },
    onFocus: (e) => {
      children.props.onFocus?.(e);
      if (e.currentTarget.matches(":focus-visible")) t.show(e.currentTarget, true);
    },
    onBlur: (e) => {
      children.props.onBlur?.(e);
      t.hide();
    },
    onPointerDown: (e) => {
      children.props.onPointerDown?.(e);
      t.hide();
    },
  });
  return (
    <>
      {child}
      {t.anchor && <TipCard anchor={t.anchor} title={title} text={text} extra={extra} />}
    </>
  );
}

/** (i) icon with a tip; a tap toggles it on touch screens. */
export function InfoTip({ text, title }) {
  const t = useTip();
  const ref = useRef(null);
  useEffect(() => {
    if (!t.anchor) return;
    const close = (e) => !ref.current?.contains(e.target) && t.hide();
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [t.anchor]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!text) return null;
  return (
    <>
      <span
        ref={ref}
        className="mp-info"
        tabIndex={0}
        aria-label={title ? `About ${title}` : "Help"}
        onMouseEnter={(e) => t.show(e.currentTarget)}
        onMouseLeave={t.hide}
        onFocus={(e) => t.show(e.currentTarget, true)}
        onBlur={t.hide}
        onClick={(e) => (t.anchor ? t.hide() : t.show(e.currentTarget, true))}
      >
        <Info size={13} />
      </span>
      {t.anchor && <TipCard anchor={t.anchor} title={title} text={text} />}
    </>
  );
}

/** Field label with its (i) tip. */
export function TipLabel({ label, tip, children, htmlFor }) {
  return (
    <label className="field-label mp-label" htmlFor={htmlFor}>
      <span>{label}</span>
      <InfoTip title={label} text={tip} />
      {children}
    </label>
  );
}
