// src/workers/opencv-worker.js
// OpenCV Web Worker — runs OpenCV.js in a background thread so the main
// thread never freezes during WASM download/init or heavy processing.
// No DOM access here; communication happens via postMessage only.

const OPENCV_CDN_URL = 'https://docs.opencv.org/4.8.0/opencv.js';

let cv = null;
let isReady = false;
let loadPromise = null;

// Load OpenCV inside worker
function loadOpenCV() {
  if (isReady) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    try {
      // importScripts is synchronous and works in workers
      self.Module = {
        onRuntimeInitialized: () => {
          cv = self.cv;
          isReady = true;
          resolve();
        },
      };

      importScripts(OPENCV_CDN_URL);

      // After importScripts, cv exists but WASM may still be initializing
      // The onRuntimeInitialized callback above resolves the promise

      // Some OpenCV versions are ready immediately:
      if (self.cv && typeof self.cv.Mat === 'function') {
        cv = self.cv;
        isReady = true;
        resolve();
      }
    } catch (err) {
      reject(err);
    }
  });

  return loadPromise;
}

// Message handler
self.addEventListener('message', async (e) => {
  const { id, type, payload } = e.data || {};

  try {
    let result;

    switch (type) {
      case 'ping':
        result = { pong: true, ready: isReady };
        break;

      case 'init':
        await loadOpenCV();
        result = {
          ready: true,
          version: cv.getBuildInformation ? 'loaded' : 'ready',
          hasMatType: typeof cv.Mat === 'function',
        };
        break;

      case 'grayscale':
        // Test operation: convert ImageBitmap to grayscale
        await loadOpenCV();
        result = processGrayscale(payload);
        break;

      default:
        throw new Error(`Unknown message type: ${type}`);
    }

    self.postMessage({ id, success: true, result });
  } catch (err) {
    self.postMessage({
      id,
      success: false,
      error: {
        message: err.message || String(err),
        stack: err.stack,
      },
    });
  }
});

// Test operation: grayscale conversion
function processGrayscale({ imageBitmap, width, height }) {
  if (!cv || !isReady) {
    throw new Error('OpenCV not ready');
  }

  // Draw bitmap to OffscreenCanvas
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imageBitmap, 0, 0);

  // Get ImageData → cv.Mat
  const imageData = ctx.getImageData(0, 0, width, height);
  const src = cv.matFromImageData(imageData);
  const dst = new cv.Mat();

  // Convert to grayscale
  cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);

  // Get result back as ImageData
  // Note: grayscale is 1-channel, need to convert back to RGBA for canvas
  const rgba = new cv.Mat();
  cv.cvtColor(dst, rgba, cv.COLOR_GRAY2RGBA);

  // Create ImageBitmap to return (transferable)
  const resultCanvas = new OffscreenCanvas(width, height);
  const resultCtx = resultCanvas.getContext('2d');
  const resultImageData = new ImageData(
    new Uint8ClampedArray(rgba.data),
    width,
    height
  );
  resultCtx.putImageData(resultImageData, 0, 0);

  // Cleanup
  src.delete();
  dst.delete();
  rgba.delete();

  // Return transferable
  return resultCanvas.transferToImageBitmap();
}

// Signal we're ready to receive messages
self.postMessage({ type: 'worker-ready' });
