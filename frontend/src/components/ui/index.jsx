// Shared UI building blocks. Every page composes these so the app looks and
// behaves the same everywhere. Styles live in src/styles/components.css.
import { forwardRef, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Info, Inbox, Search, X, XCircle } from "lucide-react";
import { useConfirmStore } from "../../store/confirm";
import { useToasts, toast } from "../../store/toast";
import { plainText } from "../../lib/plainText";

const cx = (...c) => c.filter(Boolean).join(" ");
export { cx };

/* ───────────── Button ───────────── */
export const Button = forwardRef(function Button(
  { variant = "default", size, icon: Icon, iconRight: IconRight, loading, block, active, className, children, type = "button", ...rest },
  ref
) {
  const iconSize = size === "sm" ? 14 : size === "lg" || size === "xl" ? 18 : 16;
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        "btn",
        variant !== "default" && `btn-${variant}`,
        size && `btn-${size}`,
        block && "btn-block",
        active && "is-active",
        !children && "btn-icon",
        className
      )}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading ? <span className="spinner" style={{ width: iconSize - 2, height: iconSize - 2 }} /> : Icon && <Icon size={iconSize} />}
      {children}
      {IconRight && <IconRight size={iconSize} />}
    </button>
  );
});

/** Square icon-only button; always give it a `label` for screen readers and the tooltip. */
export function IconButton({ icon: Icon, label, variant = "ghost", size, className, ...rest }) {
  return (
    <Button variant={variant} size={size} className={className} title={label} aria-label={label} icon={Icon} {...rest} />
  );
}

/* ───────────── Card ───────────── */
export function Card({ title, subtitle, icon: Icon, actions, children, className, bodyClassName, flush, footer, headerBorder = true, style, tut }) {
  const hasHeader = title || actions;
  return (
    <section className={cx("card", className)} style={style} data-tut={tut}>
      {hasHeader && (
        <header className={cx("card-header", !headerBorder && "no-border")}>
          {title && (
            <div className="card-title">
              {Icon && <Icon size={18} />}
              <div className="col" style={{ gap: 0, minWidth: 0 }}>
                <span className="truncate">{title}</span>
                {subtitle && <span className="card-subtitle truncate">{subtitle}</span>}
              </div>
            </div>
          )}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={cx("card-body", flush && "flush", bodyClassName)}>{children}</div>
      {footer && <footer className="card-footer">{footer}</footer>}
    </section>
  );
}

/* ───────────── Form fields ───────────── */
export function Field({ label, hint, error, icon: Icon, children, className, htmlFor, span2 }) {
  return (
    <div className={cx("field", span2 && "span-2", className)}>
      {label && (
        <label className="field-label" htmlFor={htmlFor}>
          {Icon && <Icon size={14} className="muted" />}
          {label}
        </label>
      )}
      {children}
      {error ? <span className="field-error">{error}</span> : hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

export const Input = forwardRef(function Input({ className, size, invalid, ...rest }, ref) {
  return <input ref={ref} className={cx("input", size === "sm" && "input-sm", invalid && "is-invalid", className)} {...rest} />;
});

export const Textarea = forwardRef(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx("textarea", className)} {...rest} />;
});

/**
 * <Select options={[{value, label}] | ["a","b"]} placeholder="Select…" />
 * Children can be passed instead of options.
 */
export const Select = forwardRef(function Select({ options, placeholder, className, size, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx("select", size === "sm" && "input-sm", className)} {...rest}>
      {placeholder !== undefined && (
        <option value="" disabled={rest.required}>
          {placeholder}
        </option>
      )}
      {options
        ? options.map((o) => {
            const opt = typeof o === "object" ? o : { value: o, label: o };
            return (
              <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                {opt.label}
              </option>
            );
          })
        : children}
    </select>
  );
});

export function SearchInput({ value, onChange, placeholder = "Search…", className, style, size }) {
  return (
    <div className={cx("search-input", className)} style={style}>
      <Search size={15} />
      <Input size={size} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

export function Checkbox({ label, checked, onChange, disabled, className }) {
  return (
    <label className={cx("checkbox", className)} style={disabled ? { opacity: 0.55, cursor: "not-allowed" } : undefined}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)} />
      {label}
    </label>
  );
}

export function Switch({ checked, onChange, label, disabled, size, tone, title, className }) {
  return (
    <label className={cx("switch", size === "sm" && "switch-sm", tone === "success" && "is-success", className)} title={title}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)} />
      <span className="switch-track" />
      {label && <span className="switch-label">{label}</span>}
    </label>
  );
}

