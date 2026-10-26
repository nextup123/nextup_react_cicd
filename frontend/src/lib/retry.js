// Pages must come up complete even when the robot server is still starting, restarting or
// briefly busy: reads (GET) and page code are fetched again a few times before an error shows.
// Commands (POST/PUT/DELETE) are never repeated here.

/** Waits between attempts: 0.4, 0.8, 1.6, 3.2 s (about 6 s in all). */
export const RETRY_DELAYS = [400, 800, 1600, 3200];

/** A failure worth trying again: no answer, or the server not ready / overloaded. */
export const isTransientStatus = (status) => status === 0 || status === 408 || status === 429 || (status >= 500 && status <= 504);

export const wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

/** fetch() for reads: tries again on network errors and 5xx. Resolves to the last Response. */
export async function fetchRetry(url, init = {}, delays = RETRY_DELAYS) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, init);
      if (!isTransientStatus(res.status) || i >= delays.length) return res;
    } catch (err) {
      if (err?.name === "AbortError" || i >= delays.length) throw err;
    }
    await wait(delays[i], init.signal);
  }
}

/** A code loader (dynamic import) that is tried again when the code could not be fetched. */
export function importRetry(load, delays = [500, 1500, 3000]) {
  return async () => {
    for (let i = 0; ; i++) {
      try {
        return await load();
      } catch (err) {
        if (i >= delays.length) throw err;
        await wait(delays[i]);
      }
    }
  };
}
