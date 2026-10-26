// Is the robot server reachable? When it is not (stopped, restarting, crashed), data queries
// pause instead of failing every few seconds, and resume once the socket or a request gets
// through again; toasts for the same failure collapse into one (store/toast.js). Commands
// (mutations) are never held back and sent later.
import { onlineManager } from "@tanstack/react-query";
import { create } from "zustand";
import { useConnection } from "./ws";
import { queryClient } from "./queryClient";

/** Data a page could not get (error shown) is read again as soon as the server is back. */
export function refetchFailed() {
  queryClient.refetchQueries({ type: "active", predicate: (q) => q.state.status === "error" });
}

export const useServerHealth = create(() => ({ down: false, since: 0 }));

export function noteServerDown() {
  if (useServerHealth.getState().down) return;
  useServerHealth.setState({ down: true, since: Date.now() });
  onlineManager.setOnline(false);
}
export function noteServerUp() {
  if (!useServerHealth.getState().down) return;
  useServerHealth.setState({ down: false, since: 0 });
  onlineManager.setOnline(true);
  refetchFailed();
}

// the socket reconnects with its own backoff: when it opens, the server is back
useConnection.subscribe((s, prev) => {
  if (s.status === "open" && prev.status !== "open") {
    noteServerUp();
    refetchFailed(); // also after a reconnect that no request noticed
  }
  else if (s.status === "closed" && prev.status === "open") noteServerDown();
});