/** options: [{ value, label, icon?, disabled? }] */
export function Segmented({ options, value, onChange, block, size, disabled, className, ariaLabel }) {
  return (
    <div className={cx("segmented", block && "is-block", size === "lg" && "segmented-lg", className)} role="tablist" aria-label={ariaLabel}>
      {options.map((o) => {
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={value === o.value}
            className={cx(value === o.value && "is-active")}
            disabled={disabled || o.disabled}
            onClick={() => value !== o.value && onChange?.(o.value)}
            title={o.title}
          >
            {Icon && <Icon size={14} style={{ marginRight: 5, verticalAlign: -2 }} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Tabs({ tabs, value, onChange, className }) {
  return (
    <div className={cx("tabs", className)} role="tablist">
      {tabs.map((t) => {
        const Icon = t.icon;
        return (
          <button key={t.value} role="tab" aria-selected={value === t.value} className={cx("tab", value === t.value && "is-active")} onClick={() => onChange(t.value)}>
            {Icon && <Icon size={15} />}
            {t.label}
            {t.count !== undefined && <span className="badge">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ───────────── Display ───────────── */
export function Badge({ tone, size, children, className, dot, ...rest }) {
  return (
    <span className={cx("badge", tone && `badge-${tone}`, size === "lg" && "badge-lg", className)} {...rest}>
      {dot && <span className={cx("dot", `dot-${dot === true ? tone || "primary" : dot}`)} style={{ width: 6, height: 6 }} />}
      {children}
    </span>
  );
}

export function StatusDot({ tone = "off", pulse, size, title }) {
  return <span className={cx("dot", `dot-${tone}`, pulse && "dot-pulse", size === "lg" && "dot-lg")} title={title} />;
}

export function EmptyState({ icon: Icon = Inbox, title, text, action, compact }) {
  return (
    <div className="empty" style={compact ? { padding: "20px 12px" } : undefined}>
      <span className="empty-icon">
        <Icon size={22} />
      </span>
      {title && <div className="empty-title">{title}</div>}
      {text && <div className="empty-text">{text}</div>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

export function Spinner({ size }) {
  return <span className={cx("spinner", size === "lg" && "spinner-lg")} />;
}

export function Loading({ label = "Loading…" }) {
  return (
    <div className="empty" style={{ padding: 28 }}>
      <Spinner size="lg" />
      <div className="small muted" style={{ marginTop: 6 }}>
        {label}
      </div>
    </div>
  );
}

export function Alert({ tone = "info", title, children, className, action }) {
  const Icon = tone === "danger" ? XCircle : tone === "warning" ? AlertTriangle : tone === "success" ? CheckCircle2 : Info;
  return (
    <div className={cx("alert", `alert-${tone}`, className)}>
      <Icon size={16} />
      <div className="grow">
        {title && <div className="strong">{title}</div>}
        {children}
      </div>
      {action}
    </div>
  );
}

export function Stat({ label, value, unit, hint, className }) {
  return (
    <div className={cx("stat", className)}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">
        {value}
        {unit && <span className="stat-unit">{unit}</span>}
      </span>
      {hint && <span className="xs muted">{hint}</span>}
    </div>
  );
}

export function Kbd({ children }) {
  return <kbd className="kbd">{children}</kbd>;
}

/* ───────────── Modal ───────────── */
export function Modal({ open, onClose, title, description, size, children, footer, closeOnOverlay = true, className, bodyClassName, overlayClassName, icon, tut }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className={cx("overlay", overlayClassName)} onMouseDown={(e) => closeOnOverlay && e.target === e.currentTarget && onClose?.()}>
      <div className={cx("modal", size && `modal-${size}`, className)} role="dialog" aria-modal="true" data-tut={tut}>
        {(title || onClose) && (
          <div className="modal-header">
            {icon}
            <div className="grow">
              {title && <div className="modal-title">{title}</div>}
              {description && <div className="modal-desc">{description}</div>}
            </div>
            {onClose && <IconButton icon={X} label="Close" onClick={onClose} className="modal-close" size="sm" />}
          </div>
        )}
        <div className={cx("modal-body", bodyClassName)}>{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

export function Drawer({ open, onClose, title, actions, children, width }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer" style={width ? { width } : undefined} role="dialog" aria-modal="true">
        <div className="drawer-header">
          <h3 className="grow">{title}</h3>
          {actions}
          <IconButton icon={X} label="Close" onClick={onClose} size="sm" />
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>,
    document.body
  );
}

/* ───────────── Confirm dialog host (see store/confirm.js) ───────────── */
export function ConfirmHost() {
  const current = useConfirmStore((s) => s.current);
  const [value, setValue] = useState("");
  const inputRef = useRef(null);
  const id = useId();

  useEffect(() => {
    if (current?.input) {
      setValue(current.input.defaultValue ?? "");
      setTimeout(() => inputRef.current?.select(), 30);
    }
  }, [current]);

  if (!current) return null;
  const close = (result) => {
    useConfirmStore.setState({ current: null });
    current.resolve(result);
  };
  const tone = current.tone || "primary";
  const Icon = tone === "danger" ? AlertTriangle : tone === "warning" ? AlertTriangle : Info;
  const submit = () => {
    if (current.input) {
      const v = value.trim();
      if (current.input.required !== false && !v) return;
      close(v);
    } else close(true);
  };

  return (
    <Modal
      open
      size="sm"
      onClose={() => close(current.input ? null : false)}
      title={current.title || "Are you sure?"}
      icon={<span className={cx("confirm-icon", tone === "danger" && "is-danger", tone === "warning" && "is-warning")}><Icon size={20} /></span>}
      footer={
        <>
          {current.cancelLabel !== false && (
            <Button onClick={() => close(current.input ? null : false)}>{current.cancelLabel || "Cancel"}</Button>
          )}
          <Button variant={tone === "danger" ? "danger" : tone === "warning" ? "warning" : "primary"} onClick={submit} autoFocus={!current.input} data-tut="confirm-ok">
            {current.confirmLabel || "Confirm"}
          </Button>
        </>
      }
    >
      {current.message && <div className="muted" style={{ whiteSpace: "pre-line" }}>{current.message}</div>}
      {current.input && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          style={{ marginTop: current.message ? 14 : 0 }}
        >
          <Field label={current.input.label} htmlFor={id} hint={current.input.hint}>
            <Input id={id} ref={inputRef} value={value} placeholder={current.input.placeholder} onChange={(e) => setValue(e.target.value)} />
          </Field>
        </form>
      )}
    </Modal>
  );
}

/* ───────────── Toast host (see store/toast.js) ───────────── */
const TOAST_ICONS = { success: CheckCircle2, error: XCircle, warning: AlertTriangle, info: Info };

export function ToastHost() {
  const items = useToasts((s) => s.items);
  return createPortal(
    <div className="toast-stack" aria-live="polite">
      {items.map((t) => {
        const Icon = TOAST_ICONS[t.kind] || Info;
        return (
          <div key={t.id} className={cx("toast", `toast-${t.kind}`)} role="status">
            <Icon size={18} className="toast-icon" />
            <div className="toast-body">
              {t.title && <div className="toast-title">{plainText(t.title)}</div>}
              <div className={t.title ? "toast-text" : undefined}>{plainText(t.message)}{t.count > 1 && <span className="toast-count"> ×{t.count}</span>}</div>
            </div>
            <IconButton icon={X} label="Dismiss" size="sm" onClick={() => toast.dismiss(t.id)} style={{ width: 24, height: 24 }} />
          </div>
        );
      })}
      {items.length > 1 && (
        <Button size="sm" className="toast-clear" onClick={toast.clear}>
          Clear all ({items.length})
        </Button>
      )}
    </div>,
    document.body
  );
}

/* ───────────── Small popover menu ───────────── */
/**
 * items: { label, icon, onClick, disabled, danger, checked, hint, title } | "-" | { header } | null (skipped)
 * floating: render the menu above the page (fixed, kept inside the window), for
 * triggers inside columns that clip overflow.
 */
export function Menu({ trigger, items, align = "right", className, floating = false }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => !ref.current?.contains(e.target) && !menuRef.current?.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !floating) return setPos(null);
    const place = () => {
      const r = ref.current?.getBoundingClientRect();
      const m = menuRef.current;
      if (!r || !m) return;
      const gap = 4, edge = 8, vw = window.innerWidth, vh = window.innerHeight;
      const w = m.offsetWidth;
      const left = Math.max(edge, Math.min(align === "left" ? r.left : r.right - w, vw - w - edge));
      const below = vh - r.bottom - gap - edge, above = r.top - gap - edge;
      const h = Math.min(m.scrollHeight, Math.max(below, above));
      const top = m.scrollHeight <= below || below >= above ? r.bottom + gap : r.top - gap - h;
      setPos({ left, top, maxHeight: h });
    };
    place();
    const shut = (e) => !menuRef.current?.contains(e.target) && setOpen(false);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", shut, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", shut, true);
    };
  }, [open, floating, align]);
  const list = (
    <div
      ref={menuRef}
      className={cx("menu", floating && "menu-floating", className)}
      style={floating ? { position: "fixed", left: pos?.left ?? 0, top: pos?.top ?? 0, maxHeight: pos?.maxHeight, visibility: pos ? "visible" : "hidden" } : { top: "calc(100% + 4px)", [align]: 0 }}
    >
      {items.filter(Boolean).map((it, i) =>
        it === "-" ? (
          <div key={i} className="menu-sep" />
        ) : it.header ? (
          <div key={i} className="menu-header">{it.header}</div>
        ) : (
          <button
            key={i}
            className={cx("menu-item", it.danger && "is-danger", it.checked && "is-checked")}
            disabled={it.disabled}
            title={it.title}
            data-tut={it.tut}
            onClick={() => {
              setOpen(false);
              it.onClick?.();
            }}
          >
            {it.icon ? <it.icon size={15} /> : it.checked !== undefined && <span className="menu-check" />}
            <span className="grow">{it.label}</span>
            {it.hint && <span className="menu-hint">{it.hint}</span>}
          </button>
        )
      )}
    </div>
  );
  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (floating ? createPortal(list, document.body) : list)}
    </div>
  );
}

/** Click-to-open panel anchored under its trigger. children may be a function (close) => node. */
export function Popover({ trigger, children, align = "right", className, width, wrapClassName }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div ref={ref} className={wrapClassName} style={{ position: "relative", display: "inline-flex" }}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div className={cx("menu popover", className)} style={{ top: "calc(100% + 6px)", [align]: 0, width }}>
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}

/* ───────────── Page scaffolding ───────────── */
/** Page title row shown at the top of each page, with optional actions on the right. */
export function PageHeader({ title, description, actions, children }) {
  return (
    <div className="page-header">
      <div className="grow" style={{ minWidth: 0 }}>
        <h1 className="truncate">{title}</h1>
        {description && <p className="muted small">{description}</p>}
      </div>
      {children}
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
