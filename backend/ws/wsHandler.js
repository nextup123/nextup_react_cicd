// backend/ws/wsHandler.js
//
// WebSocket commands from the browser. Robot commands go through the new
// controllers' services (see ros/robotOps.js): the supervisor owns mode,
// reset, emergency and speed, the motion server owns every motion. Message
// names and reply shapes are kept from the old handler so the pages work
// unchanged; new replies add fields.

import {
  switchProfile, startMotion, stopMotion, resetFault, triggerEmergency, setSpeedOverride,
} from "../ros/robotOps.js";

// One mode-changing action at a time (mode switch, home, start, reset).
let modeSwitchInFlight = false;

// After AUTO is confirmed, the program start waits this long (the old flow
// waited 2.5 s for the SDO writes; the supervisor confirms, so less is needed).
const START_BT_DELAY_MS = 300;

function createWSHandler({ ros, wsServer }) {
  const busy = (ws, action) => {
    wsServer.sendTo(ws, { type: "ACTION_RESULT", payload: { action, ok: false, message: "Busy: a mode change is in progress" } });
  };

  /** Run `fn` as the one mode-changing action; reply busy otherwise. */
  const exclusive = async (ws, action, fn) => {
    if (modeSwitchInFlight) return busy(ws, action);
    modeSwitchInFlight = true;
    try {
      await fn();
    } finally {
      modeSwitchInFlight = false;
    }
  };

  const progressTo = (ws) => (evt) => wsServer.sendTo(ws, { type: "MODE_SWITCH_PROGRESS", payload: evt });

  // NexRoot runner pages that want live tree data (see ros/btMonitor.js)
  wsServer.onClientClose?.((ws) => ros?.btMon?.watch(ws, false));

  return async function handleMessage(msg, ws) {
    if (!msg || typeof msg.type !== "string") {
      console.warn("Invalid WS message:", msg);
      return;
    }

    try {
      switch (msg.type) {
        // ── NexRoot runner page open / closed ──────────────────────
        case "BT_WATCH": {
          ros?.btMon?.watch(ws, Boolean(msg.payload?.on));
          break;
        }

        // ── Servo / jog ────────────────────────────────────────────
        case "START_SERVO": {
          const r = await ros.callService("startServo", {}, { timeoutMs: 5000 });
          wsServer.sendTo(ws, {
            type: "SERVO_RESPONSE",
            payload: r.ok ? { success: r.response.success !== false, message: r.response.message || "Servo started" } : { success: false, message: r.message },
          });
          break;
        }

        case "SERVO_JOG": {
          const { mode } = msg.payload || {};
          if (mode === "joint") ros?.publishServoJoint?.(msg.payload.data);
          else if (mode === "twist") ros?.publishServoTwist?.(msg.payload.linear, msg.payload.angular);
          else console.warn("SERVO_JOG: unknown mode", mode);
          break;
        }

        // Jog frame: ui_command_node/set_frame (answers, and refuses an unknown frame)
        case "SET_SERVO_FRAME": {
          const { frame } = msg.payload || {};
          if (!frame) break;
          const r = await ros.callService("setJogFrame", { frame: String(frame) }, { timeoutMs: 2000 });
          const ok = r.ok && r.response.success !== false;
          const current = r.ok ? r.response.frame || frame : ros.getCurrentFrame();
          if (ok) {
            ros.currentFrame = current;
            ros.saveServoFrame(current);
          }
          wsServer.sendTo(ws, { type: "SERVO_FRAME_RESULT", payload: { ok, frame: current, message: r.ok ? r.response.message : r.message } });
          wsServer.broadcast({ type: "SERVO_FRAME_CHANGED", payload: { frame: ok ? current : ros.getCurrentFrame() } });
          break;
        }

        case "GET_SERVO_FRAME": {
          const r = await ros.callService("setJogFrame", { frame: "" }, { timeoutMs: 1500, waitMs: 0 });
          if (r.ok && r.response.frame) ros.currentFrame = r.response.frame;
          wsServer.sendTo(ws, { type: "SERVO_FRAME_CHANGED", payload: { frame: ros.getCurrentFrame() } });
          break;
        }

        // ── GPIO / DO ──────────────────────────────────────────────
        case "GPIO_COMMAND": {
          const { group, channel, value } = msg.payload || {};
          if (!group || typeof channel !== "number" || typeof value !== "boolean") {
            wsServer.sendTo(ws, { type: "ERROR", payload: "Invalid GPIO_COMMAND payload" });
            break;
          }
          ros?.publishGPIOCommand?.(group, channel, value);
          break;
        }

        case "REQUEST_GPIO_STATE":
          wsServer.sendTo(ws, { type: "GPIO_STATE", payload: ros.getLastGpioState() });
          break;

        case "TOGGLE_DO": {
          const { driver, doId, state } = msg.payload || {};
          if (typeof driver !== "number" || typeof doId !== "number" || typeof state !== "boolean") {
            wsServer.sendTo(ws, { type: "ERROR", payload: "Invalid DO payload" });
            break;
          }
          ros?.publishDO?.(driver, doId, state);
          break;
        }

        // ── UI COMMANDS ────────────────────────────────────────────
        case "UI_COMMANDS": {
          const { command, value } = msg.payload || {};
          if (!command) break;

          const handlers = {
            // HOME: motion server ~/home (active home unless one is named).
            // From JOG the supervisor is switched to SAFEAUTO first.
            home: () =>
              exclusive(ws, "home", async () => {
                const p = msg.payload || {};
                const res = await startMotion(ros, "home", {
                  home_name: String(p.home || ""),
                  speed_mps: Number(p.speed) || 0,
                  acceleration_mps2: Number(p.acceleration) || 0,
                  single_stage: Boolean(p.singleStage),
                  dry_run: Boolean(p.dryRun),
                }, { onProgress: progressTo(ws) });
                wsServer.sendTo(ws, {
                  type: "ACTION_RESULT",
                  payload: {
                    action: "home",
                    ...res,
                    message: res.ok
                      ? `${p.dryRun ? "Homing test (dry run)" : "Homing"} started${res.switched ? " (switched to SAFEAUTO)" : ""}`
                      : res.message,
                  },
                });
              }),

            // START: the program runs in AUTO. Switch the supervisor to AUTO,
            // wait for its confirmation, then start the BT. Unlike the old
            // flow, a refused AUTO stops here: the BT motions would be refused anyway.
            start_bt: () =>
              exclusive(ws, "start_bt", async () => {
                const res = await switchProfile(ros, "auto", { onProgress: progressTo(ws) });
                if (!res.ok) {
                  wsServer.sendTo(ws, { type: "ACTION_RESULT", payload: { action: "start_bt", ok: false, modeOk: false, message: res.message } });
                  return;
                }
                await sleep(START_BT_DELAY_MS);
                ros.publishBoolTopic("/control_start_bt", true);
                ros?.publishLogMessage?.("INFO | start_bt | AUTO confirmed, control_start_bt published");
                wsServer.sendTo(ws, { type: "ACTION_RESULT", payload: { action: "start_bt", ok: true, modeOk: true, message: "Program started (AUTO)" } });
              }),

            change_mode: () => ros.publishStringTopic("/change_mode", String(value)),
            control_start_bt: () => ros.publishBoolTopic("/control_start_bt", Boolean(value)),
            control_reset_bt: () => ros.publishBoolTopic("/control_reset_bt", Boolean(value)),
            control_exit_bt: () => ros.publishBoolTopic("/control_exit_bt", Boolean(value)),
            // Finish the current cycle, then stop (StartControlNode)
            control_stop_bt: () => ros.publishBoolTopic("/control_stop_bt", Boolean(value ?? true)),
            process_control: () => ros.publishProcessControl(String(value)),
            set_speed: () => ros.publishSpeedScale(parseFloat(value)),
            select_cnc: () => ros.publishCNCSelection(String(value)),
          };

          if (handlers[command]) await handlers[command]();
          else ros?.publishUiCommand?.(command); // jog strings: +j1, -cx, 0j1 …
          break;
        }

        // ── 3-mode switch (SafeAuto / Jog / Auto) through the supervisor ──
        case "SWITCH_MODE": {
          const { mode } = msg.payload || {};
          if (!["auto", "safeauto", "jog"].includes(mode)) {
            wsServer.sendTo(ws, { type: "MODE_SWITCH_RESULT", payload: { ok: false, mode, message: `Invalid mode '${mode}'` } });
            break;
          }
          if (modeSwitchInFlight) {
            wsServer.sendTo(ws, { type: "MODE_SWITCH_RESULT", payload: { ok: false, mode, message: "A mode change is already in progress" } });
            break;
          }
          modeSwitchInFlight = true;
          try {
            const result = await switchProfile(ros, mode, { onProgress: progressTo(ws) });
            wsServer.sendTo(ws, { type: "MODE_SWITCH_RESULT", payload: { ok: result.ok, mode, message: result.message } });
          } finally {
            modeSwitchInFlight = false;
          }
          break;
        }

        // The supervisor reports the profile; nothing to read from the drives.
        case "DETECT_MODE":
          wsServer.sendTo(ws, {
            type: "DETECT_MODE_RESULT",
            payload: { mode: ros.supervisor?.profile ?? null, threshold: null, source: "supervisor" },
          });
          break;

        case "CHANGE_MODE": {
          // Legacy: map the old 8 / 9 to the supervisor profiles.
          const { mode } = msg.payload || {};
          const target = mode === "9" ? "jog" : mode === "8" ? "safeauto" : null;
          if (target && !modeSwitchInFlight) await exclusive(ws, "mode", () => switchProfile(ros, target));
          break;
        }

        // ── Motions ────────────────────────────────────────────────
        case "MOTION_STOP": {
          const res = await stopMotion(ros);
          wsServer.sendTo(ws, { type: "ACTION_RESULT", payload: { action: "stop", ...res } });
          break;
        }

        // ── Safety ─────────────────────────────────────────────────
        case "EMERGENCY_TRIGGER": {
          const res = await triggerEmergency(ros);
          wsServer.sendTo(ws, { type: "ACTION_RESULT", payload: { action: "estop", ...res } });
          break;
        }

        // RESET: supervisor ~/reset_fault (release, pulse, wait for the
        // drives). It ends in JOG; the supervisor writes the overspeed limits.
        case "RESET_FAULT":
          await exclusive(ws, "reset", async () => {
            const res = await resetFault(ros, { onProgress: progressTo(ws) });
            wsServer.sendTo(ws, { type: "ACTION_RESULT", payload: { action: "reset", ...res } });
          });
          break;

        case "SET_SPEED_INT8": {
          const { value } = msg.payload || {};
          if (typeof value !== "number" || value < 0 || value > 100) break;
          const res = await setSpeedOverride(ros, value);
          wsServer.sendTo(ws, { type: "SPEED_OVERRIDE_RESULT", payload: res });
          break;
        }

        case "OPERATOR_REPLY": {
          const { id, choice } = msg.payload || {};
          if (choice) ros.answerOperator(String(id || ""), String(choice));
          break;
        }

        case "LOG_MESSAGE":
          ros?.publishLogMessage?.(msg.payload?.data);
          break;

        case "GET_ROSBRIDGE_STATUS":
          wsServer.sendTo(ws, { type: "ROSBRIDGE_STATUS", payload: ros.getRosbridgeStatus() });
          break;

        case "TOGGLE_ROSBRIDGE": {
          const { start } = msg.payload || {};
          ros?.publishRosbridgeControl?.(start ? "start" : "stop");
          break;
        }

        case "PING":
          wsServer.sendTo(ws, { type: "PONG", payload: "alive", timestamp: Date.now() });
          break;

        default:
          console.warn("Unknown WS message:", msg.type);
      }
    } catch (err) {
      console.error("WS handler error:", err);
      wsServer.sendTo(ws, { type: "ERROR", payload: err.message || "Internal server error" });
    }
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { createWSHandler };
