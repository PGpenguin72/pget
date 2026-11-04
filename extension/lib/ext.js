// The WebExtension API object shared by every script.
// Firefox exposes the promise-based `browser` namespace; Chrome / Edge expose
// `chrome` (promise-based in MV3). Always use `ext.*` so the same source runs
// in both. Firefox's `browser.*` rejects unexpected callback arguments, so call
// every API in promise style (no callbacks).
export const ext = globalThis.browser ?? globalThis.chrome;

/** True when running in Firefox (moz-extension:// pages). */
export const IS_FIREFOX = ext.runtime.getURL('').startsWith('moz-extension:');
