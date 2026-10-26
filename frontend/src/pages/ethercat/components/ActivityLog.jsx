export default function ActivityLog({ lines, onClear, title = 'Activity log', empty = 'Nothing yet.' }) {
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">{title}</div>
        {onClear && lines.length > 0 && <div className="card-actions"><button className="btn btn-ghost btn-sm" onClick={onClear}>Clear</button></div>}
      </div>
      <div className="log">
        {lines.length === 0 && <div className="log-line"><span className="muted">{empty}</span></div>}
        {lines.map((l) => (
          <div key={l.id} className={`log-line ${l.level}`}>
            <span className="t">{l.t}</span>
            <span className="m">{l.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
