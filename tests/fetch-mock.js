// Lightweight fetch router for confluence-api / confluence-export tests.
// Returns a function that matches request URLs against a list of routes and
// produces a Response-shaped object with the right .ok/.status/.json/.headers.
//
// Route shape:
//   { match: string | RegExp, status?: number, body?: any, headers?: object, error?: Error }
//
// String matchers do an exact match OR an `endsWith` match (handy for path-only
// matching while ignoring origin). RegExp matchers test the full URL.

export function makeFetch(routes) {
  const calls = [];
  async function fetchImpl(url, _opts) {
    calls.push(url);
    for (const r of routes) {
      const matches = typeof r.match === 'string'
        ? (url === r.match || url.endsWith(r.match))
        : r.match.test(url);
      if (!matches) continue;
      if (r.error) throw r.error;
      const status = r.status ?? 200;
      const body = r.body ?? {};
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (h) => (r.headers || {})[h] ?? null },
        json: async () => body,
      };
    }
    return {
      ok: false,
      status: 404,
      headers: { get: () => null },
      json: async () => ({ error: 'no route matched', url }),
    };
  }
  fetchImpl.calls = calls;
  return fetchImpl;
}
