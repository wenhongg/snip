const path = require('path');
const fs = require('fs');
const { ipcMain } = require('electron');

const EXTENSIONS_DIR = path.join(__dirname, '..', 'extensions');

let extensions = [];
let context = null;

/**
 * Validate that a manifest has the required shape. Returns true if valid.
 */
function validateManifest(manifest, name) {
  if (typeof manifest.name !== 'string' || !manifest.name) {
    console.warn('[Extensions] %s: manifest missing or invalid "name" field — skipping', name);
    return false;
  }
  if (manifest.ipc !== undefined) {
    if (!Array.isArray(manifest.ipc)) {
      console.warn('[Extensions] %s: "ipc" must be an array — skipping', name);
      return false;
    }
    for (var i = 0; i < manifest.ipc.length; i++) {
      var entry = manifest.ipc[i];
      if (!entry || typeof entry !== 'object' || typeof entry.channel !== 'string' || typeof entry.method !== 'string') {
        console.warn('[Extensions] %s: ipc[%d] must have string "channel" and "method" — skipping', name, i);
        return false;
      }
    }
  }
  if (manifest.toolbarPosition !== undefined && typeof manifest.toolbarPosition !== 'number') {
    console.warn('[Extensions] %s: "toolbarPosition" must be a number — skipping', name);
    return false;
  }
  return true;
}

/**
 * Load active extension manifests listed in extensions.json.
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
      if (!validateManifest(manifest, name)) continue;
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

    // Prevent path escape via renderer field
    if (ext.renderer && (ext.renderer.includes('..') || path.isAbsolute(ext.renderer))) {
      // Allow built-in extensions that reference ../../renderer/tools/ (existing pattern)
      var absRendererPath = path.resolve(ext._dir, ext.renderer);
      var realRendererPath;
      try { realRendererPath = fs.realpathSync(absRendererPath); } catch { realRendererPath = absRendererPath; }
      var appRoot = path.resolve(__dirname, '..', '..');
      if (!realRendererPath.startsWith(appRoot + path.sep)) {
        console.warn('[Extensions] %s: renderer field escapes app directory — skipping', ext.name);
        continue;
      }
    }

    // Verify main module path resolves inside extensions dir (symlink protection)
    var mainPath = path.join(ext._dir, ext.main);
    try {
      var realMainPath = fs.realpathSync(mainPath);
      if (!realMainPath.startsWith(path.resolve(EXTENSIONS_DIR) + path.sep)) {
        // Allow built-in paths that resolve inside src/main/ (existing extensions reference ../../main/)
        var appRoot = path.resolve(__dirname, '..', '..');
        if (!realMainPath.startsWith(appRoot + path.sep)) {
          console.warn('[Extensions] %s: main module resolves outside app via symlink — skipping', ext.name);
          continue;
        }
      }
    } catch {
      // File doesn't exist yet — will fail at require() below
    }

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
      // Check for channel collisions
      if (ipcMain.listenerCount(ipcEntry.channel) > 0) {
        console.warn('[Extensions] %s: channel "%s" already registered — skipping', ext.name, ipcEntry.channel);
        continue;
      }

      const method = mod[ipcEntry.method];
      if (typeof method !== 'function') {
        console.warn('[Extensions] %s: method "%s" not found in main module', ext.name, ipcEntry.method);
        continue;
      }

      if (ipcEntry.type === 'on') {
        ipcMain.on(ipcEntry.channel, function (event, ...args) {
          try {
            method.call(mod, event, ...args);
          } catch (err) {
            console.error('[Extensions] %s IPC handler error on %s:', ext.name, ipcEntry.channel, err.message);
          }
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
 * Call a lifecycle hook on all extensions that export it.
 */
function callExtensionHook(hookName) {
  for (const ext of extensions) {
    if (!ext.main) continue;
    try {
      var mainPath = path.join(ext._dir, ext.main);
      var mod = require(mainPath);
      if (typeof mod[hookName] === 'function') {
        var result = mod[hookName]();
        // Catch async rejections
        if (result && typeof result.catch === 'function') {
          result.catch(function (err) {
            console.warn('[Extensions] %s %s() rejected: %s', ext.name, hookName, err.message);
          });
        }
      }
    } catch (err) {
      console.warn('[Extensions] %s %s() failed: %s', ext.name, hookName, err.message);
    }
  }
}

function killWorkers() {
  callExtensionHook('killWorker');
}

function warmUp() {
  callExtensionHook('warmUp');
}

module.exports = { loadAll, setContext, registerIpcHandlers, getToolExtensions, getRendererManifest, killWorkers, warmUp };
