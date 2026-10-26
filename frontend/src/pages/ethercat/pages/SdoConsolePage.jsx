import { useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../context/AppContext';
import { toast } from '../components/Toasts';
import { confirmDialog, SearchSelect } from '../components/ui';
import { DATA_TYPES, hex, jointLabel, normDtype, parseIndexInput, parseRegHex, timeNow, validateValue } from '../lib/format';
import { recordHistory } from '../lib/history';
import { addrLabel, easyCode, matchParam, ParamOption, parseEasyCode, useParamList } from '../lib/params';

export default function SdoConsolePage() {
  const { slaves, masterId } = useApp();
  const params = useParamList();
  const [easyText, setEasyText] = useState('');
  const [form, setForm] = useState({ slave: slaves[0]?.position ?? 0, index: '', subindex: '', dtype: 'int32', value: '' });
  const [presetName, setPresetName] = useState('');
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const idx = parseIndexInput(form.index);
  const sub = parseIndexInput(form.subindex);
  const idxBad = form.index !== '' && (Number.isNaN(idx) || idx > 0xffff);
  const subBad = form.subindex !== '' && (Number.isNaN(sub) || sub > 0xff);
  const addrOk = !Number.isNaN(idx) && !Number.isNaN(sub) && !idxBad && !subBad;
  const easyNow = addrOk && form.index !== '' && form.subindex !== '' ? easyCode(idx, sub) : null;
  const easyBad = easyText.trim() !== '' && !parseEasyCode(easyText);
  const findParam = (i, s2) => params.find((p) => parseRegHex(p.index) === i && parseRegHex(p.subindex) === s2);
  const onEasy = (text) => {
    setEasyText(text);
    if (!text.trim()) { set({ index: '', subindex: '' }); setPresetName(''); return; }
    const c = parseEasyCode(text);
    if (!c) return;
    const p = findParam(c.index, c.subindex);
    set({ index: hex(c.index, 4), subindex: hex(c.subindex, 2), ...(p ? { dtype: normDtype(p.data_type ?? p.dataType, form.dtype) } : {}) });
    setPresetName(p?.name || '');
  };
  const onAddr = (patch) => { set(patch); setPresetName(''); setEasyText(''); };
  const valueErr = form.value !== '' ? validateValue(form.value, form.dtype) : null;

  const pickPreset = (p) => {
    set({
      index: hex(parseRegHex(p.index), 4),
      subindex: hex(parseRegHex(p.subindex), 2),
      dtype: normDtype(p.data_type ?? p.dataType, form.dtype),
    });
    setPresetName(p.name);
    setEasyText(p.easy || '');
  };

  const payload = () => ({ master_id: masterId, slave_position: Number(form.slave), sdo_index: idx, sdo_subindex: sub, sdo_data_type: form.dtype });
  const record = (op, r) => {
    setResult({ op, ...r, at: timeNow() });
    setHistory((h) => [{ id: Date.now(), op, at: timeNow(), slave: Number(form.slave), index: idx, sub, dtype: form.dtype, value: op === 'Write' ? form.value : r.sdo_return_value_string ?? r.sdo_return_value, success: r.success, msg: r.sdo_return_message, name: presetName }, ...h].slice(0, 25));
  };

  const doGet = async () => {
    if (!addrOk) { toast('Enter a valid index and sub-index', 'error'); return; }
    setBusy('get');
    try {
      const r = await api.sdoGet(payload());
      record('Read', r);
      if (!r?.success) toast(`Read failed: ${r?.sdo_return_message}`, 'error');
    } catch (err) {
      record('Read', { success: false, sdo_return_message: err.message });
    } finally {
      setBusy(null);
    }
  };

  const logWrite = (success, msg) => recordHistory({
    kind: 'sdo', outcome: success ? 'ok' : 'failed', drives: [Number(form.slave)],
    title: `Manual write ${addrLabel(idx, sub)} = ${String(form.value).trim()} on ${jointLabel(form.slave)}`,
    detail: `${presetName ? `${presetName} · ` : ''}${form.dtype}${msg ? ` · ${msg}` : ''}`,
  });

  const doSet = async () => {
    if (!addrOk) { toast('Enter a valid index and sub-index', 'error'); return; }
    const err = validateValue(form.value, form.dtype);
    if (err) { toast(err, 'error'); return; }
    const ok = await confirmDialog({
      title: 'Write this value to the drive?',
      message: 'This writes directly to the drive and may affect live motor operation.',
      detail: `Drive:  ${jointLabel(form.slave)} (pos ${form.slave})\nSetting: ${addrLabel(idx, sub)}${presetName ? `  ${presetName}` : ''}\nType:   ${form.dtype}\nValue:  ${form.value}`,
      confirmText: 'Write',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy('set');
    try {
      const r = await api.sdoSet({ ...payload(), sdo_value: String(form.value).trim() });
      record('Write', r);
      toast(r?.success ? 'Value written' : `Write failed: ${r?.sdo_return_message}`, r?.success ? 'success' : 'error');
      logWrite(!!r?.success, r?.sdo_return_message);
    } catch (e) {
      record('Write', { success: false, sdo_return_message: e.message });
      logWrite(false, e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <div className="two-col" style={{ gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)' }}>
        <div className="card">
          <div className="card-head">
            <div className="card-title">Read or write one value</div>
          </div>
          <div>
            <div className="card-body stack">
              <div className="field">
                <label>Setting <span className="hint">search by name, H-code or address</span></label>
                <SearchSelect items={params} placeholder={presetName || 'Search, e.g. H0D.00, homing or 6040'} clearOnPick
                  filter={matchParam} render={(p) => <ParamOption p={p} />}
                  onPick={pickPreset} />
              </div>
              <div className="grid-4 stack-sm">
                <div className="field">
                  <label>Drive</label>
                  <select className="select input" value={form.slave} onChange={(e) => set({ slave: Number(e.target.value) })}>
                    {(slaves.length ? slaves : [{ position: 0, name: '' }]).map((s) => (
                      <option key={s.position} value={s.position}>{jointLabel(s.position)} · pos {s.position}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Easy code <span className="hint">e.g. H0D.00</span></label>
                  <input className={`input mono ${easyBad ? 'invalid' : ''}`} placeholder="H0D.00" value={easyText || easyNow || ''}
                    onChange={(e) => onEasy(e.target.value)} />
                </div>
                <div className="field">
                  <label>Address <span className="hint">index, hex</span></label>
                  <input className={`input mono ${idxBad ? 'invalid' : ''}`} placeholder="0x6040" value={form.index}
                    onChange={(e) => onAddr({ index: e.target.value })} />
                </div>
                <div className="field">
                  <label>Sub-index <span className="hint">hex</span></label>
                  <input className={`input mono ${subBad ? 'invalid' : ''}`} placeholder="0x00" value={form.subindex}
                    onChange={(e) => onAddr({ subindex: e.target.value })} />
                </div>
              </div>
              <div className="grid-2 stack-sm">
                <div className="field">
                  <label>Data type</label>
                  <select className="select input" value={form.dtype} onChange={(e) => set({ dtype: e.target.value })}>
                    {DATA_TYPES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Value <span className="hint">for Write</span></label>
                  <input className={`input mono ${valueErr ? 'invalid' : ''}`} placeholder="e.g. 128" value={form.value} onChange={(e) => set({ value: e.target.value })} />
                  {valueErr && <span className="field-error">{valueErr}</span>}
                </div>
              </div>
              <div className="muted small">Type an easy code (H0D.00) or an address. Index and sub-index accept <code>0x6040</code>, <code>6040h</code> or decimal.</div>
              <div className="row">
                <button className="btn btn-lg" onClick={doGet} disabled={!!busy || !addrOk} style={{ flex: 1 }}>
                  {busy === 'get' ? <span className="spinner" /> : <Download size={15} />} Read
                </button>
                <button className="btn btn-lg btn-primary" onClick={doSet} disabled={!!busy || !addrOk || !form.value || !!valueErr} style={{ flex: 1 }}>
                  {busy === 'set' ? <span className="spinner" /> : <Upload size={15} />} Write
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-head"><div className="card-title">Result</div>{result && <span className="muted small">{result.op} · {result.at}</span>}</div>
            <div className="card-body">
              {!result ? <div className="muted">No operation yet.</div> : (
                <dl className="kv" style={{ margin: 0 }}>
                  <dt>Status</dt><dd><span className={`badge ${result.success ? 'badge-ok' : 'badge-danger'}`}>{result.success ? 'Success' : 'Failed'}</span></dd>
                  {result.op === 'Read' && <><dt>Value</dt><dd style={{ fontSize: 16, fontWeight: 600 }}>{String(result.sdo_return_value ?? '—')}</dd></>}
                  {result.op === 'Read' && <><dt>As text</dt><dd>{result.sdo_return_value_string || '—'}</dd></>}
                  {result.op === 'Read' && Number.isInteger(Number(result.sdo_return_value)) && <><dt>Hex</dt><dd>{hex(Number(result.sdo_return_value) >>> 0, 4)}</dd></>}
                  <dt>Message</dt><dd style={{ fontFamily: 'var(--font)' }}>{result.sdo_return_message || '—'}</dd>
                </dl>
              )}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><div className="card-title">History</div>{history.length > 0 && <div className="card-actions"><button className="btn btn-ghost btn-sm" onClick={() => setHistory([])}>Clear</button></div>}</div>
            <div className="table-wrap" style={{ maxHeight: 320, borderRadius: 0 }}>
              {history.length === 0 ? <div className="card-body muted">Operations appear here.</div> : (
                <table className="table">
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.id}>
                        <td><span className={`type-tag type-${h.op === 'Read' ? 'get' : 'set'}`}>{h.op}</span></td>
                        <td className="mono small">{jointLabel(h.slave)} {addrLabel(h.index, h.sub)}</td>
                        <td className="mono small" title={h.msg}>{String(h.value ?? '')}</td>
                        <td>{h.success ? <span className="badge badge-ok">ok</span> : <span className="badge badge-danger" title={h.msg}>fail</span>}</td>
                        <td className="muted small">{h.at}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
