import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      // api.js already tries a read again while the server starts; here one more round for
      // anything else, never for "not found" / "bad request" answers
      retry: (count, err) => count < 2 && !(err?.status >= 400 && err?.status < 500),
      // a failed retry waits longer each time (1 s, 2 s, 4 s … 15 s): no burst of requests
      // against a server that is restarting
      retryDelay: (n) => Math.min(1000 * 2 ** n, 15_000),
      refetchOnWindowFocus: false,
    },
    // a command is sent now or fails now: never queued while offline and sent later
    mutations: { networkMode: "always" },
  },
});
