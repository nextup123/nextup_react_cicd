// Hold-to-jog engines. Both are module singletons so only one axis can ever
// be jogging, whichever component pressed it.
//
// 1) "step" (default, the path the old page actually used): while a button
//    is held, UI_COMMANDS "+j1" / "-cx" … is re-sent every 30 ms; on release
//    "0j1" / "0cx" is sent once. (Old script.js startJog/stopJog.)
// 2) "servo": the velocity-ramped SERVO_JOG stream from the old servo_jog.js
//    (ported 1:1: 30 ms tick, 2.5 s accel ramp to 0.2, 0.5 s decel ramp on
//    release). The old page shipped it dormant (SERVO_JOG_ENABLED = false);
//    it is kept here as an opt-in jog method.
//
// Dead-man: release, pointer cancel/leave, window blur, tab hidden, context
// menu, page unmount and WebSocket loss all stop the motion.
import { useEffect } from "react";
import { isOpen, send } from "../../lib/ws";
import { tutSignal } from "../../tutorial/bus";

export const JOG_AXES = {
  joint: [
    { id: "j1", label: "J1", unit: "°" },
    { id: "j2", label: "J2", unit: "°" },
    { id: "j3", label: "J3", unit: "°" },
    { id: "j4", label: "J4", unit: "°" },
    { id: "j5", label: "J5", unit: "°" },
    { id: "j6", label: "J6", unit: "°" },
  ],
  cart: [
    { id: "cx", label: "X", unit: "cm", hint: "Move along X" },
    { id: "cy", label: "Y", unit: "cm", hint: "Move along Y" },
    { id: "cz", label: "Z", unit: "cm", hint: "Move along Z" },
    { id: "cr", label: "R", unit: "°", hint: "Rotate about X (roll)" },
    { id: "cp", label: "P", unit: "°", hint: "Rotate about Y (pitch)" },
    { id: "cw", label: "W", unit: "°", hint: "Rotate about Z (yaw)" },
  ],
};

const INTERVAL_MS = 30;

/* ───────────── step engine (UI_COMMANDS) ───────────── */
let stepActive = null; // axis id, e.g. "j1"
let stepTimer = null;

function sendUiCommand(command) {
  send("UI_COMMANDS", { command }, { queue: false });
}

function stepStart(axis, dir) {
  if (stepActive) stepStop();
  stepActive = axis;
  sendUiCommand(`${dir}${axis}`);
  stepTimer = setInterval(() => {
    if (!isOpen()) {
      stepStop();
      return;
    }
    sendUiCommand(`${dir}${axis}`);
  }, INTERVAL_MS);
}

function stepStop() {
  clearInterval(stepTimer);
  stepTimer = null;
  if (!stepActive) return;
  sendUiCommand(`0${stepActive}`);
  stepActive = null;
}

/* ───────────── servo engine (SERVO_JOG, from servo_jog.js) ───────────── */
let jointVelCmd = 0.0;
let twistVelCmd = 0.2;
const maxJointVel = 0.2;
const maxTwistVel = 0.2;
const accelTime = 2.5;
const decelTime = 0.5;
const jointAccel = () => (maxJointVel * (INTERVAL_MS / 1000)) / accelTime;
const jointDecel = () => (maxJointVel * (INTERVAL_MS / 1000)) / decelTime;
const twistAccel = () => (maxTwistVel * (INTERVAL_MS / 1000)) / accelTime;
const twistDecel = () => (maxTwistVel * (INTERVAL_MS / 1000)) / decelTime;

let activeControl = null;
let controlInterval = null;
let decelTimer = null;

function twistPayload(axis, sign, angular, v) {
  const linear = { x: 0, y: 0, z: 0 };
  const angularV = { x: 0, y: 0, z: 0 };
  const key = ["x", "y", "z"][axis];
  if (!angular) linear[key] = v * sign;
  else angularV[key] = v * sign;
  return { mode: "twist", linear, angular: angularV };
}

