import express from 'express';
import { fetchErrorController, getCommandsController, getDescriptionController, getErrorLogsController, getLiveLogsController, clearLiveLogsController, postCommandsController, postDescriptionController } from '../controller/errorLogsController.js';


const router = express.Router();


router.get('/', getErrorLogsController);

// ---------------- LIVE LOGS (/logs_topic history) ----------------
router.get('/live', getLiveLogsController);
router.delete('/live', clearLiveLogsController);

// ---------------- GET description ----------------
router.get('/description', getDescriptionController);

// ---------------- SAVE description ----------------
router.post('/description', postDescriptionController);

// ---------- GET notebook ----------
router.get('/commands', getCommandsController);

// ---------- SAVE notebook ----------
router.post('/commands', postCommandsController);

router.get('/api/fault', fetchErrorController);

export default router;