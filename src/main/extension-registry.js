const path = require('path');
const fs = require('fs');
const { ipcMain } = require('electron');

const EXTENSIONS_DIR = path.join(__dirname, '..', 'extensions');

let extensions = [];
let context = null;

/**
 * Load all extension manifests from src/extensions/{name}/extension.json
 */
function loadAll() {
  extensions = [];

  // Read the active extensions list
  var registryPath = path.join(EXTENSIONS_DIR, 'extensions.json');
  var activeNames;
  try {
    activeNames = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch {
    console.warn('[Extensions] extensions.json not found or invalid at:', registryPath);
    return;
  }

  if (!Array.isArray(activeNames)) {
    console.warn('[Extensions] extensions.json must be an array');
    return;
  }

  for (const name of activeNames) {
    if (typeof name !== 'string' || name.includes('..') || name.includes('/') || name.includes('\\') || path.isAbsolute(name)) {
      console.warn('[Extensions] Skipping unsafe extension name: %s', name);
      continue;
    }
    var manifestPath = path.join(EXTENSIONS_DIR, name, 'extension.json');
    if (!fs.existsSync(manifestPath)) {
      console.warn('[Extensions] %s listed but extension.json not found', name);
      continue;
    }

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest._dir = path.join(EXTENSIONS_DIR, name);
      extensions.push(manifest);
    } catch (err) {
      console.warn('[Extensions] Failed to load %s: %s', name, err.message);
    }
  }

  extensions.sort(function (a, b) {
    return (a.toolbarPosition || 999) - (b.toolbarPosition || 999);
  });

  console.log('[Extensions] Loaded %d extensions: %s', extensions.length,
    extensions.map(function (e) { return e.name; }).join(', '));
}

/**
 * Set the shared context object that extension main modules receive.
 * Call this before registerIpcHandlers().
 */
function setContext(ctx) {
  context = ctx;
}

/**
 * Require and initialize extension main modules, then register their IPC handlers.
 */
function registerIpcHandlers() {
  for (const ext of extensions) {
    if (!ext.main || !ext.ipc || ext.ipc.length === 0) continue;

    // Prevent path escape via crafted main field
    if (ext.main.includes('..') || path.isAbsolute(ext.main)) {
      console.warn('[Extensions] %s: main field contains path escape — skipping', ext.name);
      continue;
    }

    const mainPath = path.join(ext._dir, ext.main);
    let mod;
    try {
      mod = require(mainPath);
      if (typeof mod.init === 'function') {
        mod.init(context);
      }
    } catch (err) {
      console.warn('[Extensions] Failed to require %s main module: %s', ext.name, err.message);
      continue;
    }

    for (const ipcEntry of ext.ipc) {
      const method = mod[ipcEntry.method];
      if (typeof method !== 'function') {
        console.warn('[Extensions] %s: method "%s" not found in main module', ext.name, ipcEntry.method);
        continue;
      }

      if (ipcEntry.type === 'on') {
        ipcMain.on(ipcEntry.channel, function (event, ...args) {
          method.call(mod, event, ...args);
        });
      } else {
        // Default to 'invoke'
        ipcMain.handle(ipcEntry.channel, function (event, ...args) {
          return method.call(mod, event, ...args);
        });
      }
    }

    console.log('[Extensions] Registered %d IPC handlers for %s', ext.ipc.length, ext.name);
  }
}

/**
 * Return all extensions sorted by toolbarPosition.
 */
function getToolExtensions() {
  return extensions.filter(function (e) {
    return e.type !== 'processor';
  });
}

/**
 * Return serializable extension data for sending to renderer.
 */
function getRendererManifest() {
  var rendererDir = path.join(__dirname, '..', 'renderer');

  return getToolExtensions().map(function (ext) {
    // Resolve renderer script path relative to editor.html location
    var rendererPath = null;
    if (ext.renderer) {
      var absPath = path.resolve(ext._dir, ext.renderer);
      rendererPath = path.relative(rendererDir, absPath);
    }

    return {
      name: ext.name,
      displayName: ext.displayName,
      type: ext.type,
      toolId: ext.toolId,
      buttonId: ext.buttonId,
      icon: ext.icon,
      tooltip: ext.tooltip,
      shortcut: ext.shortcut,
      toolbarPosition: ext.toolbarPosition,
      hidden: ext.hidden || false,
      toolbarGroups: ext.toolbarGroups || [],
      renderer: rendererPath
    };
  });
}

/**
 * Kill worker processes for extensions that have a killWorker export.
 */
function killWorkers() {
  for (const ext of extensions) {
    if (!ext.main) continue;
    try {
      const mainPath = path.join(ext._dir, ext.main);
      const mod = require(mainPath);
      if (typeof mod.killWorker === 'function') {
        mod.killWorker();
      }
    } catch {
      // ignore — module may not be loaded
    }
  }
}

/**
 * Warm up extensions that have a warmUp export.
 */
function warmUp() {
  for (const ext of extensions) {
    if (!ext.main) continue;
    try {
      const mainPath = path.join(ext._dir, ext.main);
      const mod = require(mainPath);
      if (typeof mod.warmUp === 'function') {
        mod.warmUp();
      }
    } catch {
      // ignore
    }
  }
}

module.exports = { loadAll, setContext, registerIpcHandlers, getToolExtensions, getRendererManifest, killWorkers, warmUp };
