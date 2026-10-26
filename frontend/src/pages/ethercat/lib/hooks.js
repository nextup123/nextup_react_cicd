import { useEffect, useMemo, useState } from 'react';
import { api, cached } from '../api';
import { buildFaultIndex } from './faults';

export function useFaultDb() {
  const [state, setState] = useState({ db: null, error: null });
  useEffect(() => {
    let alive = true;
    cached('faultDb', api.faultDb)
      .then((db) => alive && setState({ db, error: null }))
      .catch((err) => alive && setState({ db: null, error: err.message }));
    return () => { alive = false; };
  }, []);
  const index = useMemo(() => (state.db ? buildFaultIndex(state.db) : null), [state.db]);
  return { ...state, index };
}

/** Rolling activity log for a page. */
export function useActivityLog(limit = 300) {
  const [lines, setLines] = useState([]);
  const add = useMemo(() => (msg, level = 'info') => {
    const t = new Date().toLocaleTimeString('en-GB', { hour12: false });
    setLines((l) => [{ id: `${Date.now()}-${Math.random()}`, t, msg, level }, ...l].slice(0, limit));
  }, [limit]);
  const clear = useMemo(() => () => setLines([]), []);
  return { lines, add, clear };
}

/** True while the CSS media query matches. */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}
