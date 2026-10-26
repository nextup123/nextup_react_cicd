// /robot-models: the robot descriptions offered in the 3D view.
//   GET  /                 list (new files in the URDF folder show up here)
//   GET  /model/:id        expanded model: links, visuals, joints
//   GET  /mesh/:mesh       prepared mesh (?detail=low|medium|full), binary "NXM1"
//   PUT  /selected {id}    use this model (saved on the robot, sent to every browser)
import express from 'express';
import { getROSNode } from '../ros/rosService.js';
import { DETAILS } from './meshes.js';
import { listModels, loadModel, meshFor, selectModel, onModelSelected } from './robotModels.js';

const router = express.Router();

const fail = (res, err) => res.status(err.status || 500).json({ ok: false, message: err.message });

onModelSelected((model) => {
  getROSNode()?.ws?.publishState?.('ROBOT_MODEL', { id: model.id, stamp: model.stamp });
});

router.get('/', (_req, res) => res.json(listModels()));

router.get('/model/:id', async (req, res) => {
  try {
    const model = await loadModel(req.params.id);
    const etag = `"${model.id}-${model.stamp}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-cache');
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.json(model);
  } catch (err) {
    fail(res, err);
  }
});

router.get('/mesh/:mesh', async (req, res) => {
  const detail = Object.hasOwn(DETAILS, req.query.detail) ? req.query.detail : 'medium';
  try {
    const { buffer, etag } = await meshFor(req.params.mesh, detail);
    res.setHeader('ETag', etag);
    // The URL carries the model stamp (?v=), so a changed file gets a new URL.
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.type('application/octet-stream').send(buffer);
  } catch (err) {
    fail(res, err);
  }
});

router.put('/selected', async (req, res) => {
  try {
    const model = await selectModel(String(req.body?.id || ''));
    res.json({ ok: true, id: model.id, message: `${model.label} selected` });
  } catch (err) {
    fail(res, err);
  }
});

export default router;
