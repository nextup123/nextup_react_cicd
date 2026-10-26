import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowRight, Bug, CheckCircle2, ChevronDown, Circle, Clock, CloudDownload, CloudOff, ImagePlus, Info, RefreshCw, RotateCcw,
  ListChecks, Lock, Send, Settings, ShieldCheck, Sparkles, TrendingUp, Undo2, Wifi, Wrench, X, XCircle,
} from 'lucide-react';
// Settings > Software Update. The EtherCAT Config Tool's update page, now for the whole console
// (backend/update, /update-api): one version for the screens, the server, NextPLC and the drive
// tools. Install, Restart and Go back wait while the robot program runs, the robot moves or the
// drives are being worked on.
import { api } from '../updateApi';
import { toast } from '../components/Toasts';
import { Empty, PasswordDialog, Spinner } from '../components/ui';
import { formatDateTime } from '../lib/format';
import { MAX_IMAGES, shrinkImage } from '../lib/images';

const CHANGE_TYPES = {
  feature: { label: 'New', icon: Sparkles, tone: 'accent' },
  improvement: { label: 'Improved', icon: TrendingUp, tone: 'accent' },
  fix: { label: 'Fixed', icon: Wrench, tone: 'ok' },
  security: { label: 'Safety', icon: ShieldCheck, tone: 'ok' },
  breaking: { label: 'Needs attention', icon: AlertTriangle, tone: 'warn' },
  known_issue: { label: 'Known problem', icon: Info, tone: 'warn' },
};

const CATEGORIES = [
  ['wrong_result', 'Wrong value or result'],
  ['drive_communication', 'Cannot talk to a drive'],
  ['crash', 'Console stopped or froze'],
  ['screen_problem', 'Screen looks wrong'],
  ['slow', 'Very slow'],
  ['update', 'Problem with an update'],
  ['other', 'Something else'],
];
const SEVERITIES = [['critical', 'Stops work'], ['high', 'Serious'], ['medium', 'Annoying'], ['low', 'Small']];
const FREQUENCIES = [['always', 'Every time'], ['sometimes', 'Sometimes'], ['once', 'Once']];
const AREAS = ['Projects', 'Teach Points', 'Motion Programs', 'IO Control', 'Robot Program', 'NextPLC', 'NexRoot Runner', 'Client Control', 'Diagnostics', 'Drive faults',
  'Settings', 'Recipes', 'Drive settings', 'Manual read/write', 'Software update', 'Other'];

// What the maintainer's status means to the person who reported it.
const REMOTE_STATUS = {
  new: ['Received', ''],
  triaged: ['Seen by the maintainer', ''],
  need_info: ['More information needed', 'warn'],
  in_progress: ['Being fixed', 'warn'],
  fixed: ['Fixed, coming in the next update', 'ok'],
  released: ['Fixed', 'ok'],
  closed: ['Closed', ''],
  wont_fix: ['Will not be changed', ''],
  duplicate: ['Already reported', ''],
};
const UPDATE_RESULT = { success: ['Done', 'ok'], failed: ['Failed', 'danger'], rolled_back: ['Did not work, went back', 'danger'], not_applied: ['Not applied', 'warn'] };

const REPORTER_KEY = 'nextup.update.reporter';
const loadReporter = () => {
  try { return JSON.parse(localStorage.getItem(REPORTER_KEY)) || {}; } catch { return {}; }
};
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/** Opens the password dialog, runs action(password); a 401 keeps the dialog open with the message. */
function usePasswordAction() {
  const [pending, setPending] = useState(null);
  const ask = (opts) => setPending(opts);
  const dialog = (
    <PasswordDialog
      open={!!pending}
      title={pending?.title}
      message={pending?.message}
      detail={pending?.detail}
      confirmText={pending?.confirmText}
      onClose={() => setPending(null)}
      onSubmit={async (pw) => {
        try {
          const r = await pending.action(pw);
          if (r && r.success === false) return r.error || 'Incorrect password';
          setPending(null);
          return null;
        } catch (err) {
          if (err.status === 401) return 'Incorrect password';
          setPending(null);
          toast(err.message, 'error', 6000);
          return null;
        }
      }}
    />
  );
  return [ask, dialog];
}

