// Operating mode chip in the top bar: profile (AUTO / SAFEAUTO / JOG), the
// supervisor's phase while it changes mode, and the speed override. Its panel
// holds the mode switch, speed override, emergency latching and the
// supervisor / motion server tools. Overspeed limits per mode are set once,
// in Settings › Robot.
import { useEffect, useState } from "react";
import { ChevronDown, Eraser, Gauge, RefreshCw, ShieldCheck } from "lucide-react";
import { Popover, Segmented, Switch, cx } from "../components/ui";
import { send } from "../lib/ws";
import { useWsMessage } from "../lib/useWs";
import { robotApi, robotCall } from "../lib/robotApi";
import { PHASE_TEXT, PROFILE_HINT, PROFILE_LABEL } from "../lib/robotText";
import { toast } from "../store/toast";
import { confirm } from "../store/confirm";
import { useRobot } from "../store/robot";

const MODES = ["auto", "safeauto", "jog"];

export function ModeChip() {
  const sup = useRobot((s) => s.supervisor);
  const modeSwitch = useRobot((s) => s.modeSwitch);
  const fallbackMode = useRobot((s) => s.mode);
  const [speed, setSpeed] = useState(null); // slider value while dragging

  const profile = sup?.profile || fallbackMode;
  // The supervisor's phase is the truth; modeSwitch only covers the request before its first status.
  const busy = sup ? /^(mode_|reset_)/.test(sup.phase) || (Boolean(modeSwitch) && modeSwitch.phase === "request") : Boolean(modeSwitch);
  const override = sup?.speedOverride ?? null;
  const effective = sup ? Math.round(sup.speedScale ?? 0) : null; // percent

  useEffect(() => {
    if (speed !== null && override === speed) setSpeed(null);
  }, [override, speed]);

  useWsMessage("MODE_SWITCH_RESULT", (p) => {
    if (p?.ok) toast.success(p.message || `${PROFILE_LABEL[p.mode]} active`);
    else toast.error(p?.message || "Mode change failed");
  });
  useWsMessage("SPEED_OVERRIDE_RESULT", (p) => {
    // Capping is shown in the chip; only a refusal needs a toast (sliders send many values).
    if (p && p.ok === false && !p.unavailable) toast.error(`Speed override: ${p.message || "refused"}`);
  });

  const switchTo = (mode) => send("SWITCH_MODE", { mode });
  const commitSpeed = (v) => send("SET_SPEED_INT8", { value: Number(v) });

  const phaseText = busy ? PHASE_TEXT[sup?.phase] || modeSwitch?.message || sup?.phase : null;
  const tone = sup?.latched ? "bad" : busy ? "busy" : profile === "auto" ? "auto" : profile === "safeauto" ? "safe" : profile === "jog" ? "jog" : "none";

  return (
    <>
      <Popover
        width={300}
        trigger={({ toggle, open }) => (
          <button type="button" data-tut="mode-chip" className={cx("mode-chip", `is-${tone}`, open && "is-open")} onClick={toggle} title="Operating mode, speed and supervisor tools">
            <span className="mode-chip-text">
              <span className="sig-title">Mode</span>
              <span className="mode-chip-value">{busy && phaseText ? phaseText : PROFILE_LABEL[profile] || "—"}</span>
            </span>
            {override !== null && (
              <span className="mode-chip-speed" title={`Speed override ${override} %, effective ${effective} %`}>
                <Gauge size={13} />
                {effective ?? override}%
              </span>
            )}
            <ChevronDown size={14} className="sig-chev" />
          </button>
        )}
      >
        {(close) => (
          <>
            <div className="popover-section">
              <div className="popover-label">
                Operating mode
                {busy && <span className="badge badge-warning">{phaseText}</span>}
              </div>
              <Segmented
                block
                value={profile}
                onChange={switchTo}
                disabled={busy}
                options={MODES.map((m) => ({ value: m, label: PROFILE_LABEL[m], title: PROFILE_HINT[m], disabled: sup?.latched && m !== "jog" }))}
              />
              <span className="xs muted">{PROFILE_HINT[profile] || "Mode not reported yet"}{sup?.latched ? " · Reset first to leave JOG" : ""}</span>
            </div>

            <div className="popover-section">
              <div className="popover-label">
                Speed override
                <span className="mono" style={{ textTransform: "none" }}>
                  {speed ?? override ?? "–"} %{effective !== null && effective !== (speed ?? override) ? ` → ${effective} %` : ""}
                </span>
              </div>
              <input
                className="range"
                type="range"
                min={0}
                max={100}
                step={5}
                value={speed ?? override ?? 100}
                disabled={!sup}
                onChange={(e) => setSpeed(Number(e.target.value))}
                onPointerUp={(e) => commitSpeed(e.currentTarget.value)}
                onKeyUp={(e) => commitSpeed(e.currentTarget.value)}
              />
              <span className="xs muted">The supervisor caps it per mode (SAFEAUTO max 30 %).</span>
            </div>

            <div className="popover-section">
              <Switch
                size="sm"
                checked={sup ? !sup.strict : false}
                disabled={!sup}
                label="Relaxed latching (JOG only)"
                title="Strict: any drive fault stops every joint. Relaxed: in JOG, a faulted joint is isolated and the others can still be jogged."
                onChange={(relaxed) => robotCall(() => robotApi.setLatching(!relaxed))}
              />
            </div>

            <div className="col" style={{ gap: 2 }}>
              <div className="menu-sep" />
              <button
                className="menu-item"
                onClick={async () => {
                  close();
                  if (await confirm({ title: "Reset the motion server?", message: "Cancels the current motion and clears its error state.", confirmLabel: "Reset", tone: "warning" }))
                    robotCall(() => robotApi.resetMotionServer());
                }}
              >
                <RefreshCw size={15} /> Reset motion server
              </button>
              <button className="menu-item" onClick={() => { close(); robotCall(() => robotApi.clearPlanCache()); }}>
                <Eraser size={15} /> Clear plan cache
              </button>
              {sup && (
                <div className="xs muted row" style={{ gap: 6, padding: "6px 8px 0" }}>
                  <ShieldCheck size={13} />
                  {sup.armed ? "Supervisor armed" : "Supervisor not armed"} · drive mode {sup.driveMode ?? "–"}
                </div>
              )}
            </div>
          </>
        )}
      </Popover>
    </>
  );
}
