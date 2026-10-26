import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import "@fontsource-variable/inter";
import "./styles/tokens.css";
import "./styles/themes.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/layout.css";
import App from "./App";
import { AppErrorBoundary } from "./layout/PageErrorBoundary";
import { queryClient } from "./lib/queryClient";
import { connect, send, subscribe } from "./lib/ws";
import { initRobotStore, useRobot } from "./store/robot";
import { robotApi } from "./lib/robotApi";
import { installThemedTooltips } from "./lib/themedTooltips";

initRobotStore();
installThemedTooltips();
// On every (re)connect ask for state that is only sent on request.
subscribe("__OPEN__", () => {
  send("GET_ROSBRIDGE_STATUS");
  send("GET_SERVO_FRAME");
  send("REQUEST_GPIO_STATE");
  send("DETECT_MODE");
  // Recent supervisor / drive / IO events (state topics are replayed by the server)
  robotApi
    .state()
    .then((st) => useRobot.setState({ robotEvents: st.recentEvents || [], ioEvents: st.recentIo || [], homes: st.homes || useRobot.getState().homes }))
    .catch(() => {});
});
connect();

// Errors nobody caught (a failed request in a timer, a broken message) are logged, never fatal.
window.addEventListener("unhandledrejection", (e) => {
  console.warn("[console] unhandled", e.reason);
  e.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