export default function UpdatePage() {
  const [status, setStatus] = useState(null);
  const [check, setCheck] = useState(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [askPassword, passwordDialog] = usePasswordAction();
  const [tab, setTabState] = useState(() => {
    try { return TABS.some((x) => x.id === localStorage.getItem(TAB_KEY)) ? localStorage.getItem(TAB_KEY) : 'updates'; } catch { return 'updates'; }
  });
  const setTab = (id) => {
    setTabState(id);
    try { localStorage.setItem(TAB_KEY, id); } catch { /* ignore */ }
  };

  const load = useCallback(async () => {
    try {
      const s = await api.updateStatus();
      setStatus(s);
      if (s.lastCheck) setCheck((c) => c || s.lastCheck);
    } catch (err) {
      setStatus((s) => s || { error: err.message });
    }
  }, []);

  const running = status?.job?.state === 'running';
  useEffect(() => {
    load();
    const t = setInterval(load, running ? 1500 : 20000);
    return () => clearInterval(t);
  }, [load, running]);

  const runCheck = async () => {
    setChecking(true);
    setCheckError('');
    try {
      setCheck(await api.checkUpdates());
    } catch (err) {
      setCheckError(err.message);
    } finally {
      setChecking(false);
    }
  };

  const install = (version) => askPassword({
    title: `Install version ${version}?`,
    message: 'It is downloaded and prepared while this version keeps running. Nothing changes on the robot or the drives. The new version starts when the console restarts. Projects, points, programs, PLC programs, drive recipes and settings stay as they are.',
    confirmText: 'Install',
    action: async (pw) => { const r = await api.installUpdate(version, pw); await load(); return r; },
  });

  const restoreChoice = useRef(true);
  const rollback = () => {
    restoreChoice.current = true;
    askPassword({
      title: `Switch to version ${status.previousVersion}?`,
      message: 'It is prepared now and starts when the console restarts.',
      detail: status.previousBackup ? <RestoreChoice choice={restoreChoice} /> : null,
      confirmText: 'Go back',
      action: async (pw) => { const r = await api.rollbackUpdate(pw, !!status.previousBackup && restoreChoice.current); await load(); return r; },
    });
  };

  const restart = () => askPassword({
    title: 'Restart the console now?',
    message: 'Every screen reconnects by itself in about half a minute. The robot and the drives keep their state; the robot program must be stopped first.',
    confirmText: 'Restart now',
    action: async (pw) => {
      const r = await api.restartApp(pw);
      if (r?.success) { toast('Restarting…', 'info'); waitForRestart(); }
      return r;
    },
  });

  if (!status) return <div className="empty"><Spinner large /></div>;
  if (status.error) return <div className="page"><div className="callout callout-danger">{status.error}</div></div>;

  const hub = status.hub || {};
  return (
    <div className="page">
      {status.notice && <div className={`callout callout-${status.notice.tone}`}>{status.notice.text}</div>}
      <div className="update-tabs tabs" role="tablist">
        {TABS.map((x) => (
          <button key={x.id} role="tab" aria-selected={tab === x.id} className={`tab ${tab === x.id ? 'active' : ''}`} onClick={() => setTab(x.id)}>
            <x.icon size={15} /> {x.label}
            {x.id === 'updates' && status.waitingForRestart && <span className="tab-dot" title="Waiting for a restart" />}
            {x.id === 'reports' && hub.waiting > 0 && <span className="tab-count" title="Waiting to send">{hub.waiting}</span>}
          </button>
        ))}
      </div>
      {hub.pictureProblem && tab !== 'updates' && <div className="callout callout-warn"><ImagePlus size={15} /> {hub.pictureProblem}</div>}

      {tab === 'updates' && (
        <>
          <div className="update-grid">
            <div className="stack">
              {status.busy?.busy && (
                <div className="callout callout-warn"><Clock size={15} /> <div><b>{status.busy.what}.</b> Install, Restart and Go back wait until it has stopped.</div></div>
              )}
              <ThisPc status={status} onRollback={rollback} />
              <UpdatesCard status={status} check={check} checking={checking} checkError={checkError}
                onCheck={runCheck} onInstall={install} onRestart={restart} />
            </div>
            <UpdateHistory key={status.job?.state} />
          </div>
          <UpdateSettings settings={status.settings} source={status.source} askPassword={askPassword} onSaved={load} />
        </>
      )}
      {tab === 'report' && <div className="report-wrap"><ReportForm hub={hub} onSent={() => { load(); setTab('reports'); }} /></div>}
      {tab === 'reports' && <ReportList hub={hub} onSent={load} onNew={() => setTab('report')} />}
      {passwordDialog}
    </div>
  );
}

const TABS = [
  { id: 'updates', label: 'Updates', icon: CloudDownload },
  { id: 'report', label: 'Report a problem', icon: Bug },
  { id: 'reports', label: 'My reports', icon: ListChecks },
];
const TAB_KEY = 'nextup.update.tab';

/** The "also put back recipes and settings" choice in the Go back dialog. */
function RestoreChoice({ choice }) {
  const [on, setOn] = useState(choice.current);
  return (
    <label className="checkbox small" style={{ alignItems: 'flex-start', fontFamily: 'var(--font)', fontSize: 13 }}>
      <input type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); choice.current = e.target.checked; }} />
      <span>
        Also put back the drive recipes and drive settings from before the update.
        Changes made since then are kept in a copy, so nothing is lost.
      </span>
    </label>
  );
}

