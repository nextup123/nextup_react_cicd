// Diagnostics > Robot records > Drive faults: the fault history stored in each servo drive
// (9 slots), what each fault means and how to fix it, reset, black-box snapshots and a PDF
// report. The separate EtherCAT Config Tool's Faults page.
import { Suspense, lazy } from 'react';
import { Loading } from '../../components/ui';
import { importRetry } from '../../lib/retry';
import { AppProvider } from './context/AppContext';
import EcatStatus from './EcatStatus';
import './ecat.css';
import './ecat-extra.css';

const FaultLogPage = lazy(importRetry(() => import('./pages/FaultLogPage.jsx')));

export default function DriveFaults() {
  return (
    <AppProvider>
      <div className="ecat-faults">
        <div className="ecat-faults-bar">
          <span className="muted small">The fault history stored in each servo drive, with causes and fixes.</span>
          <EcatStatus />
        </div>
        <div className="ecat ecat-body">
          <Suspense fallback={<Loading label="Loading…" />}>
            <FaultLogPage />
          </Suspense>
        </div>
      </div>
    </AppProvider>
  );
}
