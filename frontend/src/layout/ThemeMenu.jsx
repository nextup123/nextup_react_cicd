// Theme window: accent colour + mode (light / gray / dark / follow computer).
// Every pick applies at once and is saved on the robot (lib/theme.js).
import { Check, Monitor, Moon, RotateCcw, ShieldCheck, Sun, SunDim } from "lucide-react";
import { Button, Modal, cx } from "../components/ui";
import { ACCENTS, DEFAULT_THEME, MODES, resolveMode, setTheme, useTheme } from "../lib/theme";

const MODE_TILES = [
  { id: "light", label: "Light", icon: Sun, hint: "Bright and crisp" },
  { id: "gray", label: "Gray", icon: SunDim, hint: "Low glare, no white" },
  { id: "dark", label: "Dark", icon: Moon, hint: "Dim rooms, night shift" },
  { id: "auto", label: "Auto", icon: Monitor, hint: "Follows this computer" },
];

function ModePreview({ mode }) {
  // Two halves for "auto": light on the left, dark on the right.
  return (
    <span className={cx("tm-preview", `is-${mode}`)} aria-hidden="true">
      <span className="tm-pv-side" />
      <span className="tm-pv-main">
        <span className="tm-pv-bar" />
        <span className="tm-pv-card">
          <span className="tm-pv-line" />
          <span className="tm-pv-line is-short" />
          <span className="tm-pv-btn" />
        </span>
      </span>
    </span>
  );
}

export function ThemeMenu({ open, onClose }) {
  const theme = useTheme();
  const isDefault = theme.accent === DEFAULT_THEME.accent && theme.mode === DEFAULT_THEME.mode;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Theme"
      description="Changes apply at once and are saved on the robot, so every browser opens the same."
      overlayClassName="is-light"
      className="tm-modal"
      footer={
        <>
          <Button variant="ghost" icon={RotateCcw} disabled={isDefault} onClick={() => setTheme(DEFAULT_THEME)}>
            Default
          </Button>
          <span className="spacer" />
          <Button variant="primary" onClick={onClose}>Done</Button>
        </>
      }
    >
      <div className="tm-section">
        <div className="tm-label">Mode</div>
        <div className="tm-modes" role="radiogroup" aria-label="Mode">
          {MODE_TILES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={theme.mode === m.id}
              className={cx("tm-mode", theme.mode === m.id && "is-on")}
              onClick={() => setTheme({ mode: m.id })}
            >
              <ModePreview mode={m.id} />
              <span className="tm-mode-name"><m.icon size={14} /> {m.label}</span>
              <span className="tm-mode-hint">{m.id === "auto" ? `${m.hint} (now ${MODES[resolveMode("auto")].label.toLowerCase()})` : m.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="tm-section">
        <div className="tm-label">
          Theme colour <span className="tm-current">{ACCENTS.find((a) => a.id === theme.accent)?.label}</span>
        </div>
        <div className="tm-accents" role="radiogroup" aria-label="Theme colour">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={theme.accent === a.id}
              className={cx("tm-accent", theme.accent === a.id && "is-on")}
              style={{ "--sw": a.color }}
              onClick={() => setTheme({ accent: a.id })}
              title={a.label}
            >
              <span className="tm-swatch">{theme.accent === a.id && <Check size={16} strokeWidth={3} />}</span>
              <span className="tm-accent-name">{a.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="tm-sample" aria-hidden="true">
        <Button size="sm" variant="primary">Primary</Button>
        <Button size="sm" variant="soft">Soft</Button>
        <span className="badge badge-success">OK</span>
        <span className="badge badge-warning">Warning</span>
        <span className="badge badge-danger">Fault</span>
        <span className="tm-sample-link">Link</span>
      </div>
      <p className="tm-note">
        <ShieldCheck size={14} /> Safety colours (emergency, faults, OK, warnings, E-STOP) are the same in every theme.
      </p>
    </Modal>
  );
}
