// Small settings that need no component of their own elsewhere.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Palette, RefreshCw, RotateCcw } from "lucide-react";
import { Alert, Button, Loading, Segmented } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { setJogMethod } from "../points/jogEngine";
import { resetDockPositions, useStatusDock } from "../../store/statusDock";
import { ThemeMenu } from "../../layout/ThemeMenu";
import { reloadApp } from "../../lib/pageReload";

const JOG_METHOD_KEY = "nextup.pp.jogMethod"; // read by the Teach Points jog panel

function readJogMethod() {
  try {
    return localStorage.getItem(JOG_METHOD_KEY) === "servo" ? "servo" : "step";
  } catch {
    return "step";
  }
}

export function JogMethodSetting() {
  const [method, setMethod] = useState(readJogMethod);
  const change = (m) => {
    setMethod(m);
    setJogMethod(m);
    try {
      localStorage.setItem(JOG_METHOD_KEY, m);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="col" style={{ gap: 8 }}>
      <Segmented
        block
        value={method}
        onChange={change}
        options={[
          { value: "step", label: "Step commands (standard)" },
          { value: "servo", label: "Servo velocity stream (experimental)" },
        ]}
      />
      <span className="xs muted">
        {method === "servo"
          ? "Holding a jog button streams ramped velocity commands. The jog panel shows a badge while this is on."
          : "Holding a jog button repeats small step commands. Recommended."}
      </span>
    </div>
  );
}

export function ThemeSetting() {
  const [open, setOpen] = useState(false);
  return (
    <div className="st-actions">
      <span className="small muted grow">Also opened from the palette button in the sidebar.</span>
      <Button icon={Palette} onClick={() => setOpen(true)}>Choose theme…</Button>
      <ThemeMenu open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

export function PanelLayoutSetting() {
  const custom = useStatusDock((s) => Object.keys(s.pos).length > 0);
  return (
    <div className="st-actions">
      <span className="xs muted grow">Drag a panel (open or folded) anywhere by its header; each one remembers its spot. Reset puts the open ones back under the top bar, side by side.</span>
      <Button icon={RotateCcw} disabled={!custom} onClick={resetDockPositions}>Reset positions</Button>
    </div>
  );
}

export function ReloadAppSetting() {
  return (
    <div className="st-actions">
      <span className="xs muted grow">
        Loads the whole console again in this browser (the robot keeps running). Shortcuts anywhere: <b>Alt+R</b> reloads the current page,{" "}
        <b>Alt+Shift+R</b> or a double-click on the NextUp logo the whole web app. Pages fetch their data and code again by themselves while the robot server starts; one that still has not come up after 10 s offers a reload.
      </span>
      <Button variant="primary" icon={RefreshCw} onClick={() => reloadApp()}>Reload web app</Button>
    </div>
  );
}

export function SystemPaths() {
  const q = useQuery({ queryKey: ["system", "paths"], queryFn: () => api.get("/system/paths"), staleTime: 60_000 });
  const [copied, setCopied] = useState("");
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(""), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  if (q.isLoading) return <Loading />;
  if (q.error) return <Alert tone="warning">{errorMessage(q.error)}</Alert>;
  const copy = (p) => navigator.clipboard?.writeText(p).then(() => setCopied(p)).catch(() => {});
  return (
    <div className="col" style={{ gap: 8 }}>
      {q.data?.simulated && <Alert tone="info">The console runs on the simulated robot; the real robot uses these locations.</Alert>}
      <dl className="st-paths">
        {(q.data?.paths || []).map((p) => (
          <div key={p.label}>
            <dt>{p.label}</dt>
            <dd className="mono" title="Click to copy" onClick={() => copy(p.path)}>
              {p.path}
              {copied === p.path && <span className="st-copied">copied</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
