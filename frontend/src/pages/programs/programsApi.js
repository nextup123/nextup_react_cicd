// Data of the Motion Programs page (backend /robot/programs, robotRoutes.js).
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { queryClient } from "../../lib/queryClient";
import { usePoints } from "../../lib/queries";
import { pointsIndex } from "./programRules";
import { lookupFromPoints } from "./programPath";

const BASE = "/robot/programs";
export const PROGRAMS_KEY = ["programs"];

export const programsApi = {
  list: () => api.get(BASE),
  save: (program, oldName) => api.post(BASE, { program, oldName }),
  remove: (name) => api.del(`${BASE}/${encodeURIComponent(name)}`),
  order: (names) => api.post(`${BASE}/order`, { names }),
  raw: () => api.get(`${BASE}/raw`),
  saveRaw: (text) => api.put(`${BASE}/raw`, { text }),
  createFile: () => api.post(`${BASE}/create-file`),
  run: (o) => api.post(`${BASE}/run`, o),
  finish: () => api.post(`${BASE}/finish`),
  stop: () => api.post("/robot/stop"),
};

/** { exists, file, programs, problems, parseError?, canRun, canFinish, server } */
export const usePrograms = () =>
  useQuery({ queryKey: PROGRAMS_KEY, queryFn: programsApi.list, refetchOnWindowFocus: true, staleTime: 5_000 });

export const refreshPrograms = () => queryClient.invalidateQueries({ queryKey: PROGRAMS_KEY });

/**
 * Taught points for the pickers, the checks and the preview:
 * { list: [{ name, hasJoints, isTf, nature }], index: Map, lookup(name) }
 */
export function useProgramPoints() {
  const q = usePoints();
  return useMemo(() => {
    const raw = q.data || [];
    const index = pointsIndex(raw);
    const list = [...index.entries()].map(([name, v]) => ({ name, ...v }));
    return { list, index, lookup: lookupFromPoints(raw), loading: q.isLoading, error: q.error };
  }, [q.data, q.isLoading, q.error]);
}
