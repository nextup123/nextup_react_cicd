import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { MASTER_ID } from '../lib/format';
import { toast } from '../components/Toasts';

/*
 * Two contexts on purpose: health changes every few seconds, and keeping it
 * apart means a status poll doesn't re-render every page (part of why the
 * old UI felt heavy — it rebuilt big chunks of DOM on timers).
 */
const AppContext = createContext(null);
const HealthContext = createContext(null);
export const useApp = () => useContext(AppContext);
export const useHealth = () => useContext(HealthContext);

const SLAVES_KEY = 'nextup.ecat.slaves';
const SELECTED_KEY = 'nextup.ecat.selected';

function loadJson(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

function HealthProvider({ children }) {
  const [health, setHealth] = useState({ state: 'connecting' });
  const prevNodeRunning = useRef(null);
  const nodeBusy = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const h = await api.health();
      setHealth({ state: 'online', ...h });
      const running = !!h.node?.running;
      if (prevNodeRunning.current === true && !running && !nodeBusy.current) {
        toast('Drive communication stopped unexpectedly. Turn it on again from the header.', 'error', 6000);
      }
      prevNodeRunning.current = running;
    } catch {
      setHealth((h) => ({ ...h, state: 'offline' }));
    }
  }, []);

  useEffect(() => {
    refresh();
    // Poll only while the tab is visible; one request covers ROS + node state.
    const id = setInterval(() => { if (!document.hidden) refresh(); }, 3000);
    const onVis = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [refresh]);

  const setNodeBusy = useCallback((v) => { nodeBusy.current = v; }, []);
  const value = useMemo(() => ({ ...health, refresh, setNodeBusy }), [health, refresh, setNodeBusy]);
  return <HealthContext.Provider value={value}>{children}</HealthContext.Provider>;
}

export function AppProvider({ children }) {
  const [slaves, setSlaves] = useState(() => {
    const s = loadJson(SLAVES_KEY, []);
    return Array.isArray(s) ? s : [];
  });
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [selected, setSelectedRaw] = useState(() => new Set(loadJson(SELECTED_KEY, [])));

  const setSelected = useCallback((next) => {
    setSelectedRaw((prev) => {
      const set = new Set(typeof next === 'function' ? next(prev) : next);
      saveJson(SELECTED_KEY, [...set]);
      return set;
    });
  }, []);

  const scan = useCallback(async ({ quiet = false } = {}) => {
    setScanning(true);
    setScanError(null);
    try {
      const data = await api.slaves(MASTER_ID);
      const list = Array.isArray(data?.slaves) ? data.slaves : [];
      if (!list.length && (data?.stderr || data?.error)) setScanError(String(data.stderr || data.error).trim());
      setSlaves(list);
      saveJson(SLAVES_KEY, list);
      // Drop selections for drives that disappeared.
      const positions = new Set(list.map((s) => s.position));
      setSelected((prev) => [...prev].filter((p) => positions.has(p)));
      if (!quiet) {
        toast(list.length ? `Found ${list.length} drive${list.length === 1 ? '' : 's'}` : 'No drives found on the bus', list.length ? 'success' : 'warn');
      }
      return list;
    } catch (err) {
      setScanError(err.message);
      if (!quiet) toast(`Scan failed: ${err.message}`, 'error');
      return null;
    } finally {
      setScanning(false);
    }
  }, [setSelected]);

  useEffect(() => { scan({ quiet: true }); }, [scan]);

  const value = useMemo(() => ({
    slaves, scan, scanning, scanError, selected, setSelected, masterId: MASTER_ID,
  }), [slaves, scan, scanning, scanError, selected, setSelected]);

  return (
    <HealthProvider>
      <AppContext.Provider value={value}>{children}</AppContext.Provider>
    </HealthProvider>
  );
}
