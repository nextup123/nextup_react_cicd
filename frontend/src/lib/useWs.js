import { useEffect, useRef } from "react";
import { subscribe } from "./ws";

/**
 * Subscribe a component to a WebSocket message type for its lifetime.
 * `types` may be a single type or an array. The latest handler is always used.
 */
export function useWsMessage(types, handler) {
  const ref = useRef(handler);
  ref.current = handler;
  const key = Array.isArray(types) ? types.join("|") : types;

  useEffect(() => {
    const list = key.split("|");
    const offs = list.map((t) => subscribe(t, (payload, msg) => ref.current(payload, msg)));
    return () => offs.forEach((off) => off());
  }, [key]);
}
