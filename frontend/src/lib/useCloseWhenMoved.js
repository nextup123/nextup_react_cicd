// Closes a move dialog once its motion reaches 100 % (succeeded), so the next
// motion can be started straight away. Test runs (dry run) and failures keep
// the dialog open so the result can be read.
import { useEffect } from "react";

export function useCloseWhenMoved(motion, dryRun, onClose, delayMs = 600) {
  const done = !!motion && motion.state === "succeeded" && !dryRun;
  useEffect(() => {
    if (!done) return undefined;
    const id = setTimeout(() => onClose?.(), delayMs);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, motion?.id]);
}
