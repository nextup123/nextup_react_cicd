// Live digital IO helpers shared by IO Control and Client Control.
// Reads the shared robot store (DO_STATUS / DI_STATUS / GPIO_STATE /
// GPIO_PUBLISH_CONFIRM) and sends TOGGLE_DO / GPIO_COMMAND on the shared WS.
//
// Outputs are shown optimistically: after a command the switch shows the
// commanded value until the robot echoes it (or a short timeout passes), so a
// lagging echo does not make the switch snap back.
//
// The status dot beside an output switch says whether the command REACHED the
// controller (useDoReach): the output controllers republish every command they
// accepted on applied_commands (DO_APPLIED). A command that is not confirmed
// within REACH_MS turns the dot red.
import { useEffect, useState } from "react";
import { create } from "zustand";
import { send, subscribe } from "../../lib/ws";
import { useRobot } from "../../store/robot";

const PENDING_MS = 2500;
const REACH_MS = 1500;

const usePending = create(() => ({ map: {} })); // key -> { value, at }

const driverKey = (driver, n) => `d:${Number(driver)}:${Number(n)}`;
const gpioKey = (group, n) => `g:${group}:${Number(n)}`;

function actualFor(state, key) {
  const [kind, a, n] = key.split(":");
  if (kind === "d") return Boolean(state.doStatus?.[a]?.[`do${n}`]);
  const v = state.gpio?.[a]?.do?.[n];
  return v === undefined ? undefined : Boolean(v);
}

function clearPending(key) {
  usePending.setState((s) => {
    if (!(key in s.map)) return s;
    const map = { ...s.map };
    delete map[key];
    return { map };
  });
}

function setPending(key, value) {
  const at = Date.now();
  usePending.setState((s) => ({ map: { ...s.map, [key]: { value, at } } }));
  setTimeout(() => {
    if (usePending.getState().map[key]?.at === at) clearPending(key);
  }, PENDING_MS);
}

// The last command per output (from this page or echoed from the PLC, a tree or another screen)
// and when it was given: what the controller must confirm.
const useCommands = create(() => ({ map: {} })); // key -> { value, at }
function noteCommands(entries) {
  const at = Date.now();
  useCommands.setState((s) => {
    const map = { ...s.map };
    for (const [key, value] of entries) {
      // a repeat of the same value (a tree re-sends every tick) is not a new command
      if (map[key]?.value === value) continue;
      map[key] = { value, at };
    }
    return { map };
  });
}
subscribe("DO_STATUS", (p) => {
  if (!p?.driver) return;
  noteCommands([1, 2, 3, 4].filter((n) => p[`do${n}`] !== undefined).map((n) => [driverKey(p.driver, n), Boolean(p[`do${n}`])]));
});
subscribe("GPIO_PUBLISH_CONFIRM", (p) => {
  if (!p?.group) return;
  noteCommands(Object.entries(p.do || {}).map(([n, v]) => [gpioKey(p.group, n), Boolean(v)]));
});

/**
 * Did the output's command reach its controller?
 * { state: "on" | "off" | "sending" | "refused" | "none", value }.
 */
export function useDoReach(kind, a, n) {
  const key = kind === "gpio" ? gpioKey(a, n) : driverKey(a, n);
  const applied = useRobot((s) => (kind === "gpio" ? s.doApplied.gpio?.[a]?.[Number(n)] : s.doApplied.drivers?.[Number(a)]?.[`do${Number(n)}`]));
  const cmd = useCommands((s) => s.map[key]);
  const [, rerender] = useState(0);
  const waiting = Boolean(cmd && applied !== cmd.value && Date.now() - cmd.at < REACH_MS);
  useEffect(() => {
    if (!waiting) return undefined;
    const t = setTimeout(() => rerender((x) => x + 1), cmd.at + REACH_MS - Date.now() + 30);
    return () => clearTimeout(t);
  }, [waiting, cmd]);
  if (!cmd || applied === cmd.value) return applied === undefined ? { state: "none" } : { state: applied ? "on" : "off", value: applied };
  return { state: waiting ? "sending" : "refused", value: cmd.value, applied };
}

// Drop a pending value as soon as the echo matches it.
useRobot.subscribe((state) => {
  const { map } = usePending.getState();
  for (const [key, p] of Object.entries(map)) {
    if (actualFor(state, key) === p.value) clearPending(key);
  }
});

/** "1" | "2" | "3" | "pi_p" -> 1..4 (the index used by TOGGLE_DO and DO_STATUS). */
export const doIdToNumber = (doId) => (String(doId).toLowerCase() === "pi_p" ? 4 : parseInt(doId, 10));

/** Driver output state: { on, actual, pending } */
export function useDriverDo(driver, n) {
  const key = driverKey(driver, n);
  const actual = useRobot((s) => Boolean(s.doStatus?.[Number(driver)]?.[`do${Number(n)}`]));
  const pending = usePending((s) => s.map[key]);
  return { on: pending ? pending.value : actual, actual, pending: Boolean(pending) };
}

/** GPIO output state: { on, actual, known, pending } */
export function useGpioDo(group, n) {
  const key = gpioKey(group, n);
  const raw = useRobot((s) => s.gpio?.[group]?.do?.[Number(n)]);
  const pending = usePending((s) => s.map[key]);
  const actual = Boolean(raw);
  return { on: pending ? pending.value : actual, actual, known: raw !== undefined, pending: Boolean(pending) };
}

/** Driver input (diId 1..8 = di1..di5, sto1, sto2, edm). Returns { on, known }. */
export function useDriverDi(driver, diId) {
  const raw = useRobot((s) => s.diStatus?.[Number(driver) - 1]?.[Number(diId) - 1]);
  return { on: raw === true, known: raw !== undefined };
}

export function useGpioDi(group, n) {
  const raw = useRobot((s) => s.gpio?.[group]?.di?.[Number(n)]);
  return { on: Boolean(raw), known: raw !== undefined };
}

export function setDriverDo(driver, n, state) {
  const d = Number(driver);
  const id = Number(n);
  if (!Number.isFinite(d) || !Number.isFinite(id)) return;
  setPending(driverKey(d, id), Boolean(state));
  noteCommands([[driverKey(d, id), Boolean(state)]]);
  send("TOGGLE_DO", { driver: d, doId: id, state: Boolean(state) });
}

export function setGpioDo(group, n, value) {
  const ch = Number(n);
  if (!group || !Number.isFinite(ch)) return;
  setPending(gpioKey(group, ch), Boolean(value));
  noteCommands([[gpioKey(group, ch), Boolean(value)]]);
  send("GPIO_COMMAND", { group, channel: ch, value: Boolean(value) });
}

/** Set an output from a /ros/do-list item. */
export function setListDo(item, value) {
  if (item.type === "gpio") setGpioDo(item.gpio_id, parseInt(item.do_id, 10), value);
  else setDriverDo(item.driver_id, doIdToNumber(item.do_id), value);
}

/** Push-button output: on, wait push_wait ms, off. */
export async function pushListDo(item) {
  const wait = parseInt(item.push_wait, 10) || 250;
  setListDo(item, true);
  await new Promise((r) => setTimeout(r, wait));
  setListDo(item, false);
}

export const requestGpioState = () => send("REQUEST_GPIO_STATE", { timestamp: Date.now() });
