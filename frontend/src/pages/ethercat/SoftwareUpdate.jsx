// Settings > Software Update: new versions of the whole console (backend, screens, drive
// tools), what changed, going back, and reporting a problem. Grown from the EtherCAT Config
// Tool's Software update page, which only updated that tool.
import { Suspense, lazy } from 'react';
import { Loading } from '../../components/ui';
import { importRetry } from '../../lib/retry';
import './ecat.css';
import './ecat-extra.css';

const UpdatePage = lazy(importRetry(() => import('./pages/UpdatePage.jsx')));

export default function SoftwareUpdate() {
  return (
    <div className="ecat ecat-body ecat-update">
      <Suspense fallback={<Loading label="Loading…" />}>
        <UpdatePage />
      </Suspense>
    </div>
  );
}
