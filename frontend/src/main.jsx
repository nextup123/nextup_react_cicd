// Startup: fetch the saved UI layout (panel sizes, tabs …) from the robot
// server first, so every page opens as it was last set, in any browser.
// The app itself loads right after (or after a short timeout when the
// server does not answer).
import { installPrefSync, loadUiPrefs } from "./lib/uiPrefs";
import { applyStoredTheme } from "./lib/theme";

installPrefSync();
// The app's code itself is fetched again if it fails (server restarting); after a few tries the
// browser reloads once instead of staying on a blank page.
async function start(tries = 0) {
  try {
    await import("./boot.jsx");
    try {
      sessionStorage.removeItem("nextup.bootReload");
    } catch {
      /* private mode */
    }
  } catch (err) {
    console.error("[start] app code did not load", err);
    if (tries < 4) setTimeout(() => start(tries + 1), 1000 * 2 ** tries);
    else if (!(() => { try { return sessionStorage.getItem("nextup.bootReload"); } catch { return "1"; } })()) {
      sessionStorage.setItem("nextup.bootReload", "1");
      location.reload();
    }
  }
}
loadUiPrefs().finally(() => {
  applyStoredTheme(); // the server's copy may differ from this browser's
  start();
});
