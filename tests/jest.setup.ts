// preload.ts calls fetch('data.json') from a DOMContentLoaded listener.
// jsdom doesn't implement fetch, so stub it out to avoid noisy rejections;
// none of the tests rely on _loadData's network behavior.
if (typeof (globalThis as any).fetch !== 'function') {
    (globalThis as any).fetch = async () => ({ ok: false, json: async () => ({}) });
}
