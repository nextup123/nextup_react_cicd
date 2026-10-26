import { Suspense, lazy, useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./layout/AppShell";
import { ConfirmHost, Loading, ToastHost } from "./components/ui";
import { PageErrorBoundary } from "./layout/PageErrorBoundary";
import { ROUTES, DEFAULT_ROUTE } from "./nav";
import { subscribe } from "./lib/ws";
import { toast } from "./store/toast";
import { importRetry } from "./lib/retry";

// The NexRoot runner in its own browser window (no sidebar / top bar)
const RunnerPage = lazy(importRetry(() => import("./pages/runner/RunnerPage.jsx")));
function RunnerWindow() {
  useEffect(() => {
    document.title = "NexRoot Runner · NextUp";
  }, []);
  return (
    <PageErrorBoundary>
      <Suspense fallback={<Loading label="Loading the runner…" />}>
        <RunnerPage standalone />
      </Suspense>
    </PageErrorBoundary>
  );
}

/** Robot behaviour-tree failure popups (BT_TOAST_POPUP) become toasts. */
function useBtToasts() {
  useEffect(
    () =>
      subscribe("BT_TOAST_POPUP", (p) => {
        if (!p?.message) return;
        const kind = p.messageType === "failure" ? "error" : p.messageType === "warn" ? "warning" : "success";
        toast[kind](p.message, { title: "Robot", duration: p.duration > 0 ? p.duration * 1000 : 0 });
      }),
    []
  );
}

/** The robot server caught an error and kept running (SERVER_NOTICE, at most every 10 s). */
function useServerNotices() {
  useEffect(
    () =>
      subscribe("SERVER_NOTICE", (p) => {
        if (p?.text) toast.warning(p.text, { title: "Robot server problem (it keeps running)", duration: 8000 });
      }),
    []
  );
}

export default function App() {
  useBtToasts();
  useServerNotices();
  return (
    <>
      <Routes>
        <Route path="/runner-window" element={<RunnerWindow />} />
        <Route element={<AppShell />}>
          <Route index element={<Navigate to={DEFAULT_ROUTE} replace />} />
          {ROUTES.map((r) => (
            <Route key={r.path} path={`${r.path}/*`} element={<r.component />} />
          ))}
          <Route path="*" element={<Navigate to={DEFAULT_ROUTE} replace />} />
        </Route>
      </Routes>
      <ToastHost />
      <ConfirmHost />
    </>
  );
}
