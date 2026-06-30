// src/workers/worker-bridge.js
// Main-thread bridge to communicate with the OpenCV worker

import * as logger from '../utils/logger.js';
import { createError } from '../utils/error-handler.js';
import { MODEL_PATHS } from '../utils/constants.js';

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

// Check if card detector is loaded
let cardDetectorReady = false;
async function isCardDetectorReady() {
  return cardDetectorReady;
}

// Load the card detector model
export async function loadCardDetector() {
  if (!initialized) await initOpenCVWorker();

  // Make sure ONNX is initialized
  await initONNXRuntime();

  logger.info('Loading card detector model', { url: MODEL_PATHS.cardDetector }, 'AI');
  const startTime = Date.now();

  const result = await callWorker('loadCardDetectorModel', {
    modelUrl: MODEL_PATHS.cardDetector,
  });

  cardDetectorReady = true;

  const duration = Date.now() - startTime;
  logger.success('Card detector loaded', { duration, ...result }, 'AI');
  return result;
}

// Detect card mask in an image
// Returns { mask: Float32Array, maskWidth, maskHeight, originalWidth, originalHeight }
export async function detectCard(canvas) {
  if (!initialized) await initOpenCVWorker();

  // Ensure model is loaded
  if (!await isCardDetectorReady()) {
    await loadCardDetector();
  }

  const imageBitmap = await createImageBitmap(canvas);

  const result = await callWorker('detectCardMask', {
    imageBitmap,
    width: canvas.width,
    height: canvas.height,
  }, [imageBitmap]);

  return result;
}

// Convert mask Float32Array to a visible canvas (for debugging/preview)
export function maskToCanvas(maskData, maskWidth, maskHeight, threshold = 0.5) {
  const canvas = document.createElement('canvas');
  canvas.width = maskWidth;
  canvas.height = maskHeight;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(maskWidth, maskHeight);
  const pixels = imageData.data;

  for (let i = 0; i < maskData.length; i++) {
    const val = maskData[i];
    const binaryVal = val > threshold ? 255 : 0;
    pixels[i * 4] = binaryVal; // R
    pixels[i * 4 + 1] = binaryVal; // G
    pixels[i * 4 + 2] = binaryVal; // B
    pixels[i * 4 + 3] = 255; // A
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

// Simple in-memory cache: canvas → result
// Key by canvas dimensions + a quick pixel hash
const detectionCache = new Map();
const CACHE_MAX_SIZE = 20;

function quickHash(canvas) {
  const ctx = canvas.getContext('2d');
  // Sample a few pixels for quick fingerprint
  const w = canvas.width;
  const h = canvas.height;
  const samples = [
    ctx.getImageData(0, 0, 1, 1).data,
    ctx.getImageData(w - 1, 0, 1, 1).data,
    ctx.getImageData(0, h - 1, 1, 1).data,
    ctx.getImageData(w - 1, h - 1, 1, 1).data,
    ctx.getImageData(Math.floor(w / 2), Math.floor(h / 2), 1, 1).data,
  ];
  let hash = `${w}x${h}`;
  for (const s of samples) {
    hash += `_${s[0]},${s[1]},${s[2]}`;
  }
  return hash;
}

// THE main pipeline function — what Phase F will use
export async function detectCardInImage(canvas, options = {}) {
  const { useCache = true, onProgress } = options;

  // Check cache
  if (useCache) {
    const key = quickHash(canvas);
    if (detectionCache.has(key)) {
      logger.debug('Card detection cache hit', { key }, 'AI');
      const cached = detectionCache.get(key);
      return { ...cached, fromCache: true };
    }
  }

  // Ensure everything ready
  if (!initialized) {
    onProgress?.('worker_init');
    await initOpenCVWorker();
  }

  if (!cardDetectorReady) {
    onProgress?.('model_load');
    await loadCardDetector();
  }

  onProgress?.('inference');

  // Run detection
  const imageBitmap = await createImageBitmap(canvas);
  const result = await callWorker('detectCardCorners', {
    imageBitmap,
    width: canvas.width,
    height: canvas.height,
  }, [imageBitmap]);

  result.fromCache = false;

  // Cache result (LRU-ish: just clear when full)
  if (useCache && result.found) {
    if (detectionCache.size >= CACHE_MAX_SIZE) {
      const firstKey = detectionCache.keys().next().value;
      detectionCache.delete(firstKey);
    }
    detectionCache.set(quickHash(canvas), result);
  }

  return result;
}

// Clear detection cache (call on store clear or manual reset)
export function clearDetectionCache() {
  detectionCache.clear();
  logger.info('Detection cache cleared', null, 'AI');
}

// Draw detected corners overlay on a canvas (for visual debugging)
export function drawCornersOverlay(sourceCanvas, corners, options = {}) {
  const {
    lineColor = '#22c55e', // green
    lineWidth = 3,
    cornerRadius = 8,
    cornerColor = '#ef4444', // red
  } = options;

  const canvas = document.createElement('canvas');
  canvas.width = sourceCanvas.width;
  canvas.height = sourceCanvas.height;
  const ctx = canvas.getContext('2d');

  // Draw source image
  ctx.drawImage(sourceCanvas, 0, 0);

  if (!corners || corners.length !== 4) return canvas;

  // Draw polygon
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  ctx.lineTo(corners[1].x, corners[1].y);
  ctx.lineTo(corners[2].x, corners[2].y);
  ctx.lineTo(corners[3].x, corners[3].y);
  ctx.closePath();
  ctx.stroke();

  // Draw corner dots
  ctx.fillStyle = cornerColor;
  const labels = ['TL', 'TR', 'BR', 'BL'];
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(corners[i].x, corners[i].y, cornerRadius, 0, Math.PI * 2);
    ctx.fill();

    // Label
    ctx.fillStyle = '#ffffff';
    ctx.fillText(labels[i], corners[i].x, corners[i].y);
    ctx.fillStyle = cornerColor;
  }

  return canvas;
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

// Final high-quality perspective correction
// Uses the ORIGINAL canvas (not processing version) for best quality
// corners must be in original canvas coordinate space
export async function correctCardFinal(canvas, corners, options = {}) {
  if (!initialized) await initOpenCVWorker();

  const {
    outputWidth = 1016, // 86mm @ 300 DPI
    outputHeight = 638, // 54mm @ 300 DPI
    enhance = true,
  } = options;

  const imageBitmap = await createImageBitmap(canvas);

  const result = await callWorker('correctCardFinal', {
    imageBitmap,
    width: canvas.width,
    height: canvas.height,
    corners,
    outputWidth,
    outputHeight,
    enhance,
  }, [imageBitmap]);

  return result;
}
