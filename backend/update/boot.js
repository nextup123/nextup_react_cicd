'use strict';

// update/boot.js -- imported first by server.js, before anything reads the screens or the drive
// tools' files:
//   - screens built by a software update (frontend/dist-next) replace frontend/dist;
//   - after "Go back", the drive recipes and settings from before the update are put back.
// Neither runs in the test start of a new version (UPDATE_SMOKE_TEST).

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { swapInNewScreens } = require('./lib/gitUpdate');
const { restoreUserData } = require('./lib/backup');

function applyPendingRestore() {
  const stateFile = path.join(config.DATA_DIR, 'update_state.json');
  let state;
  try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return; }
  if (!state?.pendingRestart || !state.restoreData || state.dataRestoredAt || state.toVersion !== config.APP_VERSION) return;
  let files = [];
  let error = '';
  try {
    files = restoreUserData(config.DATA_DIR, state.restoreData);
    console.log(`[UPDATE] drive recipes and settings put back from the copy "${state.restoreData}": ${files.join(', ')}`);
  } catch (err) {
    error = err.message;
    console.error(`[UPDATE] could not put back drive recipes and settings: ${err.message}`);
  }
  const next = { ...state, dataRestoredAt: new Date().toISOString(), dataRestored: files, dataRestoreError: error };
  const tmp = `${stateFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, stateFile);
}

if (!process.env.UPDATE_SMOKE_TEST) {
  try { applyPendingRestore(); } catch (err) { console.error('[UPDATE]', err.message); }
  if (!process.env.FRONTEND_DIST) {
    try { if (swapInNewScreens(config.ROOT)) console.log('[UPDATE] New screens are in place'); } catch (err) { console.error('[UPDATE] could not put the new screens in place:', err.message); }
  }
}
