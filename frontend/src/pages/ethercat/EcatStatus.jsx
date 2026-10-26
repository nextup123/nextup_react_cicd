// The drive tools' status strip (was the separate tool's header): controller connection, the
// drive communication switch (password to start) and how many drives are ready. Inside an
// AppProvider; health is asked every 3 s only while a drive page is open and the tab visible.
import { RefreshCw } from 'lucide-react';
import { useApp, useHealth } from './context/AppContext';
import NodeSwitch from './components/NodeSwitch';
import { stateTone } from './lib/format';

function SystemStatus() {
  const h = useHealth();
  let tone = 'busy';
  let text = 'Connecting';
  if (h.state === 'offline') { tone = 'danger'; text = 'Robot server offline'; }
  else if (h.state === 'online' && !h.ros2) { tone = 'danger'; text = 'Drive controller offline'; }
  else if (h.state === 'online') { tone = 'ok'; text = h.mock ? 'Simulated drives' : 'Drive controller'; }
  return (
    <span className={`status-chip ${tone}`} title={h.rosError || h.controllerIssue ? 'Could not connect to the drive controller. The server log says why.' : text}>
      <span className="led" />
      <span className="hide-xs">{text}</span>
    </span>
  );
}

function DrivesStatus() {
  const { slaves, scan, scanning } = useApp();
  const opCount = slaves.filter((s) => stateTone(s.state) === 'ok').length;
  const tone = !slaves.length ? 'idle' : opCount === slaves.length ? 'ok' : 'warn';
  return (
    <div className="status-group">
      <span className={`status-chip ${tone}`} title="Drives ready / drives found">
        <span className="led" />
        <span className="mono">{slaves.length ? `${opCount}/${slaves.length}` : '0'}</span>
        <span className="hide-xs">ready</span>
      </span>
      <button className="icon-btn" onClick={() => scan()} disabled={scanning} title="Find drives again" aria-label="Find drives again">
        <RefreshCw size={15} className={scanning ? 'spin' : ''} />
      </button>
    </div>
  );
}

export default function EcatStatus() {
  return (
    <div className="ecat ecat-status-wrap" data-tut="ecat-status">
      <div className="ecat-status">
        <SystemStatus />
        <NodeSwitch />
        <DrivesStatus />
      </div>
    </div>
  );
}
