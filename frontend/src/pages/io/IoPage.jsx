import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EyeOff, RefreshCw } from "lucide-react";
import { IconButton } from "../../components/ui";
import { Split } from "../../components/ui/Split";
import { robotApi } from "../../lib/robotApi";
import DriverIoCard from "./DriverIoCard";
import GpioCard from "./GpioCard";
import SignalWatchCard from "./SignalWatchCard";
import SequenceCard from "./SequenceCard";
import ControlFormModal from "./ControlFormModal";
import XmlModal from "./XmlModal";
import { useSequences } from "./ioApi";
import "./io.css";

/** Shown instead of the Signal watch card when the controller has no IO watch service. */
function WatchUnavailable({ onRetry, busy }) {
  return (
    <div className="io-watch-off">
      <EyeOff size={14} />
      <span className="grow">Signal watch is not available on this controller.</span>
      <IconButton size="sm" icon={RefreshCw} label="Check again" loading={busy} onClick={onRetry} />
    </div>
  );
}

/**
 * IO Control: live driver/GPIO IO on the left; the IO sequence list with the
 * signal watch below it on the right. Both splits are resizable and keep
 * their sizes.
 */
export default function IoPage() {
  const [formTarget, setFormTarget] = useState(null);
  const [xmlOpen, setXmlOpen] = useState(false);
  const { data: sequences = [] } = useSequences();
  const names = useMemo(() => sequences.map((s) => s.name), [sequences]);
  const watch = useQuery({ queryKey: ["io-watch"], queryFn: () => robotApi.ioWatch(), retry: 0 });

  const seqCard = (
    <SequenceCard
      onAdd={(preset) => setFormTarget({ mode: "add", ...preset })}
      onEdit={(seq) => setFormTarget({ mode: "edit", name: seq.name, type: seq.type })}
      onShowXml={() => setXmlOpen(true)}
    />
  );

  return (
    <div className="page page-fill io-page">
      <Split id="io.columns" className="io-grid" defaults={[1, 1.8]} min={[340, 420]} gap={14}>
        <div className="io-live">
          <DriverIoCard />
          <GpioCard />
        </div>
        {watch.isError ? (
          <div className="io-right">
            {seqCard}
            <WatchUnavailable busy={watch.isFetching} onRetry={() => watch.refetch()} />
          </div>
        ) : (
          <Split id="io.right" direction="column" defaults={[3, 2]} min={[160, 120]} gap={12}>
            {seqCard}
            <SignalWatchCard />
          </Split>
        )}
      </Split>
      <ControlFormModal target={formTarget} existingNames={names} onClose={() => setFormTarget(null)} />
      <XmlModal open={xmlOpen} onClose={() => setXmlOpen(false)} />
    </div>
  );
}
