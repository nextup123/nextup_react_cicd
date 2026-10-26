// Settings > Driver Settings: the servo drive tools merged from the EtherCAT Config Tool.
//   Recipes            saved step-by-step jobs for several drives
//   Drive settings     values for each drive, applied in one go
//   Manual read/write  one value on one drive (password)
// URL /setup/driver-settings/<tab>. Everything that writes to a drive waits while the robot
// program runs or the robot moves (NextUp's interlock, here and on the server).
import { Suspense, lazy } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BookOpen, SlidersHorizontal, Terminal } from 'lucide-react';
import { Loading, Tabs } from '../../components/ui';
import { importRetry } from '../../lib/retry';
import { AppProvider } from './context/AppContext';
import EcatStatus from './EcatStatus';
import './ecat.css';
import './ecat-extra.css';

const RecipesPage = lazy(importRetry(() => import('./pages/recipes/RecipesPage.jsx')));
const DriverConfigPage = lazy(importRetry(() => import('./pages/DriverConfigPage.jsx')));
const SdoConsolePage = lazy(importRetry(() => import('./pages/SdoConsolePage.jsx')));

const TABS = [
  { value: 'recipes', label: 'Recipes', icon: BookOpen, el: RecipesPage, flush: true, sub: 'Saved step-by-step jobs for several drives' },
  { value: 'drive-settings', label: 'Drive settings', icon: SlidersHorizontal, el: DriverConfigPage, sub: 'Set values for each drive and apply them in one go' },
  { value: 'manual', label: 'Manual read/write', icon: Terminal, el: SdoConsolePage, sub: 'Read or change one value on one drive (advanced)' },
];
// the tool's pages open each other by their old ids
const OLD_IDS = { recipes: 'recipes', config: 'drive-settings', sdo: 'manual' };
const KEY = 'nextup.ecat.tab';

export default function DriverSettings() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const seg = pathname.split('/')[3];
  let last = 'recipes';
  try { last = localStorage.getItem(KEY) || last; } catch { /* private mode */ }
  const tab = TABS.find((t) => t.value === seg) || TABS.find((t) => t.value === last) || TABS[0];
  const go = (v) => {
    try { localStorage.setItem(KEY, v); } catch { /* private mode */ }
    navigate(`/setup/driver-settings/${v}`);
  };
  const Page = tab.el;

  return (
    <AppProvider>
      <div className="ecat-shell">
        <div className="ecat-toolbar" data-tut="ecat-toolbar">
          <Tabs tabs={TABS} value={tab.value} onChange={go} className="ecat-tabs" />
          <EcatStatus />
        </div>
        <p className="ecat-sub muted">{tab.sub}</p>
        <div className={`ecat ecat-body ${tab.flush ? 'is-flush' : ''}`}>
          <Suspense fallback={<Loading label="Loading…" />}>
            <Page navigate={(id) => go(OLD_IDS[id] || id)} />
          </Suspense>
        </div>
      </div>
    </AppProvider>
  );
}
