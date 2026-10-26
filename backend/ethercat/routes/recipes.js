'use strict';

const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const config = require('../config');
const { readJson, writeJsonAtomic, updateJson, lockFor, delay, toInt } = require('../lib/util');
const { setSdo, getSdo } = require('../lib/sdo');

const router = express.Router();
const RECIPE_FILE = path.join(config.DATA_DIR, 'recipe.json');

/**
 * Read recipes. A missing file is an empty book; a *corrupt* file is an
 * error. (The old server returned an empty list for both, the UI then
 * created a fresh recipe and saved it — wiping the corrupt file for good.)
 */
async function readRecipes() {
  try {
    const data = await readJson(RECIPE_FILE);
    if (!data || !Array.isArray(data.recipes)) throw new Error('recipe.json has no "recipes" array');
    return data;
  } catch (err) {
    if (err.code === 'ENOENT') return { recipes: [] };
    err.status = 500;
    err.message = `recipe.json could not be read: ${err.message}`;
    throw err;
  }
}

function validateRecipes(data) {
  if (!data || !Array.isArray(data.recipes)) return 'Payload must be { recipes: [...] }';
  const ids = new Set();
  for (const r of data.recipes) {
    if (!r || typeof r.id !== 'string' || !r.id) return 'Every recipe needs an id';
    if (ids.has(r.id)) return `Duplicate recipe id ${r.id}`;
    ids.add(r.id);
    if (typeof r.name !== 'string') return `Recipe ${r.id} has no name`;
    if (!Array.isArray(r.blocks)) return `Recipe ${r.id} has no blocks array`;
    // Drives this recipe may run on; absent/null means every drive.
    if (r.drives != null) {
      if (!Array.isArray(r.drives) || !r.drives.length) return `Recipe "${r.name}" must allow at least one drive`;
      if (!r.drives.every((d) => Number.isInteger(d) && d >= 0)) return `Recipe "${r.name}" has an invalid drive list`;
    }
  }
  return null;
}

router.get('/recipes', async (req, res) => {
  try {
    res.json(await readRecipes());
  } catch (err) {
    console.error('[RECIPES]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put('/recipes', async (req, res) => {
  const problem = validateRecipes(req.body);
  if (problem) return res.status(400).json({ error: problem });
  try {
    await lockFor(RECIPE_FILE)(async () => {
      // Keep the previous version next to it — one-step undo for a bad save.
      await fs.copyFile(RECIPE_FILE, `${RECIPE_FILE}.bak`).catch(() => {});
      await writeJsonAtomic(RECIPE_FILE, { recipes: req.body.recipes });
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[RECIPES] Save failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Record a finished run without re-sending (and overwriting) the whole book.
router.post('/recipes/:id/executed', async (req, res) => {
  try {
    const recipe = await updateJson(RECIPE_FILE, (data) => {
      const r = (data.recipes || []).find((x) => x.id === req.params.id);
      if (!r) return null;
      r.executionCount = (r.executionCount || 0) + 1;
      r.lastExecutedAt = new Date().toISOString();
      return { id: r.id, executionCount: r.executionCount, lastExecutedAt: r.lastExecutedAt };
    });
    if (!recipe) return res.status(404).json({ error: 'Recipe not found' });
    res.json({ success: true, ...recipe });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Server-side execution (API compatibility) ─────────────────
// The React UI runs recipes step by step from the browser so it can show
// the live matrix; this endpoint remains for scripts.
let active = false;
let cancelRequested = false;

router.post('/recipes/execute', async (req, res) => {
  const { recipe_id } = req.body || {};
  const slaves = Array.isArray(req.body?.slave_positions) ? req.body.slave_positions : [];
  const master_id = toInt(req.body?.master_id, 0);
  if (active) return res.status(409).json({ success: false, message: 'Another execution is already in progress' });
  if (!slaves.length) return res.status(400).json({ success: false, message: 'No slave_positions provided' });

  let recipe;
  try {
    recipe = (await readRecipes()).recipes.find((r) => r.id === recipe_id);
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
  if (!recipe) return res.status(404).json({ success: false, message: `Recipe "${recipe_id}" not found` });
  if (!recipe.blocks.length) return res.status(400).json({ success: false, message: 'Recipe has no blocks' });
  if (Array.isArray(recipe.drives)) {
    const notAllowed = slaves.filter((s) => !recipe.drives.includes(Number(s)));
    if (notAllowed.length) {
      return res.status(400).json({ success: false, message: `Recipe "${recipe.name}" is not set up for drive position ${notAllowed.join(', ')}` });
    }
  }

  active = true;
  cancelRequested = false;
  const results = [];
  try {
    for (let bi = 0; bi < recipe.blocks.length && !cancelRequested; bi++) {
      const block = recipe.blocks[bi];
      // The old code started every slave's request at once and only
      // pretended to stagger them; now they really run one after another.
      for (const slavePos of slaves) {
        if (cancelRequested) break;
        const body = { master_id, slave_position: slavePos, sdo_index: block.index, sdo_subindex: block.subindex, sdo_data_type: block.dataType, sdo_value: block.value };
        try {
          const r = block.type === 'get' ? await getSdo(body) : await setSdo(body);
          results.push({ blockIndex: bi, slavePos, success: r.success, message: r.sdo_return_message, value: r.sdo_return_value });
        } catch (err) {
          results.push({ blockIndex: bi, slavePos, success: false, message: err.message });
        }
        await delay(200);
      }
      if (bi < recipe.blocks.length - 1) {
        const wait = Number(block.delay) >= 0 ? Number(block.delay) : 1000;
        for (let waited = 0; waited < wait && !cancelRequested; waited += 200) await delay(Math.min(200, wait - waited));
      }
    }
  } finally {
    active = false;
  }
  const cancelled = cancelRequested;
  cancelRequested = false;
  const ok = results.filter((r) => r.success).length;
  res.json({ success: ok === results.length && !cancelled, cancelled, totalOps: results.length, successfulOps: ok, failedOps: results.length - ok, results });
});

router.get('/recipes/cancel-status', (req, res) => res.json({ cancelled: cancelRequested, active }));

router.post('/recipes/cancel', (req, res) => {
  if (!active) return res.json({ success: false, message: 'No active execution' });
  cancelRequested = true;
  res.json({ success: true, message: 'Cancellation requested' });
});

module.exports = router;
