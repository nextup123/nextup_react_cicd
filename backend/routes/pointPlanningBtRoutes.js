import express from 'express';

import  {
  getPointsController,
  addPointController,
  updatePointController,
  deletePointController,
  deleteAllController,
  reorderPointsController,
  canUndoController,
  undoController,
  getRobotStatusController,
  editedPointNotificationController
}  from "../controller/pointPlanningBtController.js";

const router = express.Router();

// /getPoints endpoint
router.get("/getPoints", getPointsController);

// /addPoint endpoint
router.post("/addPoint", addPointController);

// /updatePoint endpoint
router.post("/updatePoint", updatePointController);

// /deletePoint endpoint
router.post("/deletePoint", deletePointController);

// /deleteAll endpoint
router.post("/deleteAll", deleteAllController);

// /reorderPoints endpoint
router.post("/reorderPoints", reorderPointsController);

// /undo endpoint
router.post("/undo", undoController);

// /canUndo endpoint
router.get("/canUndo", canUndoController);

// NEW ENDPOINTS FOR ROS COMMUNICATION
router.get("/robotStatus", getRobotStatusController);
router.post("/editedPoint", editedPointNotificationController);

export default router;