/** After "Restart now": wait for the server to go away and come back, then reload the page. */
function waitForRestart() {
  let sawDown = false;
  const started = Date.now();
  const tick = async () => {
    try {
      await api.health();
      if (sawDown || Date.now() - started > 8000) { window.location.reload(); return; }
    } catch {
      sawDown = true;
    }
    if (Date.now() - started < 180000) setTimeout(tick, 1500);
  };
  setTimeout(tick, 1500);
}

/** "3.10.0" vs "3.9.2", numerically. */
function isOlder(a, b) {
  const pa = String(a).split(/[.-]/).map(Number);
  const pb = String(b).split(/[.-]/).map(Number);
  for (let i = 0; i < 3; i += 1) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0);
  return false;
}

function ThisPc({ status, onRollback }) {
  const hub = status.hub || {};
  const olderPrev = status.previousVersion && isOlder(status.previousVersion, status.version);
  let server = ['Not set up', ''];
  if (hub.setUp) server = hub.online ? ['Connected', 'badge-ok'] : hub.online === false ? ['Offline', 'badge-warn'] : ['Checking…', ''];
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">This PC</div>
        {status.previousVersion && (
          <div className="card-actions">
            <button className="btn btn-sm" onClick={onRollback} disabled={!!status.job || status.busy?.busy}>
              <Undo2 size={13} /> {olderPrev ? 'Go back' : 'Switch'} to {status.previousVersion}
            </button>
          </div>
        )}
      </div>
      <div className="card-body">
        <dl className="kv-inline">
          <div><dt>Version</dt><dd className="mono">{status.version}</dd></div>
          <div><dt>Name</dt><dd>{status.settings?.machineName || '—'}{status.settings?.site ? ` · ${status.settings.site}` : ''}</dd></div>
          <div>
            <dt>Report server</dt>
            <dd><span className={`badge ${server[1]}`} title={hub.lastError || ''}>{hub.online === false ? <CloudOff size={12} /> : <Wifi size={12} />} {server[0]}</span></dd>
          </div>
          {hub.waiting > 0 && <div><dt>Waiting to send</dt><dd>{hub.waiting}</dd></div>}
          {status.previousVersion && <div><dt>Earlier version kept</dt><dd className="mono">{status.previousVersion}</dd></div>}
          {status.waitingForRestart && <div><dt>After restart</dt><dd className="mono">{status.waitingForRestart}</dd></div>}
        </dl>
      </div>
    </div>
  );
}

