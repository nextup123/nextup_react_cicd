// The live PLC: everything the backend pushes over the socket, in one store.
// The live image (PLC_STATE) is only sent while a NextPLC page is open: the page calls
// usePlcWatch(), which sends PLC_WATCH on mount and after every reconnect. A hidden tab stops
// watching (the server then stops decoding the PLC's state) and the image is drawn at 4 Hz max.
import { useEffect } from "react";
import { create } from "zustand";
import { send, subscribe } from "../../../lib/ws";
import { onVisibility, subscribeLimited } from "../../../lib/liveRate";
import { plainText } from "../../../lib/plainText";
import { plcApi, systemApi } from "../lib/api";
import { toast } from "./toast";
import { setPlcModeProbe } from "../../../lib/interlock";

export const usePlc = create((set, get) => ({
  bridge: { mode: "sim", simulated: true, ready: false, message: "", real_available: false, real_reason: "" },
  state: null,          // PLC_STATE view
  program: null,        // PLC_PROGRAM view (ProgramInfo)
  alarms: [],           // recent alarm edges
  events: [],           // backend log lines
  sim: null,            // simulator panel (null on the real robot)
  scan: null,           // { scan_count, scan_time_ms, scan_period_ms } of the newest frame
  lastStateAt: 0,
  setFromStatus(s) {
    set({ state: s.state, program: s.program, alarms: s.alarms || [], sim: s.panel, lastStateAt: s.state ? Date.now() : 0 });
  },
  addAlarm(a) { set({ alarms: [...get().alarms.slice(-199), a] }); },
  addEvent(e) { set({ events: [...get().events.slice(-499), { ...e, text: plainText(e.text) }] }); },
}));

/** Bit value by canonical name (0/1), or undefined. */
export const bitOf = (state, name) => (state ? state.bits[name] : undefined);

async function refresh() {
  try {
    const s = await plcApi.status();
    usePlc.getState().setFromStatus(s);
    usePlc.setState({ bridge: await systemApi.mode() });
    const ev = await plcApi.events();
    usePlc.setState({ events: (ev.events || []).map((e) => ({ ...e, text: plainText(e.text) })) });
  } catch { /* the socket replays the state frames anyway */ }
}

let started = false;
export function startPlcStore() {
  if (started) return;
  started = true;
  setPlcModeProbe(() => usePlc.getState().bridge.mode === "real");
  // a frame where only the scan counters moved keeps `state` as it is (nothing redraws but the
  // scan box, which reads `scan`)
  let shownKey = "";
  subscribeLimited("PLC_STATE", 250, (p) => {
    if (!p) return;
    const { scan_count, scan_time_ms, scan_period_ms, ...shown } = p;
    const key = JSON.stringify(shown);
    const scan = { scan_count, scan_time_ms, scan_period_ms };
    if (key === shownKey && usePlc.getState().state) usePlc.setState({ scan, lastStateAt: Date.now() });
    else { shownKey = key; usePlc.setState({ state: p, scan, lastStateAt: Date.now() }); }
  });
  subscribe("PLC_PROGRAM", (p) => usePlc.setState({ program: p }));
  subscribe("PLC_BRIDGE", (p) => {
    const prev = usePlc.getState().bridge;
    if (prev.mode !== p.mode && prev.ready) {
      // the other PLC: forget everything shown from the previous one, then read the new one
      usePlc.setState({ bridge: p, state: null, program: null, alarms: [], sim: null, lastStateAt: 0 });
      plcApi.status().then((s) => usePlc.getState().setFromStatus(s)).catch(() => {});
    } else usePlc.setState({ bridge: p });
  });
  subscribe("PLC_SIM", (p) => usePlc.setState({ sim: p }));
  subscribe("PLC_ALARM", (p) => usePlc.getState().addAlarm(p));
  subscribe("PLC_EVENT", (p) => usePlc.getState().addEvent(p));
  // only the simulated PLC sends these; the robot's PLC uses the robot's own message topic,
  // which the top bar already shows
  subscribe("PLC_TOAST", (p) => {
    const kind = p.messageType === "failure" ? "error" : p.messageType === "warn" ? "warning" : "success";
    toast[kind](plainText(p.message), { title: "PLC", duration: p.duration > 0 ? p.duration * 1000 : 6000 });
  });
}

let watchers = 0;
let offOpen = null;
let offVis = null;
let visible = true;
let sentOn = false;
function sendWatch() {
  const on = watchers > 0 && visible;
  if (on === sentOn) return;
  sentOn = on;
  send("PLC_WATCH", { on }, { queue: on });
  if (on) refresh();
}
/** Keep the live PLC image coming while the calling page is shown (`enabled` false = not needed). */
export function usePlcWatch(enabled = true) {
  useEffect(() => {
    startPlcStore();
    if (!enabled) return undefined;
    watchers += 1;
    if (watchers === 1) {
      offOpen = subscribe("__OPEN__", () => { if (sentOn) { send("PLC_WATCH", { on: true }); refresh(); } });
      offVis = onVisibility((v) => { visible = v; sendWatch(); });
    }
    if (sentOn) refresh(); else sendWatch();
    return () => {
      watchers -= 1;
      if (watchers === 0) {
        sendWatch();
        offOpen?.(); offVis?.();
        offOpen = null; offVis = null;
      }
    };
  }, [enabled]);
}
