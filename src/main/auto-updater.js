const { BrowserWindow, dialog } = require('electron');

const CHECK_DELAY_MS = 10000;
const RECHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

var timeoutHandle = null;
var intervalHandle = null;
var updaterRef = null;

function getParentWindow() {
  return BrowserWindow.getFocusedWindow() ||
    BrowserWindow.getAllWindows().find(function (w) { return !w.isDestroyed(); }) ||
    null;
}

function initAutoUpdater() {
  timeoutHandle = setTimeout(function () {
    timeoutHandle = null;
    try {
      var { autoUpdater } = require('electron-updater');
      updaterRef = autoUpdater;
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = false;
      autoUpdater.logger = null; // suppress default logging

      autoUpdater.on('update-available', function (info) {
        console.log('[AutoUpdate] Update available:', info.version);
        var parent = getParentWindow();
        var showFn = parent ? dialog.showMessageBox.bind(dialog, parent) : dialog.showMessageBox.bind(dialog);
        showFn({
          type: 'info',
          title: 'Update Available',
          message: 'Snip ' + info.version + ' is available.',
          detail: 'Download and install the update?',
          buttons: ['Download', 'Later'],
          defaultId: 1
        }).then(function (result) {
          if (result.response === 0) {
            autoUpdater.downloadUpdate();
          }
        }).catch(function () {});
      });

      autoUpdater.on('update-not-available', function () {
        console.log('[AutoUpdate] Up to date');
      });

      autoUpdater.on('update-downloaded', function (info) {
        console.log('[AutoUpdate] Downloaded:', info.version);
        var parent = getParentWindow();
        var showFn = parent ? dialog.showMessageBox.bind(dialog, parent) : dialog.showMessageBox.bind(dialog);
        showFn({
          type: 'info',
          title: 'Update Ready',
          message: 'Snip ' + info.version + ' has been downloaded.',
          detail: 'Restart now to apply the update.',
          buttons: ['Restart Now', 'Later'],
          defaultId: 1
        }).then(function (result) {
          if (result.response === 0) {
            // Let electron-updater handle the quit + relaunch
            autoUpdater.quitAndInstall(false, true);
          }
        }).catch(function () {});
      });

      autoUpdater.on('error', function (err) {
        console.error('[AutoUpdate] Error:', err.message);
      });

      autoUpdater.checkForUpdates();

      // Periodic re-check for long-running tray app
      intervalHandle = setInterval(function () {
        autoUpdater.checkForUpdates();
      }, RECHECK_INTERVAL_MS);
    } catch (err) {
      console.warn('[AutoUpdate] Not available:', err.message);
    }
  }, CHECK_DELAY_MS);
}

function cancelAutoUpdater() {
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
    timeoutHandle = null;
  }
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  if (updaterRef) {
    updaterRef.removeAllListeners();
    updaterRef = null;
  }
}

module.exports = { initAutoUpdater, cancelAutoUpdater };
