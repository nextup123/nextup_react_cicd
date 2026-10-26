import { useCallback, useEffect, useState } from "react";
import { AArrowDown, AArrowUp, Copy, RefreshCw } from "lucide-react";
import { Alert, Button, IconButton, Loading, Modal } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { toast } from "../../store/toast";
import { fetchXML } from "./ioApi";

/** Read-only view of the generated IO behaviour-tree XML. */
export default function XmlModal({ open, onClose }) {
  const [xml, setXml] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [fontSize, setFontSize] = useState(12);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setXml(await fetchXML());
    } catch (err) {
      setError(errorMessage(err, "Could not load the source"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(xml);
      toast.success("Source copied to clipboard");
    } catch {
      toast.error("Could not copy (clipboard not available)");
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="IO sequences source"
      description="Generated behaviour-tree file (read only)"
      size="xl"
      footer={
        <>
          <IconButton icon={AArrowDown} label="Smaller text" onClick={() => setFontSize((s) => Math.max(8, s - 1))} variant="default" />
          <IconButton icon={AArrowUp} label="Larger text" onClick={() => setFontSize((s) => Math.min(20, s + 1))} variant="default" />
          <span className="spacer" />
          <Button icon={RefreshCw} onClick={load} loading={loading}>
            Reload
          </Button>
          <Button icon={Copy} onClick={copy} disabled={!xml} title={!xml ? "Nothing to copy yet" : undefined}>
            Copy
          </Button>
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {error ? (
        <Alert tone="danger" title="Could not load the source">{error}</Alert>
      ) : loading && !xml ? (
        <Loading label="Loading source…" />
      ) : (
        <pre className="code-block io-xml" style={{ fontSize }}>
          {xml || "Nothing to show yet"}
        </pre>
      )}
    </Modal>
  );
}
