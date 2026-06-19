// jsdom does not implement fetch — provide a minimal stub so stores that
// call the API don't crash in tests. Individual tests override this via
// vi.spyOn(globalThis, 'fetch') when they need to assert on requests.
if (!globalThis.fetch) {
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )) as typeof fetch;
}
