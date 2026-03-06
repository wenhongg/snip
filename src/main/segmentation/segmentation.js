/**
 * Segmentation module — spawns SAM inference in an isolated child process
 * using the system Node.js binary (not Electron's) because ONNX runtime
 * crashes (SIGTRAP) inside Electron's V8.
 */
const child_process = require('child_process');
const path = require('path');
const os = require('os');
const { getModelConfig } = require('../model-paths');
const { findNodeBinary } = require('../node-binary');

let worker = null;
let requestId = 0;
const pendingRequests = new Map();

function getWorker() {
  if (worker && worker.connected && !worker.killed) return worker;

  let workerScript = path.join(__dirname, 'segmentation-worker.js');
  // System Node.js can't read from inside an asar archive —
  // use the unpacked path in the packaged app.
  if (workerScript.includes('app.asar')) {
    workerScript = workerScript.replace('app.asar', 'app.asar.unpacked');
  }
  const nodeBin = findNodeBinary();

  // Pass model cache path to child process so it uses bundled models
  const modelConfig = getModelConfig();
  const childEnv = { ...process.env };
  if (modelConfig.cacheDir) {
    childEnv.SNIP_MODELS_PATH = modelConfig.cacheDir;
  }
  if (!modelConfig.allowRemote) {
    childEnv.SNIP_PACKAGED = '1';
  }
  // Also pass resourcesPath for the child to resolve paths
  if (process.resourcesPath) {
    childEnv.SNIP_RESOURCES_PATH = process.resourcesPath;
  }

  const forkOptions = {
    serialization: 'advanced',
    stdio: ['pipe', 'inherit', 'inherit', 'ipc'],
    env: childEnv
  };

  if (nodeBin) {
    forkOptions.execPath = nodeBin;
  } else {
    childEnv.ELECTRON_RUN_AS_NODE = '1';
  }

  worker = child_process.fork(workerScript, [], forkOptions);

  worker.on('message', (msg) => {
    if (msg.type === 'ready') return;
    const pending = pendingRequests.get(msg.id);
    if (pending) {
      pendingRequests.delete(msg.id);
      if (msg.type === 'error') {
        pending.reject(new Error(msg.error));
      } else {
        pending.resolve(msg.data);
      }
    }
  });

  worker.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.warn('[Segmentation] Worker exited unexpectedly, code:', code, 'signal:', signal);
    }
    worker = null;
    for (const [id, { reject }] of pendingRequests) {
      reject(new Error('Segmentation worker crashed (signal: ' + (signal || code) + ')'));
    }
    pendingRequests.clear();
  });

  worker.on('error', (err) => {
    console.error('[Segmentation] Worker error:', err.message);
  });

  return worker;
}

function checkSupport() {
  const totalMem = os.totalmem();
  if (totalMem < 4 * 1024 * 1024 * 1024) {
    return { supported: false, reason: 'Insufficient memory (need 4GB+)' };
  }
  const nodeBin = findNodeBinary();
  if (!nodeBin) {
    return { supported: false, reason: 'Node.js binary not found' };
  }
  return { supported: true };
}

function generateMask(rgbaPixels, imgWidth, imgHeight, points, cssWidth, cssHeight) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const w = getWorker();
    pendingRequests.set(id, { resolve, reject });

    w.send({
      id,
      type: 'generate-mask',
      rgbaBuffer: Buffer.from(rgbaPixels.buffer, rgbaPixels.byteOffset, rgbaPixels.byteLength),
      imgWidth,
      imgHeight,
      points,
      cssWidth,
      cssHeight
    });
  });
}

function warmUp() {
  const support = checkSupport();
  if (!support.supported) return;
  try {
    const w = getWorker();
    w.send({ type: 'warm-up' });
  } catch (err) {
    console.warn('[Segmentation] Warm-up failed:', err.message);
  }
}

function killWorker() {
  if (worker && !worker.killed) {
    worker.kill();
    worker = null;
  }
}

module.exports = { generateMask, checkSupport, warmUp, killWorker };
