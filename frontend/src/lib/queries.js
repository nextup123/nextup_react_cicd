// Shared server data. Each piece of data used by more than one page is
// fetched once here and cached; pages call these hooks instead of fetching
// their own copies. After a change, call the matching `invalidate.*` helper
// so every page that shows that data refreshes.
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { queryClient } from "./queryClient";

export const keys = {
  activeProject: ["project", "active"],
  projects: ["project", "list"],
  points: ["points"],
  doList: ["io", "do-list"],
  diList: ["io", "di-list"],
  settings: ["settings"],
  bridge: ["system", "bridge"],
  uptime: ["system", "uptime"],
};

/** { active_project: string | null } */
export const useActiveProject = () =>
  useQuery({ queryKey: keys.activeProject, queryFn: () => api.get("/api/projects/active"), staleTime: 60_000 });

/** { projects: [...] } */
export const useProjects = () => useQuery({ queryKey: keys.projects, queryFn: () => api.get("/api/projects/list") });

/** Full point objects from points.yaml (array). */
export const usePoints = () =>
  useQuery({
    queryKey: keys.points,
    queryFn: async () => {
      const data = await api.get("/point-planning/getPoints");
      return Array.isArray(data) ? data : data?.points || [];
    },
  });

/** Digital outputs declared in the IO tree: [{ type: 'driver'|'gpio', name, driver_id|gpio_id, do_id, type_of_control, push_wait? }] */
export const useDoList = () =>
  useQuery({ queryKey: keys.doList, queryFn: async () => (await api.get("/ros/do-list"))?.data || [] });

/** Digital inputs declared in the IO tree: [{ type, name, driver_id|gpio_id, di_id }] */
export const useDiList = () =>
  useQuery({ queryKey: keys.diList, queryFn: async () => (await api.get("/ros/di-list"))?.data || [] });

/** Client-control settings: { mode, speed, cnc, total_operations, last_session_operations } */
export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: () => api.get("/settings") });

/** { simulated, ready } */
export const useBridgeInfo = () =>
  useQuery({ queryKey: keys.bridge, queryFn: () => api.get("/system/bridge"), staleTime: Infinity, retry: 3 });

/** { currentTime, uptime, loadAverage, uptimeSeconds, load: [1, 5, 15 min] }, asked once a minute (sidebar + rest alerts). */
export const useUptime = () =>
  useQuery({ queryKey: keys.uptime, queryFn: () => api.get("/uptime", { retry: false }), refetchInterval: 60_000, staleTime: 0, retry: 0 });

/** { nodes: string[], controllers: string[] } expected ROS entities */

export const invalidate = {
  points: () => queryClient.invalidateQueries({ queryKey: keys.points }),
  io: () => queryClient.invalidateQueries({ queryKey: ["io"] }),
  tree: () => queryClient.invalidateQueries({ queryKey: ["tree"] }),
  projects: () => queryClient.invalidateQueries({ queryKey: ["project"] }),
  settings: () => queryClient.invalidateQueries({ queryKey: keys.settings }),
  /** After loading another project every page's data is stale. */
  all: () => queryClient.invalidateQueries(),
};
