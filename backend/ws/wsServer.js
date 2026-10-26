// ws/wsServer.js

import { WebSocketServer } from "ws";

class WSServer {
  constructor(server) {
    this.wss = new WebSocketServer({ server, perMessageDeflate: false }); // ✅ attach to existing HTTP server
    this.clients = new Set();
    this.messageHandler = null;
    // Last frame sent per state type (see publishState). Replayed to new
    // clients so a page opened later shows the current state at once.
    this.stateFrames = new Map();
    this.closeHandlers = [];

    this.init();
  }

  init() {
    this.wss.on("connection", (ws) => {
      console.log("WS Client connected");
      this.clients.add(ws);
      for (const frame of this.stateFrames.values()) ws.send(frame);

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data);

          if (this.messageHandler) {
            this.messageHandler(msg, ws);
          }
        } catch (err) {
          console.error("Invalid WS message:", err.message);
        }
      });

      ws.on("close", () => {
        this.clients.delete(ws);
        for (const fn of this.closeHandlers) {
          try {
            fn(ws);
          } catch (err) {
            console.error("WS close handler failed:", err.message);
          }
        }
        console.log("WS Client disconnected");
      });
    });
  }

  /** fn(ws) runs when a client disconnects. */
  onClientClose(fn) {
    this.closeHandlers.push(fn);
  }

  setMessageHandler(handler) {
    this.messageHandler = handler;
  }

  /** Send one message to every client (events: logs, toasts, results). */
  broadcast(msg) {
    if (this.clients.size === 0) return;
    this.sendFrame(JSON.stringify(msg));
  }

  /**
   * Send a state message (joint positions, driver status, IO, BT status...)
   * only when it differs from the last one of the same type. Callers limit
   * the rate; this drops the repeats, which are most messages while a tree
   * runs with the robot standing still.
   */
  publishState(type, payload) {
    const frame = JSON.stringify({ type, payload });
    if (this.stateFrames.get(type) === frame) return false;
    this.stateFrames.set(type, frame);
    if (this.clients.size > 0) this.sendFrame(frame);
    return true;
  }

  /** Forget a cached state so the next publishState always goes out. */
  resetState(type) {
    this.stateFrames.delete(type);
  }

  sendFrame(data) {
    for (const client of this.clients) {
      if (client.readyState === 1) {
        client.send(data);
      }
    }
  }

  close() {
    for (const client of this.clients) {
      client.close();
    }

    this.wss.close(() => {
      console.log("WSS closed");
    });
  }
  sendTo(ws, msg) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(msg));
    }
  }
}

export default WSServer;
