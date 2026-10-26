// Which digital inputs / outputs the running PLC program uses (GET /plc-api/plc/io-usage),
// for the "used by PLC" marks on IO Control and the operator panel. Refreshed when a
// program is loaded (PLC_PROGRAM) and every 2 min while the tab shows (the server caches it).
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { queryClient } from "./queryClient";
import { subscribe } from "./ws";

const KEY = ["plc", "io-usage"];

/** PLC address of a driver / GPIO channel: joint3.di2, joint1.do1, joint1.pi_p, gpio1.do4. */
export function plcIoName({ driver, gpio, kind, n }) {
  if (gpio) return `${String(gpio).toLowerCase()}.${kind}${Number(n)}`;
  if (kind === "do" && Number(n) === 4) return `joint${Number(driver)}.pi_p`;
  return `joint${Number(driver)}.${kind}${Number(n)}`;
}

let watching = false;

export function usePlcIoUsage() {
  if (!watching) {
    watching = true; // one subscription for the app's lifetime, however many cards use it
    subscribe("PLC_PROGRAM", () => queryClient.invalidateQueries({ queryKey: KEY }));
  }
  const q = useQuery({ queryKey: KEY, queryFn: () => api.get("/plc-api/plc/io-usage"), staleTime: 15_000, refetchInterval: 120_000, retry: 1 });
  return q.data?.signals || {};
}

/** Tooltip text for a used signal. */
export function plcUseText(u) {
  if (!u) return "";
  const head = u.kind === "do"
    ? u.driven
      ? "Driven by the PLC program: a manual change is overwritten on the next scan."
      : "Read by the PLC program: switching it changes what the program does."
    : "Read by the PLC program: this input triggers PLC logic.";
  const where = u.uses?.length ? `\nUsed in: ${u.uses.join("; ")}` : "";
  return `${u.alias ? `PLC name: ${u.alias}\n` : ""}${head}${where}`;
}

/** PLC address of an operator-panel IO binding ({ device: "joint2", pin: "sto1" | "do1" | "pi_p" }). */
const DRIVER_EXTRA = { sto1: 6, sto2: 7, edm: 8 };
export function plcNameOfPin(device, pin) {
  if (!device || !pin) return "";
  const p = String(pin).toLowerCase();
  return `${String(device).toLowerCase()}.${DRIVER_EXTRA[p] ? `di${DRIVER_EXTRA[p]}` : p}`;
}
