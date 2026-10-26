// backend/ros/rosService.js
import { LightweightROSBridge, RCLNODEJS_AVAILABLE } from './LightweightROSBridge.js';
import { SimROSBridge } from './SimROSBridge.js';

let rosNodeInstance = null;

// Export the same interface as before for backward compatibility
export function getROSNode() {
  return rosNodeInstance;
}

// Uses the real ROS 2 bridge when rclnodejs is installed. Uses the simulated
// bridge when NEXTUP_SIM=1 or when rclnodejs is not installed (a machine
// without ROS 2), so the web app can still be developed and tested there.
// On a machine with ROS 2, an init failure is still fatal, as before, so the
// robot never silently runs against a simulation.
export default async function createROSNode(wsServer) {
  if (rosNodeInstance) return rosNodeInstance;

  const forceSim = process.env.NEXTUP_SIM === '1';

  if (!forceSim && RCLNODEJS_AVAILABLE) {
    const instance = new LightweightROSBridge(wsServer);
    await instance.init();
    rosNodeInstance = instance;
    return instance;
  }

  const sim = new SimROSBridge(wsServer);
  await sim.init();
  rosNodeInstance = sim;
  return sim;
}

// Re-export for backward compatibility
export { LightweightROSBridge };
