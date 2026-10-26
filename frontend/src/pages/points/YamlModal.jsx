import { useEffect, useState } from "react";
import yaml from "js-yaml";
import { Copy, RefreshCw } from "lucide-react";
import { Alert, Button, Loading, Modal } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { toast } from "../../store/toast";

/* ───────────── View points YAML ───────────── */
export function YamlModal({ open, onClose }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fontSize, setFontSize] = useState(12);

  const reload = async (announce) => {
    setLoading(true);
    setError(null);
    try {
      const points = await api.get("/point-planning/getPoints");
      setText(yaml.dump({ points: Array.isArray(points) ? points : [] }));
      if (announce) toast.success("Reloaded");
    } catch (err) {
      setError(errorMessage(err));
      setText("");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) reload(false);
  }, [open]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Copy failed: the browser blocked clipboard access");
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Points as text"
      description="Read-only view of the points file of the active project"
      footer={
        <>
          <div className="row grow">
            <Button size="sm" onClick={() => setFontSize((f) => Math.max(7, f - 1))} title="Smaller text">
              A−
            </Button>
            <Button size="sm" onClick={() => setFontSize((f) => Math.min(24, f + 1))} title="Larger text">
              A+
            </Button>
          </div>
          <Button icon={RefreshCw} onClick={() => reload(true)} loading={loading}>
            Reload
          </Button>
          <Button icon={Copy} onClick={copy} disabled={!text}>
            Copy
          </Button>
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {error ? (
        <Alert tone="danger" title="Failed to load the points">
          {error}
        </Alert>
      ) : loading && !text ? (
        <Loading />
      ) : (
        <pre className="code-block pp-yaml" style={{ fontSize }}>
          {text || "No points yet"}
        </pre>
      )}
    </Modal>
  );
}