function publishJoint(axis, sign) {
  jointVelCmd = Math.min(maxJointVel, jointVelCmd + jointAccel());
  const data = [0, 0, 0, 0, 0, 0];
  data[axis] = jointVelCmd * sign;
  send("SERVO_JOG", { mode: "joint", data }, { queue: false });
}

function publishTwist(axis, sign, angular) {
  twistVelCmd = Math.min(maxTwistVel, twistVelCmd + twistAccel());
  send("SERVO_JOG", twistPayload(axis, sign, angular, twistVelCmd), { queue: false });
}

function decelerateJoint(axis, sign) {
  clearInterval(decelTimer);
  decelTimer = setInterval(() => {
    jointVelCmd = Math.max(0, jointVelCmd - jointDecel());
    const data = [0, 0, 0, 0, 0, 0];
    data[axis] = jointVelCmd * sign;
    send("SERVO_JOG", { mode: "joint", data }, { queue: false });
    if (jointVelCmd <= 0) {
      clearInterval(decelTimer);
      decelTimer = null;
    }
  }, INTERVAL_MS);
}

function decelerateTwist(axis, sign, angular) {
  clearInterval(decelTimer);
  decelTimer = setInterval(() => {
    twistVelCmd = Math.max(0, twistVelCmd - twistDecel());
    send("SERVO_JOG", twistPayload(axis, sign, angular, twistVelCmd), { queue: false });
    if (twistVelCmd <= 0) {
      clearInterval(decelTimer);
      decelTimer = null;
    }
  }, INTERVAL_MS);
}

function servoStart(axisId, dir) {
  const sign = dir === "-" ? -1 : 1;
  const isJoint = axisId[0] === "j";
  const type = isJoint ? "joint" : "twist";
  const axis = isJoint ? Number(axisId[1]) - 1 : { cx: 0, cy: 1, cz: 2, cr: 0, cp: 1, cw: 2 }[axisId];
  const angular = !isJoint && ["cr", "cp", "cw"].includes(axisId);

  servoStop();
  clearInterval(decelTimer);
  decelTimer = null;
  activeControl = { type, axis, sign, angular };
  controlInterval = setInterval(() => {
    if (!isOpen()) {
      servoStop();
      return;
    }
    if (type === "joint") publishJoint(axis, sign);
    else publishTwist(axis, sign, angular);
  }, INTERVAL_MS);
}

function servoStop() {
  clearInterval(controlInterval);
  controlInterval = null;
  if (!activeControl) return;
  if (activeControl.type === "joint") decelerateJoint(activeControl.axis, activeControl.sign);
  else decelerateTwist(activeControl.axis, activeControl.sign, activeControl.angular);
  activeControl = null;
}

/* ───────────── public API ───────────── */
let method = "step";
const subscribers = new Set();
let activeKey = null; // "j1+" while held, for button highlighting

function notify() {
  subscribers.forEach((fn) => fn(activeKey));
}

export function setJogMethod(m) {
  stopJog();
  method = m === "servo" ? "servo" : "step";
}

export function startJog(axis, dir) {
  if (!isOpen()) return false;
  if (method === "servo") {
    stepStop();
    servoStart(axis, dir);
  } else {
    servoStop();
    stepStart(axis, dir);
  }
  activeKey = `${axis}${dir}`;
  notify();
  tutSignal("jog", { axis, dir });
  return true;
}

export function stopJog() {
  stepStop();
  servoStop();
  if (activeKey !== null) {
    activeKey = null;
    notify();
  }
}

export function onJogChange(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/** Installs the window-level dead-man listeners while the page is mounted. */
export function useJogSafety() {
  useEffect(() => {
    const stop = () => stopJog();
    const onVis = () => document.hidden && stopJog();
    window.addEventListener("blur", stop);
    window.addEventListener("contextmenu", stop);
    window.addEventListener("pagehide", stop);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("blur", stop);
      window.removeEventListener("contextmenu", stop);
      window.removeEventListener("pagehide", stop);
      document.removeEventListener("visibilitychange", onVis);
      stopJog();
    };
  }, []);
}

/** Raw UI_COMMANDS publisher for the keyboard pendant / gamepad (their own repeat loops). */
export const publishUiCommand = sendUiCommand;
