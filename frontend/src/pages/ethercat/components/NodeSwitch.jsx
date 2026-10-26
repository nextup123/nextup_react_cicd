import { useState } from 'react';
import { api } from '../api';
import { useHealth } from '../context/AppContext';
import { toast } from './Toasts';
import { confirmDialog, PasswordDialog } from './ui';

const NODE = { node_name: 'ethercat_sdo_srv_server', package_name: 'ethercat_manager' };

/**
 * Start/stop drive communication (the SDO server process on the PC). The UI
 * never names the process; start needs the password (checked server-side).
 */
export default function NodeSwitch({ variant = 'pill' }) {
  const health = useHealth();
  const [busy, setBusy] = useState(null); // 'starting' | 'stopping'
  const [askPw, setAskPw] = useState(false);
  const running = !!health.node?.running;
  const offline = health.state !== 'online';

  const start = async (pw) => {
    setBusy('starting');
    health.setNodeBusy(true);
    try {
      const r = await api.nodeStart(pw, NODE.node_name, NODE.package_name);
      if (r?.success) {
        setAskPw(false);
        toast('Drive communication started', 'success');
        return null;
      }
      if (/password/i.test(r?.message || '')) return r.message;
      setAskPw(false);
      toast(`Failed to start: ${r?.message || 'unknown error'}`, 'error', 6000);
      return null;
    } catch (err) {
      setAskPw(false);
      toast(`Start failed: ${err.message}`, 'error');
      return null;
    } finally {
      await health.refresh();
      health.setNodeBusy(false);
      setBusy(null);
    }
  };

  const stop = async () => {
    const ok = await confirmDialog({
      title: 'Stop drive communication?',
      message: 'Reads and writes to the drives stop until it is started again. Anything in progress is interrupted.',
      confirmText: 'Stop',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy('stopping');
    health.setNodeBusy(true);
    try {
      const r = await api.nodeStop();
      toast(r?.success ? 'Drive communication stopping…' : `Stop failed: ${r?.message}`, r?.success ? 'info' : 'error');
      // The process takes a moment to exit; poll until the status flips.
      for (let i = 0; i < 10; i++) {
        await new Promise((res) => setTimeout(res, 700));
        const h = await api.health().catch(() => null);
        if (h && !h.node?.running) break;
      }
    } catch (err) {
      toast(`Stop failed: ${err.message}`, 'error');
    } finally {
      await health.refresh();
      health.setNodeBusy(false);
      setBusy(null);
    }
  };

  const onClick = () => (running ? stop() : setAskPw(true));
  const label = busy === 'starting' ? 'Starting…' : busy === 'stopping' ? 'Stopping…' : 'Drive comms';

  return (
    <>
      {variant === 'pill' ? (
        <button className={`status-chip ${running ? 'ok' : 'idle'}`} onClick={onClick} disabled={!!busy || offline}
          title={running ? 'Drive communication is on. Click to stop.' : 'Drive communication is off. Click to start.'}>
          <span className={`switch ${running ? 'on' : ''} ${busy ? 'busy' : ''}`} />
          <span className="hide-xs">{label}</span>
        </button>
      ) : (
        <button className={`btn ${running ? '' : 'btn-primary'}`} onClick={onClick} disabled={!!busy || offline}>
          {busy && <span className="spinner" />}
          {running ? 'Stop' : 'Start'}
        </button>
      )}
      <PasswordDialog
        open={askPw}
        title="Start drive communication"
        message="Enter the access password to start communication with the drives."
        confirmText="Start"
        onClose={() => setAskPw(false)}
        onSubmit={start}
      />
    </>
  );
}
