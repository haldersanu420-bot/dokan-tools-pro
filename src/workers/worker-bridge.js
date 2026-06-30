// src/workers/worker-bridge.js
// Main-thread bridge to communicate with the OpenCV worker

import * as logger from '../utils/logger.js';
import { createError } from '../utils/error-handler.js';

let worker = null;
let messageCounter = 0;
const pendingCalls = new Map(); // id → { resolve, reject }
let workerReadyPromise = null;
let initialized = false;

function ensureWorker() {
  if (worker) return worker;

  logger.info('Creating OpenCV worker', null, 'WORKER');

  // Vite-friendly worker import using ?worker URL pattern
  // We use new Worker with import.meta.url for Vite compatibility.
  // OpenCV.js uses importScripts, which requires a classic (non-module) worker;
  // @vite-ignore skips Vite's static analysis of the options object below.
  worker = new Worker(
    new URL('./opencv-worker.js', import.meta.url),
    /* @vite-ignore */ { type: 'classic' }
  );

  worker.addEventListener('message', (e) => {
    const data = e.data || {};

    // Worker startup signal
    if (data.type === 'worker-ready') {
      logger.debug('Worker thread ready', null, 'WORKER');
      return;
    }

    // Response to a pending call
    const { id, success, result, error } = data;
    const pending = pendingCalls.get(id);
    if (!pending) {
      logger.warn('Received message for unknown id', { id }, 'WORKER');
      return;
    }

    pendingCalls.delete(id);

    if (success) {
      pending.resolve(result);
    } else {
      pending.reject(
        createError('PROCESSING_FAILED', error?.message || 'Worker error')
      );
    }
  });

  worker.addEventListener('error', (e) => {
    logger.error('Worker error event', {
      message: e.message,
      filename: e.filename,
      lineno: e.lineno,
    }, 'WORKER');

    // Reject all pending
    const err = createError('PROCESSING_FAILED', 'Worker crashed: ' + e.message);
    pendingCalls.forEach(({ reject }) => reject(err));
    pendingCalls.clear();

    // Mark worker as dead so next call recreates it
    worker = null;
    initialized = false;
    workerReadyPromise = null;
  });

  worker.addEventListener('messageerror', (e) => {
    logger.error('Worker messageerror', e, 'WORKER');
  });

  return worker;
}

// Send a message to worker and await response
export function callWorker(type, payload, transfer = []) {
  return new Promise((resolve, reject) => {
    const w = ensureWorker();
    const id = `msg_${++messageCounter}_${Date.now()}`;
    pendingCalls.set(id, { resolve, reject });

    try {
      w.postMessage({ id, type, payload }, transfer);
    } catch (err) {
      pendingCalls.delete(id);
      reject(createError('PROCESSING_FAILED', 'Failed to post to worker: ' + err.message));
    }
  });
}

// Initialize OpenCV in worker (call once before any processing)
export function initOpenCVWorker() {
  if (workerReadyPromise) return workerReadyPromise;

  workerReadyPromise = (async () => {
    logger.info('Initializing OpenCV in worker', null, 'WORKER');
    const startTime = Date.now();

    // First ping to confirm worker is alive
    await callWorker('ping');

    // Then trigger OpenCV load inside worker
    const result = await callWorker('init');

    const duration = Date.now() - startTime;
    logger.success('OpenCV worker ready', { duration, ...result }, 'WORKER');
    initialized = true;
    return result;
  })().catch((err) => {
    workerReadyPromise = null; // reset so retry possible
    initialized = false;
    throw err;
  });

  return workerReadyPromise;
}

export function isWorkerReady() {
  return initialized && worker !== null;
}

export function terminateWorker() {
  if (worker) {
    logger.info('Terminating worker', null, 'WORKER');
    worker.terminate();
    worker = null;
    initialized = false;
    workerReadyPromise = null;

    // Reject any pending
    const err = createError('PROCESSING_FAILED', 'Worker terminated');
    pendingCalls.forEach(({ reject }) => reject(err));
    pendingCalls.clear();
  }
}

// Test operation: grayscale a canvas
export async function workerGrayscale(canvas) {
  if (!initialized) await initOpenCVWorker();

  // Transfer canvas as ImageBitmap (zero-copy)
  const imageBitmap = await createImageBitmap(canvas);

  const result = await callWorker('grayscale', {
    imageBitmap,
    width: canvas.width,
    height: canvas.height,
  }, [imageBitmap]); // transferable

  return result; // ImageBitmap of grayscale result
}

// Preprocess: returns edges as ImageBitmap
export async function workerPreprocess(canvas, options = {}) {
  if (!initialized) await initOpenCVWorker();

  const imageBitmap = await createImageBitmap(canvas);

  const result = await callWorker('preprocess', {
    imageBitmap,
    width: canvas.width,
    height: canvas.height,
    blurKernel: options.blurKernel ?? 5,
    cannyLow: options.cannyLow ?? 50,
    cannyHigh: options.cannyHigh ?? 150,
  }, [imageBitmap]);

  return result; // { edgesBitmap, width, height }
}

// Find card-like quadrilateral contours
export async function workerFindContours(canvas, options = {}) {
  if (!initialized) await initOpenCVWorker();

  const imageBitmap = await createImageBitmap(canvas);

  const result = await callWorker('findContours', {
    imageBitmap,
    width: canvas.width,
    height: canvas.height,
    minAreaRatio: options.minAreaRatio ?? 0.02,
    maxAreaRatio: options.maxAreaRatio ?? 0.95,
  }, [imageBitmap]);

  return result; // { quads: [{ corners, area, perimeter }], totalContours, imageWidth, imageHeight }
}

// Perspective correction
export async function workerPerspectiveCorrect(canvas, corners, outputWidth, outputHeight) {
  if (!initialized) await initOpenCVWorker();

  const imageBitmap = await createImageBitmap(canvas);

  const result = await callWorker('perspectiveCorrect', {
    imageBitmap,
    width: canvas.width,
    height: canvas.height,
    corners,
    outputWidth,
    outputHeight,
  }, [imageBitmap]);

  return result; // { correctedBitmap, width, height }
}

// Initialize ONNX Runtime in worker
export function initONNXRuntime() {
  return (async () => {
    if (!initialized) await initOpenCVWorker(); // ensure worker exists

    logger.info('Initializing ONNX Runtime in worker', null, 'ONNX');
    const startTime = Date.now();

    let result;
    try {
      result = await callWorker('initONNX');
    } catch (err) {
      // A worker can be left in a broken state if an earlier attempt
      // declared ort.min.js's top-level globals but failed before fully
      // initializing them — every later importScripts() in that same
      // worker then throws "Identifier 'ort' has already been declared".
      // The only clean recovery is a fresh worker (fresh global scope).
      if (/already been declared/i.test(err?.message || '')) {
        logger.warn('Worker has stale ONNX globals — recreating worker and retrying', null, 'ONNX');
        terminateWorker();
        await initOpenCVWorker();
        result = await callWorker('initONNX');
      } else {
        throw err;
      }
    }

    const duration = Date.now() - startTime;
    logger.success('ONNX Runtime ready', { duration, ...result }, 'ONNX');
    return result;
  })();
}

// Test that ONNX Runtime works (tensor creation, etc.)
export async function testONNXInference() {
  if (!initialized) await initOpenCVWorker();

  const result = await callWorker('onnxTestInference');
  return result;
}

// Helper: paint an ImageBitmap onto a new canvas (caller uses this to display results)
export function bitmapToCanvas(imageBitmap, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imageBitmap, 0, 0);
  imageBitmap.close(); // free GPU memory
  return canvas;
}
