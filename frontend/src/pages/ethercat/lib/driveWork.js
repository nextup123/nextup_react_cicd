import { useEffect } from 'react';
import { api } from '../api';

const RENEW_MS = 8000;

/**
 * While `active`, tells the server that the drives are being worked on (a recipe run,
 * settings being written), so a software update or restart waits for it. The server
 * forgets it 20 s after the last renewal, e.g. when the browser is closed mid-run.
 */
export function useDriveWork(active, what) {
  useEffect(() => {
    if (!active) return undefined;
    const id = `${what}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const send = (on) => api.activity(id, what, on).catch(() => {});
    send(true);
    const timer = setInterval(() => send(true), RENEW_MS);
    return () => {
      clearInterval(timer);
      send(false);
    };
  }, [active, what]);
}
