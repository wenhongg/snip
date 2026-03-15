/* exported ExtensionLoader */

/**
 * Extension Loader — generates toolbar buttons from extension manifests.
 * The manifest list is received from the main process via IPC (already sorted by toolbarPosition).
 */
var ExtensionLoader = (function () {
  var _extensions = [];

  /**
   * Get the DOM button ID for an extension.
   * Uses manifest `buttonId` if provided, otherwise `tool-{toolId}`.
   */
  function getButtonId(ext) {
    return ext.buttonId || ('tool-' + ext.toolId);
  }

  /**
   * Build toolbar buttons from an array of extension manifests.
   * Data arrives pre-sorted by toolbarPosition from the registry.
   */
  function buildToolbar(extensions) {
    _extensions = extensions || [];
    var container = document.getElementById('toolbar-tools');
    if (!container) return;

    var frag = document.createDocumentFragment();

    _extensions.forEach(function (ext) {
      // Skip processors and tools without a toolId
      if (ext.type === 'processor' || !ext.toolId) return;

      var btn = document.createElement('button');
      btn.id = getButtonId(ext);
      btn.className = 'tool-btn' + (ext.hidden ? ' hidden' : '') + (ext.toolId === 'select' ? ' active' : '');
      btn.setAttribute('data-tooltip', ext.tooltip || ext.displayName);
      btn.innerHTML = ext.icon || '';
      frag.appendChild(btn);
    });

    container.appendChild(frag);
  }

  /**
   * Return the loaded extensions list.
   */
  function getExtensions() {
    return _extensions;
  }

  /**
   * Build the TOOLS constant from loaded extensions.
   * Returns object like { SELECT: 'select', RECT: 'rect', ... }
   */
  function buildToolsEnum() {
    var tools = {};
    _extensions.forEach(function (ext) {
      if (!ext.toolId) return;
      if (ext.type === 'canvas-tool' || ext.type === 'ai-tool') {
        var key = ext.toolId.toUpperCase().replace(/-/g, '_');
        tools[key] = ext.toolId;
      }
    });
    return tools;
  }

  /**
   * Build shortcut-to-tool map from extension manifests.
   */
  function buildShortcutMap() {
    var map = {};
    _extensions.forEach(function (ext) {
      if (!ext.shortcut || !ext.toolId) return;
      if (ext.type === 'canvas-tool' || ext.type === 'ai-tool') {
        map[ext.shortcut.toLowerCase()] = ext.toolId;
      }
    });
    return map;
  }

  /**
   * Build action shortcut map (shortcuts that click a button rather than switch tool mode).
   */
  function buildActionShortcutMap() {
    var map = {};
    _extensions.forEach(function (ext) {
      if (!ext.shortcut || !ext.toolId) return;
      if (ext.type === 'action-tool') {
        map[ext.shortcut.toLowerCase()] = getButtonId(ext);
      }
    });
    return map;
  }

  /**
   * Get toolbar groups for a given toolId.
   */
  function getToolbarGroups(toolId) {
    for (var i = 0; i < _extensions.length; i++) {
      if (_extensions[i].toolId === toolId) {
        return _extensions[i].toolbarGroups || [];
      }
    }
    return [];
  }

  return {
    buildToolbar: buildToolbar,
    getExtensions: getExtensions,
    buildToolsEnum: buildToolsEnum,
    buildShortcutMap: buildShortcutMap,
    buildActionShortcutMap: buildActionShortcutMap,
    getToolbarGroups: getToolbarGroups
  };
})();
