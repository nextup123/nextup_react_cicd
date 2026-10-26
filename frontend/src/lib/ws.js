// Single WebSocket connection to the backend, shared by every page.
// Replaces the old parent-window postMessage relay between iframes.
import { create } from "zustand";
import { tutSignal } from "../tutorial/bus";

const listeners = new Map(); // type -> Set<fn>, "*" for all messages
let socket = null;
let retry = 0;
let retryTimer = null;
const queue = []; // { data, at }: short-lived, so stale commands are never replayed
const QUEUE_TTL_MS = 3000;

export const useConnection = create(() => ({ status: "connecting" }));

function wsUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  // In development Vite proxies /ws to the backend; in production the
  // backend serves the app and accepts WebSocket upgrades on any path.
  return import.meta.env.DEV ? `${proto}//${location.host}/ws` : `${proto}//${location.host}/`;
}

function emit(msg) {
  listeners.get(msg.type)?.forEach((fn) => {
    try {
      fn(msg.payload, msg);
    } catch (err) {
      console.error(`WS listener for ${msg.type} failed`, err);
    }
  });
  listeners.get("*")?.forEach((fn) => fn(msg.payload, msg));
}

export function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  clearTimeout(retryTimer);
  useConnection.setState({ status: retry === 0 ? "connecting" : "reconnecting" });

  socket = new WebSocket(wsUrl());

  socket.onopen = () => {
    retry = 0;
    useConnection.setState({ status: "open" });
    const now = Date.now();
    while (queue.length) {
      const item = queue.shift();
      if (now - item.at <= QUEUE_TTL_MS) socket.send(item.data);
    }
    emit({ type: "__OPEN__" });
  };

  socket.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== "string") return;
    emit(msg);
  };

  socket.onclose = () => {
    useConnection.setState({ status: "closed" });
    // Keep retrying forever with a capped backoff: the robot server may
    // restart, and the operator should never have to reload the page.
    const delay = Math.min(1000 * 2 ** retry, 8000);
    retry += 1;
    retryTimer = setTimeout(connect, delay);
  };

  socket.onerror = () => {
    socket?.close();
  };
}

/**
 * Send a message to the backend. Returns true if it went out now. While the
 * socket is down the message is held for at most 3 s (enough for a page that
 * sends on mount during the first connect); pass { queue: false } for motion
 * commands that must never be sent late.
 */
export function send(type, payload = {}, { queue: allowQueue = true } = {}) {
  const data = JSON.stringify({ type, payload });
  tutSignal(`ws:${type}`, payload);
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(data);
    return true;
  }
  if (allowQueue && queue.length < 50) queue.push({ data, at: Date.now() });
  return false;
}

/** Subscribe to one message type ("*" for every message). Returns unsubscribe. */
export function subscribe(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type)?.delete(fn);
}

export function isOpen() {
  return socket?.readyState === WebSocket.OPEN;
}
