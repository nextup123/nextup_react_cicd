// Point-planning page data helpers (page-only queries live under the
// ["points", ...] key so invalidate.points() refreshes them too).
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { invalidate } from "../../lib/queries";
import { useRobot } from "../../store/robot";

const BASE = "/point-planning";

export const pointsApi = {
  add: (point) => api.post(`${BASE}/addPoint`, point),
  update: (oldName, point) => api.post(`${BASE}/updatePoint`, { oldName, ...point }),
  remove: (name) => api.post(`${BASE}/deletePoint`, { name }),
  removeAll: () => api.post(`${BASE}/deleteAll`, {}),
  reorder: (pointNames) => api.post(`${BASE}/reorderPoints`, { pointNames }),
  undo: () => api.post(`${BASE}/undo`, {}),
  editedPoint: (pointName) => api.post(`${BASE}/editedPoint`, { pointName }),
};

export const rosApi = {
  setMotionType: (motionType) => api.post("/ros/setMotionType", { motionType }),
  moveToPoint: (pointName) => api.post("/ros/moveToPoint", { pointName }),
  togglePlanner: (isPilz) => api.post("/ros/togglePlanner", { isPilz }),
};

export const useCanUndo = () =>
  useQuery({
    queryKey: ["points", "canUndo"],
    queryFn: async () => Boolean((await api.get(`${BASE}/canUndo`))?.canUndo),
  });

export const usePlannerState = () =>
  useQuery({ queryKey: ["points", "planner"], queryFn: () => api.get("/ros/plannerState"), staleTime: 30_000 });

/** Old "DDmon_HHMM" timestamp format kept for compatibility with points.yaml. */
export function pointDateTime(now = new Date()) {
  const day = String(now.getDate()).padStart(2, "0");
  const month = now.toLocaleString("en-US", { month: "short" }).toLowerCase();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `${day}${month}_${hours}${minutes}`;
}

/** Current robot pose in points.yaml format (joints in rad, x/y/z cm, r/p/w deg). */
export function capturePose() {
  const { positions, cartesian } = useRobot.getState();
  const j = positions || [];
  const c = cartesian || [];
  return {
    joints_values: {
      joint1: Number(j[0] || 0),
      joint2: Number(j[1] || 0),
      joint3: Number(j[2] || 0),
      joint4: Number(j[3] || 0),
      joint5: Number(j[4] || 0),
      joint6: Number(j[5] || 0),
    },
    coordinate: {
      x: Number(c[0] || 0),
      y: Number(c[1] || 0),
      z: Number(c[2] || 0),
      r: Number(c[3] || 0),
      p: Number(c[4] || 0),
      w: Number(c[5] || 0),
    },
  };
}

export const isEditable = (p) => (p?.is_editable ?? true) !== false;
export const SPECIAL_FRAMES = [
  { value: "end", label: "End (tool)" },
  { value: "base_link", label: "Base" },
  { value: "external_link", label: "External" },
];

export const NAME_RE = /^[a-zA-Z0-9-_]+$/;

export const refreshPoints = () => invalidate.points();

const CURRENT_KEY = "nextup.pp.currentPoint";
export const currentPointStore = {
  get: () => {
    try {
      return localStorage.getItem(CURRENT_KEY);
    } catch {
      return null;
    }
  },
  set: (name) => {
    try {
      if (name) localStorage.setItem(CURRENT_KEY, name);
      else localStorage.removeItem(CURRENT_KEY);
    } catch {
      /* ignore */
    }
  },
};

export const rad2deg = (r) => (Number(r || 0) * 180) / Math.PI;
export const fmt = (v, d = 2) => Number(v || 0).toFixed(d);
