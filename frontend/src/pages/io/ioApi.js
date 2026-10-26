// Page data for IO Control (do_di_tree.xml via /io-control). Keys start with
// "io" so invalidate.io() also refreshes them, and every change refreshes
// useDoList()/useDiList() (Client Control's DO/DI cards).
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { invalidate } from "../../lib/queries";

const BASE = "/io-control";

export const ioKeys = {
  sequences: ["io", "sequences"],
  canUndo: ["io", "canUndo"],
};

/**
 * [{ type: 'DO'|'DI'|'GpioDoControl'|'GpioDiControl', name, driverId?, gpioId?,
 *    doId?, diId?, controlType?, pushWait?, waitTime?, responseMsg, with_fallback? }]
 */
export const useSequences = (opts = {}) =>
  useQuery({
    ...opts,
    queryKey: ioKeys.sequences,
    queryFn: async () => {
      const data = await api.get(`${BASE}/getTreeData`);
      return Array.isArray(data) ? data : [];
    },
  });

export const useCanUndo = () =>
  useQuery({ queryKey: ioKeys.canUndo, queryFn: async () => Boolean((await api.get(`${BASE}/canUndo`))?.canUndo) });

function refreshAll() {
  invalidate.io();
  invalidate.tree(); // the main tree editor lists IO subtrees too
}

/** POST to an io-control endpoint, then refresh. Returns the server message. */
export async function ioAction(endpoint, body = {}) {
  try {
    const res = await api.post(`${BASE}/${endpoint}`, body);
    return res?.message || "Done";
  } finally {
    refreshAll();
  }
}

export const fetchControl = (name) => api.get(`${BASE}/getControl/${encodeURIComponent(name)}`);
export const fetchXML = async () => (await api.post(`${BASE}/getXML`))?.xml || "";
export const sortSequences = (order) => ioAction(`reorderSequences?sortOrder=${order}`);

export const isOutput = (seq) => seq.type === "DO" || seq.type === "GpioDoControl";
export const isGpio = (seq) => seq.type === "GpioDoControl" || seq.type === "GpioDiControl";

/** "gripper1[DO]" -> { base: "gripper1", suffix: "[DO]" } */
export function splitName(name = "") {
  const m = /^(.*?)(\[(DO|DI)\])?$/.exec(name);
  return { base: m?.[1] ?? name, suffix: m?.[2] || "" };
}
