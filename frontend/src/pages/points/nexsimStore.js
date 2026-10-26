// Shared handle to the NexSim 3D viewer so the jog buttons can drive its
// hover preview (old nexsim-embed.js hooked the jog button DOM ids instead).
import { create } from "zustand";

export const useNexSim = create(() => ({ open: false, viewer: null }));

const JOINT_PREVIEW_DEG = 15; // ghost offset shown for a joint jog preview

/** Show the preview for one jog button (cart: "+cx", joint: j1..j6 with a sign). */
export function nexsimPreview(axis, dir) {
  const viewer = useNexSim.getState().viewer;
  if (!viewer) return;
  try {
    if (axis[0] === "j") viewer.previewJointJog(Number(axis[1]) - 1, dir === "-" ? -1 : 1, JOINT_PREVIEW_DEG);
    else viewer.previewJog(`${dir}${axis}`);
  } catch (err) {
    console.warn("[nexsim] preview failed", err);
  }
}

export function nexsimClearPreview() {
  const viewer = useNexSim.getState().viewer;
  if (!viewer) return;
  try {
    viewer.clearJog();
  } catch {
    /* viewer may be mid-dispose */
  }
}