function UpdatesCard({ status, check, checking, checkError, onCheck, onInstall, onRestart }) {
  const job = status.job;
  const busy = job?.state === 'running';
  const available = check?.available || [];

  let body;
  const checkedAfterFailure = job?.state === 'failed' && check?.at && check.at > (job.finishedAt || '');
  if (!status.canUpdate) {
    body = <div className="callout callout-info">{status.setupNote}</div>;
  } else if (job && !checkedAfterFailure && !checking) {
    body = <JobView job={job} supervised={status.supervised} drivesBusy={status.busy?.busy} onRestart={onRestart} onRetry={() => onInstall(job.target.version)} />;
  } else if (checking) {
    body = <div className="row muted"><Spinner /> Looking for new versions…</div>;
  } else if (checkError) {
    body = <div className="callout callout-danger">{checkError}</div>;
  } else if (!check) {
    body = <div className="muted">Press <b>Check for updates</b> to see if there is a newer version.</div>;
  } else if (!available.length) {
    body = <div className="callout callout-ok"><CheckCircle2 size={16} /> You have the newest version ({status.version}).</div>;
  } else {
    body = (
      <div className="stack">
        {available.map((r, i) => (
          <ReleaseNotes key={r.tag} release={r} newest={i === 0} drivesBusy={status.busy?.busy} onInstall={() => onInstall(r.version)} />
        ))}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <CloudDownload size={16} className="muted" />
        <div className="card-title">Updates</div>
        {check?.at && !busy && <span className="card-sub">checked {formatDateTime(check.at)}</span>}
        <div className="card-actions">
          {status.canUpdate && !busy && job?.state !== 'ready' && (
            <button className="btn btn-sm" onClick={onCheck} disabled={checking}>
              <RefreshCw size={13} className={checking ? 'spin' : ''} /> Check for updates
            </button>
          )}
        </div>
      </div>
      <div className="card-body">{body}</div>
    </div>
  );
}

function ReleaseNotes({ release, newest, drivesBusy, onInstall }) {
  const [open, setOpen] = useState(newest);
  const n = release.notes || {};
  const groups = Object.keys(CHANGE_TYPES).map((t) => [t, (n.changes || []).filter((c) => c.type === t)]).filter(([, list]) => list.length);
  return (
    <div className={`release ${newest ? 'newest' : ''}`}>
      <div className="release-head">
        <button className="release-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <ChevronDown size={15} style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .15s' }} />
          <span className="mono release-version">{release.version}</span>
          <span className="release-title">{n.title || 'No release notes'}</span>
        </button>
        {n.releasedAt && <span className="muted small">{fmtDate(n.releasedAt)}</span>}
        {n.mandatory && <span className="badge badge-warn">Required</span>}
        {release.checked === false && (
          <span className={`badge ${release.installable === false ? 'badge-warn' : ''}`}
            title="The release check on GitHub has not passed this version (no verified tag). It may still be running, or it failed.">
            <Clock size={12} /> Not checked yet
          </span>
        )}
        <button className={`btn btn-sm ${newest ? 'btn-primary' : ''}`} onClick={onInstall}
          disabled={drivesBusy || release.installable === false}
          title={release.installable === false ? 'Only checked versions can be installed (see Update settings)' : drivesBusy ? 'Waits until the robot and the drives are free' : ''}>
          <CloudDownload size={13} /> Install {release.version}
        </button>
      </div>
      {open && (
        <div className="release-body">
          {n.summary && <p className="release-summary">{n.summary}</p>}
          {groups.map(([type, list]) => {
            const t = CHANGE_TYPES[type];
            return (
              <div key={type} className="change-group">
                <div className={`change-type tone-${t.tone}`}><t.icon size={14} /> {t.label}</div>
                <ul className="change-list">
                  {list.map((c, i) => (
                    <li key={i}>
                      <span className="change-title">{c.title}</span>
                      {c.area && <span className="badge badge-outline">{c.area}</span>}
                      {(c.bugs || []).map((b) => <span key={b} className="badge mono">{b}</span>)}
                      {c.description && <div className="change-desc">{c.description}</div>}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {n.upgradeNotes && <div className="callout callout-warn small"><AlertTriangle size={15} /><div><b>Before you update:</b> {n.upgradeNotes}</div></div>}
          {!release.notes && <div className="muted small">This version has no release notes.</div>}
        </div>
      )}
    </div>
  );
}

const STEP_ICON = { done: CheckCircle2, failed: XCircle, waiting: Circle };

function JobView({ job, supervised, drivesBusy, onRestart, onRetry }) {
  const [showLog, setShowLog] = useState(false);
  const v = job.target?.version;
  return (
    <div className="stack">
      {job.state === 'running' && <div className="row"><Spinner /> <b>{job.kind === 'rollback' ? `Preparing version ${v}.` : `Installing version ${v}.`}</b> <span className="muted">The console keeps working while this runs.</span></div>}
      {job.state === 'ready' && (
        <div className="callout callout-ok">
          <CheckCircle2 size={16} />
          <div style={{ flex: 1 }}>
            <b>Version {v} is ready.</b> It starts the next time the console restarts.
            {!supervised && <div className="small" style={{ marginTop: 4 }}>Restart the console the way it was started (its service, or npm start) to finish.</div>}
          </div>
          {supervised && <button className="btn btn-primary btn-sm" onClick={onRestart} disabled={drivesBusy} title={drivesBusy ? 'Waits until the robot and the drives are free' : ''}><RotateCcw size={13} /> Restart now</button>}
        </div>
      )}
      {job.state === 'failed' && (
        <div className="callout callout-danger">
          <XCircle size={16} />
          <div style={{ flex: 1 }}>
            <b>{job.kind === 'rollback' ? `Could not go back to version ${v}.` : `Version ${v} was not installed.`}</b> {job.error}
            <div className="small" style={{ marginTop: 4 }}>
              {job.restoreFailed ? 'The program files may be incomplete. Do not restart the console; ask the maintainer for help.' : 'Nothing was changed. This version keeps running.'}
            </div>
          </div>
          {job.kind === 'update' && <button className="btn btn-sm" onClick={onRetry}><RefreshCw size={13} /> Try again</button>}
        </div>
      )}
      {job.steps?.length > 0 && (
        <ol className="job-steps">
          {job.steps.map((s) => {
            const Icon = STEP_ICON[s.state];
            return (
              <li key={s.id} className={`job-step ${s.state}`}>
                {s.state === 'running' ? <Spinner /> : <Icon size={16} />}
                <span>{s.label}</span>
                {s.detail && s.state !== 'failed' && <span className="muted small">{s.detail}</span>}
              </li>
            );
          })}
        </ol>
      )}
      {job.log?.length > 0 && (
        <div>
          <button className="link-btn" onClick={() => setShowLog((x) => !x)}>{showLog ? 'Hide details' : 'Show details'}</button>
          {showLog && <pre className="job-log">{job.log.join('\n')}</pre>}
        </div>
      )}
    </div>
  );
}

function UpdateHistory() {
  const [list, setList] = useState(null);
  useEffect(() => { api.updateHistory().then((r) => setList(r.updates || [])).catch(() => setList([])); }, []);
  return (
    <div className="card">
      <div className="card-head"><RotateCcw size={16} className="muted" /><div className="card-title">Updates on this PC</div></div>
      {!list ? <div className="card-body"><Spinner /></div> : !list.length ? (
        <Empty icon={CloudDownload} title="No updates yet">Each update and "go back" on this PC is listed here.</Empty>
      ) : (
      <table className="table table-stack">
        <thead><tr><th>When</th><th>Change</th><th>Result</th><th style={{ width: 90 }} /></tr></thead>
        <tbody>
          {list.slice(0, 20).map((u) => {
            const [label, tone] = UPDATE_RESULT[u.result] || [u.result, ''];
            return (
              <tr key={u.clientEventId}>
                <td data-label="When">{formatDateTime(u.finishedAt || u.startedAt)}</td>
                <td data-label="Change" className="mono">
                  {u.fromVersion} <ArrowRight size={12} style={{ verticalAlign: -1 }} /> {u.toVersion}{u.kind === 'rollback' ? ' (went back)' : ''}
                </td>
                <td data-label="Result"><span className={`badge badge-${tone}`} title={u.error || ''}>{label}</span></td>
                <td className="muted small" data-label="Sent">{u.sent ? 'Sent' : 'Not sent yet'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      )}
    </div>
  );
}

const EMPTY_REPORT = { title: '', description: '', stepsToReproduce: '', category: 'wrong_result', severity: 'medium', frequency: 'once', area: '' };

function ReportForm({ onSent, hub }) {
  const [form, setForm] = useState(EMPTY_REPORT);
  const [reporter, setReporter] = useState(loadReporter);
  const [includeDetails, setIncludeDetails] = useState(true);
  const [sending, setSending] = useState(false);
  const [images, setImages] = useState([]);
  const [adding, setAdding] = useState(false);
  const fileInput = useRef(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  // Pictures from the file chooser, or pasted (Ctrl+V) into the form, e.g. a screenshot.
  const addImages = async (files) => {
    const pics = Array.from(files || []).filter((f) => f.type.startsWith('image/'));
    if (!pics.length) return;
    const room = MAX_IMAGES - images.length;
    if (pics.length > room) toast(`At most ${MAX_IMAGES} pictures. ${room > 0 ? `Only the first ${room} were added.` : ''}`, 'info', 5000);
    setAdding(true);
    try {
      const added = [];
      for (const f of pics.slice(0, Math.max(0, room))) {
        try { added.push(await shrinkImage(f)); } catch (err) { toast(err.message, 'error', 5000); }
      }
      setImages((list) => [...list, ...added].slice(0, MAX_IMAGES));
    } finally {
      setAdding(false);
    }
  };
  const setWho = (patch) => setReporter((r) => ({ ...r, ...patch }));
  const ready = form.title.trim() && form.description.trim();

  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setSending(true);
    try { localStorage.setItem(REPORTER_KEY, JSON.stringify(reporter)); } catch { /* ignore */ }
    try {
      const r = await api.sendReport({
        ...form,
        reporter,
        includeDetails,
        images: images.map(({ name, data }) => ({ name, data })),
        context: includeDetails ? {
          screen: `${window.innerWidth}x${window.innerHeight}`,
          browser: navigator.userAgent,
        } : undefined,
      });
      const rep = r.report;
      if (rep.sendState === 'sent') toast(`Report sent. Its number is ${rep.number}.`, 'success', 6000);
      else toast('Report saved on this PC. It is sent when the internet is connected.', 'info', 6000);
      setForm(EMPTY_REPORT);
      setImages([]);
      onSent?.();
      window.dispatchEvent(new Event('ect:reports'));
    } catch (err) {
      toast(`Could not save the report: ${err.message}`, 'error', 6000);
    } finally {
      setSending(false);
    }
  };

  return (
    <form className="card" onSubmit={submit} onPaste={(e) => { if (e.clipboardData?.files?.length) { e.preventDefault(); addImages(e.clipboardData.files); } }}>
      <div className="card-head">
        <Bug size={16} className="muted" />
        <div className="card-title">Report a problem</div>
        {hub && !hub.online && <span className="card-sub">{hub.setUp ? 'offline: saved and sent later' : 'saved on this PC'}</span>}
      </div>
      <div className="card-body stack">
        <div className="report-cols">
        <div className="stack">
        <div className="field">
          <label htmlFor="rp-title">What went wrong?</label>
          <input id="rp-title" className="input" value={form.title} maxLength={200} placeholder="e.g. Teach Points does not save the new point"
            onChange={(e) => set({ title: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="rp-desc">What happened</label>
          <textarea id="rp-desc" className="textarea" rows={5} value={form.description} placeholder="What you saw, and any message on the screen"
            onChange={(e) => set({ description: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="rp-steps">What were you doing? <span className="hint">optional</span></label>
          <textarea id="rp-steps" className="textarea" rows={3} value={form.stepsToReproduce} placeholder="1. Opened Teach Points  2. Moved to P3  3. Pressed Save …"
            onChange={(e) => set({ stepsToReproduce: e.target.value })} />
        </div>
        </div>
        <div className="stack">
        <div className="field">
          <label>Pictures <span className="hint">optional · up to {MAX_IMAGES} · you can also paste a screenshot here</span></label>
          <div className="attach-row">
            {images.map((im, i) => (
              <div key={i} className="attach-thumb">
                <img src={im.preview} alt={im.name} />
                <button type="button" className="attach-remove" aria-label={`Remove ${im.name}`} onClick={() => setImages((l) => l.filter((_, j) => j !== i))}><X size={12} /></button>
                <span className="attach-size">{Math.round(im.size / 1024)} KB</span>
              </div>
            ))}
            {images.length < MAX_IMAGES && (
              <button type="button" className="attach-add" onClick={() => fileInput.current?.click()} disabled={adding}>
                {adding ? <span className="spinner" /> : <ImagePlus size={18} />}
                <span>{adding ? 'Preparing…' : 'Add picture'}</span>
              </button>
            )}
            <input ref={fileInput} type="file" accept="image/*" multiple hidden
              onChange={(e) => { addImages(e.target.files); e.target.value = ''; }} />
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="rp-cat">Kind of problem</label>
            <select id="rp-cat" className="select" value={form.category} onChange={(e) => set({ category: e.target.value })}>
              {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rp-area">Where</label>
            <select id="rp-area" className="select" value={form.area} onChange={(e) => set({ area: e.target.value })}>
              <option value="">Not sure</option>
              {AREAS.map((a) => <option key={a}>{a}</option>)}
            </select>
          </div>
        </div>
        <div className="row-wrap" style={{ gap: 16 }}>
          <div className="field">
            <label>How bad is it?</label>
            <div className="seg">
              {SEVERITIES.map(([v, l]) => <button type="button" key={v} className={form.severity === v ? 'on' : ''} onClick={() => set({ severity: v })}>{l}</button>)}
            </div>
          </div>
          <div className="field">
            <label>How often?</label>
            <div className="seg">
              {FREQUENCIES.map(([v, l]) => <button type="button" key={v} className={form.frequency === v ? 'on' : ''} onClick={() => set({ frequency: v })}>{l}</button>)}
            </div>
          </div>
        </div>
        </div>
        </div>
        <div className="grid-3">
          <div className="field"><label htmlFor="rp-name">Your name</label><input id="rp-name" className="input" value={reporter.name || ''} onChange={(e) => setWho({ name: e.target.value })} /></div>
          <div className="field"><label htmlFor="rp-co">Company</label><input id="rp-co" className="input" value={reporter.company || ''} onChange={(e) => setWho({ company: e.target.value })} /></div>
          <div className="field"><label htmlFor="rp-ph">Phone or email</label><input id="rp-ph" className="input" value={reporter.phone || ''} onChange={(e) => setWho({ phone: e.target.value })} /></div>
        </div>
        <label className="checkbox small">
          <input type="checkbox" checked={includeDetails} onChange={(e) => setIncludeDetails(e.target.checked)} />
          Add the robot connection, the drive list and the last 20 update entries (helps find the cause)
        </label>
        <div className="row">
          <span className="spacer" />
          <button type="submit" className="btn btn-primary" disabled={!ready || sending}>
            {sending ? <span className="spinner" /> : <Send size={14} />} Send report
          </button>
        </div>
      </div>
    </form>
  );
}

function ReportList({ hub, onSent, onNew }) {
  const [list, setList] = useState(null);
  const [sending, setSending] = useState(false);
  const load = useCallback(() => api.reports().then((r) => setList(r.reports || [])).catch(() => setList([])), []);
  useEffect(() => {
    load();
    window.addEventListener('ect:reports', load);
    return () => window.removeEventListener('ect:reports', load);
  }, [load, hub?.lastContactAt]);

  const sendNow = async () => {
    setSending(true);
    try {
      const s = await api.sendWaitingReports();
      toast(s.online ? 'Sent.' : `Not sent: ${s.lastError || 'no connection'}`, s.online ? 'success' : 'error');
      await load();
      onSent?.();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <ListChecks size={16} className="muted" />
        <div className="card-title">Reports from this PC</div>
        <span className="card-sub">{hub?.setUp ? (hub.online ? 'report server connected' : 'report server not reachable') : 'report server not set up'}</span>
        <div className="card-actions">
          {hub?.waiting > 0 && (
            <button className="btn btn-sm" onClick={sendNow} disabled={sending || !hub?.setUp}>
              {sending ? <span className="spinner" /> : <Send size={13} />} Send {hub.waiting} waiting
            </button>
          )}
          <button className="btn btn-sm btn-primary" onClick={onNew}><Bug size={13} /> Report a problem</button>
        </div>
      </div>
      {!list ? <div className="card-body"><Spinner /></div> : !list.length ? (
        <Empty icon={Bug} title="No reports yet">Problems reported here are listed with what the maintainer did about them.</Empty>
      ) : (
        <table className="table table-stack report-table">
          <thead>
            <tr><th>Problem</th><th>Number</th><th>Reported</th><th>Pictures</th><th>Status</th></tr>
          </thead>
          <tbody>
            {list.slice(0, 50).map((r) => {
              let label;
              let tone = '';
              if (r.sendState === 'waiting') { label = 'Waiting to send'; tone = 'warn'; }
              else if (r.sendState === 'rejected') { label = 'Could not be sent'; tone = 'danger'; }
              else [label, tone] = REMOTE_STATUS[r.remoteStatus] || ['Sent', ''];
              if (r.remoteStatus === 'released' && r.fixedInVersion) label = `Fixed in version ${r.fixedInVersion}`;
              return (
                <tr key={r.clientReportId}>
                  <td data-label="Problem">
                    <div className="report-title">{r.title}</div>
                    {r.sendState !== 'sent' && r.lastError && <div className="small text-danger">{r.lastError}</div>}
                  </td>
                  <td data-label="Number" className="mono">{r.number || '—'}</td>
                  <td data-label="Reported" className="muted nowrap">{formatDateTime(r.reportedAt)}</td>
                  <td data-label="Pictures"><PictureState pics={r.attachments || []} /></td>
                  <td data-label="Status"><span className={`badge ${tone ? `badge-${tone}` : ''}`}>{label}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** "2 sent", "2 waiting" (with the reason), or "1 not accepted" for the pictures of one report. */
function PictureState({ pics }) {
  if (!pics.length) return <span className="muted">—</span>;
  const sent = pics.filter((a) => a.sent).length;
  const failed = pics.filter((a) => a.failed);
  const waiting = pics.filter((a) => !a.sent && !a.failed);
  return (
    <div className="pic-state">
      {sent > 0 && <span className="text-ok"><CheckCircle2 size={13} /> {sent} sent</span>}
      {waiting.length > 0 && <span className="text-warn" title={waiting[0].error || 'Sent after the report'}><CloudOff size={13} /> {waiting.length} waiting</span>}
      {failed.length > 0 && <span className="text-danger" title={failed.map((a) => a.error).join('\n')}><XCircle size={13} /> {failed.length} not accepted</span>}
      {waiting[0]?.error && <div className="small muted">{waiting[0].error}</div>}
    </div>
  );
}

function UpdateSettings({ settings, source, askPassword, onSaved }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(null);
  useEffect(() => { if (open && settings) setForm({ ...settings }); }, [open, settings]);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  // The panel opens only with the password; saving reuses it (asked again if it was changed meanwhile).
  const [password, setPassword] = useState('');
  const close = () => { setOpen(false); setPassword(''); };
  const toggle = () => (open ? close() : askPassword({
    title: 'Open update settings?',
    message: 'Enter the password to see and change where updates come from.',
    confirmText: 'Open',
    action: async (pw) => {
      const r = await api.verifyPassword(pw);
      if (r?.success) { setPassword(pw); setOpen(true); }
      return r;
    },
  }));

  const saveWith = async (pw) => {
    const r = await api.saveUpdateSettings(form, pw);
    if (r?.success) { toast('Update settings saved', 'success'); onSaved(); close(); }
    return r;
  };
  const save = async () => {
    try {
      const r = await saveWith(password);
      if (r?.success === false) throw Object.assign(new Error(r.error || 'Incorrect password'), { status: 401 });
    } catch (err) {
      if (err.status !== 401) { toast(err.message, 'error', 6000); return; }
      askPassword({ title: 'Save update settings?', confirmText: 'Save', action: saveWith });
    }
  };

  return (
    <div className="card">
      <button className="card-head card-head-btn" onClick={toggle} aria-expanded={open}>
        <Settings size={15} className="muted" />
        <div className="card-title">Update settings</div>
        {!open && <Lock size={13} className="muted" />}
        <span className="card-sub">for maintainers</span>
        <ChevronDown size={15} style={{ marginLeft: 'auto', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && form && (
        <div className="card-body">
          <div className="form-grid">
            <div className="field span-2">
              <label htmlFor="us-repo">Repository address <span className="hint">where new versions come from</span></label>
              <input id="us-repo" className="input mono" value={form.repoUrl}
                placeholder={source?.origin || 'git@github.com:your-org/nextup-react.git'}
                onChange={(e) => set({ repoUrl: e.target.value })} />
              <span className="hint small">
                {source?.origin ? 'Leave empty to use the address this copy was downloaded from (shown above). ' : ''}
                For a private repository use an SSH address with a deploy key on this PC, or https://&lt;token&gt;@github.com/… with a read-only token.
              </span>
            </div>
            <div className="field">
              <label htmlFor="us-prefix">Version tags start with</label>
              <input id="us-prefix" className="input mono" value={form.tagPrefix} placeholder="v" onChange={(e) => set({ tagPrefix: e.target.value })} />
              <span className="hint small">Tag <span className="mono">{form.tagPrefix || ''}1.1.0</span> installs version 1.1.0.</span>
            </div>
            <div className="field">
              <label htmlFor="us-hub">Report server address</label>
              <input id="us-hub" className="input mono" value={form.hubUrl} placeholder="https://your-server.onrender.com" onChange={(e) => set({ hubUrl: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="us-name">Name of this PC</label>
              <input id="us-name" className="input" value={form.machineName} onChange={(e) => set({ machineName: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="us-site">Customer or site</label>
              <input id="us-site" className="input" value={form.site} onChange={(e) => set({ site: e.target.value })} />
            </div>
            <label className="checkbox small span-2">
              <input type="checkbox" checked={form.onlyChecked !== false} onChange={(e) => set({ onlyChecked: e.target.checked })} />
              Only install versions that passed the release check on GitHub (recommended). Turn off only if the repository has no release check.
            </label>
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <span className="spacer" />
            <button className="btn" onClick={close}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
}
