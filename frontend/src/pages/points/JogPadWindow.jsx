// Jog pad: one floating window for the keyboard pendant and the gamepad jog,
// with a switch between them in the header. No backdrop, so the 3D view stays
// in sight (practice in sim). It moves the robot only while the window has
// focus: click inside to take control, click anywhere else to let go.
import { useCallback, useEffect, useRef, useState } from "react";
import { Gamepad2, Keyboard, MousePointerClick, Radio } from "lucide-react";
import FloatingWindow from "../../components/ui/FloatingWindow";
import { Segmented, cx } from "../../components/ui";
import { KeyboardPendant } from "./KeyboardPendant";
import { GamepadJog } from "./GamepadJog";

const TABS = [
  { value: "keyboard", label: "Keyboard", icon: Keyboard },
  { value: "gamepad", label: "Gamepad", icon: Gamepad2 },
];

export function JogPadWindow({ tab, onTab, onClose }) {
  const rootRef = useRef(null);
  const [focused, setFocused] = useState(false);

  const live = useCallback(() => {
    const win = rootRef.current?.closest(".fwin");
    return Boolean(win && document.hasFocus() && win.contains(document.activeElement));
  }, []);

  useEffect(() => {
    const check = () => setFocused(live());
    const later = () => setTimeout(check, 0);
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", later);
    window.addEventListener("blur", check);
    window.addEventListener("focus", check);
    const t = setInterval(check, 400);
    setTimeout(() => rootRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("focusin", check);
      document.removeEventListener("focusout", later);
      window.removeEventListener("blur", check);
      window.removeEventListener("focus", check);
      clearInterval(t);
    };
  }, [live]);

  const takeFocus = (e) => {
    if (e.target.closest("button, input, select, textarea, a")) return;
    setTimeout(() => rootRef.current?.focus(), 0);
  };

  return (
    <FloatingWindow
      id="jogpad"
      title="Jog pad"
      subtitle={focused ? "In control" : "Click inside to take control"}
      icon={tab === "gamepad" ? Gamepad2 : Keyboard}
      size={{ w: 470, h: 660 }}
      at={{ x: 250, y: 76 }}
      minSize={{ w: 380, h: 320 }}
      className={cx("jogpad", focused && "is-live")}
      bodyClassName="jogpad-body"
      onClose={onClose}
      actions={<Segmented className="jogpad-switch" ariaLabel="Jog with" value={tab} onChange={onTab} options={TABS} />}
    >
      <div ref={rootRef} tabIndex={0} className="jogpad-inner" onPointerDown={takeFocus}>
        <div className={cx("jogpad-focus", focused ? "is-live" : "is-idle")}>
          {focused ? <Radio size={14} /> : <MousePointerClick size={14} />}
          {focused
            ? tab === "gamepad"
              ? "In control: the gamepad moves the robot while this window has focus."
              : "In control: held keys move the robot while this window has focus."
            : "Not in control. Click here to jog; clicking the page or the 3D view lets go and stops the robot."}
        </div>
        {tab === "gamepad" ? <GamepadJog live={live} /> : <KeyboardPendant live={live} />}
      </div>
    </FloatingWindow>
  );
}
