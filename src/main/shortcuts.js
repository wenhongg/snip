const { globalShortcut } = require('electron');
const { getShortcuts, getDefaultShortcuts } = require('./store');

let captureCallback = null;
let searchCallback = null;
let quickSnipCallback = null;

function registerShortcuts(captureCb, searchCb, quickSnipCb) {
  captureCallback = captureCb;
  searchCallback = searchCb;
  quickSnipCallback = quickSnipCb;
  registerGlobalShortcuts();
}

function registerGlobalShortcuts() {
  const shortcuts = getShortcuts();
  const defaults = getDefaultShortcuts();

  const captureAccel = shortcuts['capture'];
  try {
    const captureRegistered = globalShortcut.register(captureAccel, () => {
      if (captureCallback) {
        captureCallback().catch((err) => {
          console.error('[Snip] Capture shortcut error:', err);
        });
      }
    });
    if (!captureRegistered) {
      console.error('[Snip] Failed to register capture shortcut (%s)', captureAccel);
    }
  } catch (err) {
    console.error('[Snip] Invalid capture accelerator "%s", falling back to default', captureAccel);
    try {
      globalShortcut.register(defaults['capture'], () => {
        if (captureCallback) captureCallback().catch(() => {});
      });
    } catch (fallbackErr) {
      console.error('[Snip] Failed to register default capture shortcut:', fallbackErr);
    }
  }

  const searchAccel = shortcuts['search'];
  try {
    const searchRegistered = globalShortcut.register(searchAccel, () => {
      if (searchCallback) searchCallback();
    });
    if (!searchRegistered) {
      console.error('[Snip] Failed to register search shortcut (%s)', searchAccel);
    }
  } catch (err) {
    console.error('[Snip] Invalid search accelerator "%s", falling back to default', searchAccel);
    try {
      globalShortcut.register(defaults['search'], () => {
        if (searchCallback) searchCallback();
      });
    } catch (fallbackErr) {
      console.error('[Snip] Failed to register default search shortcut:', fallbackErr);
    }
  }

  const quickSnipAccel = shortcuts['quick-snip'];
  try {
    const quickSnipRegistered = globalShortcut.register(quickSnipAccel, () => {
      if (quickSnipCallback) {
        quickSnipCallback().catch((err) => {
          console.error('[Snip] Quick snip shortcut error:', err);
        });
      }
    });
    if (!quickSnipRegistered) {
      console.error('[Snip] Failed to register quick snip shortcut (%s)', quickSnipAccel);
    }
  } catch (err) {
    console.error('[Snip] Invalid quick snip accelerator "%s", falling back to default', quickSnipAccel);
    try {
      globalShortcut.register(defaults['quick-snip'], () => {
        if (quickSnipCallback) quickSnipCallback().catch(() => {});
      });
    } catch (fallbackErr) {
      console.error('[Snip] Failed to register default quick snip shortcut:', fallbackErr);
    }
  }
}

function unregisterShortcuts() {
  globalShortcut.unregisterAll();
}

function reregisterShortcuts() {
  unregisterShortcuts();
  registerGlobalShortcuts();
}

module.exports = { registerShortcuts, unregisterShortcuts, reregisterShortcuts };
