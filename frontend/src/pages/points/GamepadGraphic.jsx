// Drawn game controller for the gamepad jog: lights up every button that is
// held, moves the stick knobs with the sticks and marks the dead-man trigger
// of the active mode. Standard Gamepad API button numbers.
import { cx } from "../../components/ui";

export const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, HOME: 16 };

const BODY =
  "M 96 104 Q 112 92 140 92 L 380 92 Q 408 92 424 104 Q 444 120 456 160 L 494 318 Q 508 392 470 414 Q 436 430 404 398 L 352 330 L 168 330 L 116 398 Q 84 430 50 414 Q 12 392 26 318 L 64 160 Q 76 120 96 104 Z";

function Stick({ cx: x, cy: y, ax, ay, on, label, pressed }) {
  const lit = on || pressed;
  return (
    <g className={cx("gp-stick", lit && "is-on")}>
      <circle className="gp-well" cx={x} cy={y} r={42} />
      <circle className="gp-knob" cx={x + ax * 16} cy={y + ay * 16} r={29} />
      <circle className="gp-knob-ring" cx={x + ax * 16} cy={y + ay * 16} r={21} />
      <text className="gp-tag" x={x} y={y + 60}>{label}</text>
    </g>
  );
}

function RoundBtn({ x, y, r = 15, label, on }) {
  return (
    <g className={cx("gp-btn", on && "is-on")}>
      <circle cx={x} cy={y} r={r} />
      {label && <text x={x} y={y + 5}>{label}</text>}
    </g>
  );
}

/**
 * pressed  Set of button numbers held
 * axes     [lx, ly, rx, ry] in -1..1
 * mode     "idle" | "joint" | "cart"
 * active   { stick: "L"|"R"|"D", dir: "x"|"y" } of the control that is jogging, or null
 */
export function GamepadGraphic({ pressed, axes, mode, active, dead = 0.12 }) {
  const on = (b) => pressed.has(b);
  const [lx, ly, rx, ry] = axes;
  const lOn = Math.abs(lx) > dead || Math.abs(ly) > dead;
  const rOn = Math.abs(rx) > dead || Math.abs(ry) > dead;
  return (
    <svg className={cx("gp-svg", `is-${mode}`)} viewBox="0 0 520 440" role="img" aria-label="Gamepad">
      {/* triggers (dead-man) and bumpers */}
      <g className={cx("gp-trig", (on(BTN.LT) || mode === "joint") && "is-on", mode === "joint" && "is-mode")}>
        <rect x={132} y={4} width={44} height={60} rx={18} />
        <text x={154} y={40}>LT</text>
      </g>
      <g className={cx("gp-trig", (on(BTN.RT) || mode === "cart") && "is-on", mode === "cart" && "is-mode")}>
        <rect x={344} y={4} width={44} height={60} rx={18} />
        <text x={366} y={40}>RT</text>
      </g>
      <g className={cx("gp-bump", on(BTN.LB) && "is-on")}>
        <rect x={118} y={68} width={72} height={22} rx={8} />
        <text x={154} y={84}>LB</text>
      </g>
      <g className={cx("gp-bump", on(BTN.RB) && "is-on")}>
        <rect x={330} y={68} width={72} height={22} rx={8} />
        <text x={366} y={84}>RB</text>
      </g>

      <path className="gp-body" d={BODY} />
      <path className="gp-seam" d="M 40 250 L 150 330 M 480 250 L 370 330" />

      <Stick cx={130} cy={172} ax={lx} ay={ly} on={lOn || active?.stick === "L"} pressed={on(BTN.LS)} label="Left stick" />
      <Stick cx={318} cy={262} ax={rx} ay={ry} on={rOn || active?.stick === "R"} pressed={on(BTN.RS)} label="Right stick" />

      {/* D-pad */}
      <g className="gp-dpad">
        <circle className="gp-well" cx={196} cy={262} r={42} />
        <rect className={cx("gp-arm", on(BTN.UP) && "is-on")} x={185} y={228} width={22} height={26} rx={3} />
        <rect className={cx("gp-arm", on(BTN.DOWN) && "is-on")} x={185} y={270} width={22} height={26} rx={3} />
        <rect className={cx("gp-arm", on(BTN.LEFT) && "is-on")} x={162} y={251} width={26} height={22} rx={3} />
        <rect className={cx("gp-arm", on(BTN.RIGHT) && "is-on")} x={204} y={251} width={26} height={22} rx={3} />
        <rect className="gp-arm gp-arm-mid" x={185} y={251} width={22} height={22} />
        <text className="gp-tag" x={196} y={322}>D-pad</text>
      </g>

      {/* face buttons */}
      <circle className="gp-well" cx={390} cy={172} r={44} />
      <RoundBtn x={390} y={148} label="Y" on={on(BTN.Y)} />
      <RoundBtn x={366} y={172} label="X" on={on(BTN.X)} />
      <RoundBtn x={414} y={172} label="B" on={on(BTN.B)} />
      <RoundBtn x={390} y={196} label="A" on={on(BTN.A)} />

      {/* centre */}
      <RoundBtn x={260} y={132} r={16} on={on(BTN.HOME)} />
      <path className="gp-glyph" d="M 252 136 L 260 128 L 268 136 M 254 134 L 254 140 L 266 140 L 266 134" />
      <RoundBtn x={226} y={176} r={11} on={on(BTN.VIEW)} />
      <rect className="gp-glyph" x={221} y={172} width={10} height={8} rx={2} />
      <RoundBtn x={294} y={176} r={11} on={on(BTN.MENU)} />
      <path className="gp-glyph" d="M 289 172 H 299 M 289 176 H 299 M 289 180 H 299" />
    </svg>
  );
}
