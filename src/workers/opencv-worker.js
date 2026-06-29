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

      case 'preprocess':
        // Full preprocessing pipeline: grayscale → blur → canny
        await loadOpenCV();
        result = processPreprocess(payload);
        break;

      case 'findContours':
        // Find quad-shaped contours (card-like rectangles)
        await loadOpenCV();
        result = processFindContours(payload);
        break;

      case 'perspectiveCorrect':
        // Apply perspective transform given 4 corners → straight rectangle
        await loadOpenCV();
        result = processPerspectiveCorrect(payload);
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

// Helper: convert ImageBitmap to cv.Mat
function bitmapToMat(imageBitmap, width, height) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imageBitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);
  return cv.matFromImageData(imageData);
}

// Helper: convert cv.Mat (RGBA) to ImageBitmap (transferable)
function matToBitmap(mat, width, height) {
  // Ensure 4-channel RGBA
  let rgba;
  let needsCleanup = false;
  if (mat.channels() === 4) {
    rgba = mat;
  } else {
    rgba = new cv.Mat();
    needsCleanup = true;
    if (mat.channels() === 1) {
      cv.cvtColor(mat, rgba, cv.COLOR_GRAY2RGBA);
    } else if (mat.channels() === 3) {
      cv.cvtColor(mat, rgba, cv.COLOR_RGB2RGBA);
    }
  }

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const imageData = new ImageData(
    new Uint8ClampedArray(rgba.data),
    width,
    height
  );
  ctx.putImageData(imageData, 0, 0);

  if (needsCleanup) rgba.delete();

  return canvas.transferToImageBitmap();
}

// Operation: preprocess pipeline (grayscale → blur → canny)
function processPreprocess({ imageBitmap, width, height, blurKernel = 5, cannyLow = 50, cannyHigh = 150 }) {
  if (!cv || !isReady) throw new Error('OpenCV not ready');

  const src = bitmapToMat(imageBitmap, width, height);
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();

  try {
    // Grayscale
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // Gaussian blur
    const ksize = new cv.Size(blurKernel, blurKernel);
    cv.GaussianBlur(gray, blurred, ksize, 0, 0, cv.BORDER_DEFAULT);

    // Canny edge detection
    cv.Canny(blurred, edges, cannyLow, cannyHigh);

    // Return edges as ImageBitmap for preview
    const resultBitmap = matToBitmap(edges, width, height);

    return {
      edgesBitmap: resultBitmap,
      width,
      height,
    };
  } finally {
    src.delete();
    gray.delete();
    blurred.delete();
    edges.delete();
  }
}

// Operation: find quad-shaped contours (potential cards)
function processFindContours({ imageBitmap, width, height, minAreaRatio = 0.02, maxAreaRatio = 0.95 }) {
  if (!cv || !isReady) throw new Error('OpenCV not ready');

  const src = bitmapToMat(imageBitmap, width, height);
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 50, 150);

    // Dilate to close gaps
    const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
    cv.dilate(edges, edges, kernel);
    kernel.delete();

    // Find external contours
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const imageArea = width * height;
    const minArea = imageArea * minAreaRatio;
    const maxArea = imageArea * maxAreaRatio;

    const quads = [];

    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);

      if (area < minArea || area > maxArea) {
        contour.delete();
        continue;
      }

      // Approximate to polygon
      const perimeter = cv.arcLength(contour, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(contour, approx, 0.02 * perimeter, true);

      // We want 4-corner shapes (cards)
      if (approx.rows === 4) {
        const corners = [];
        for (let j = 0; j < 4; j++) {
          corners.push({
            x: approx.data32S[j * 2],
            y: approx.data32S[j * 2 + 1],
          });
        }
        quads.push({
          corners,
          area,
          perimeter,
        });
      }

      approx.delete();
      contour.delete();
    }

    // Sort by area descending
    quads.sort((a, b) => b.area - a.area);

    return {
      quads,
      totalContours: contours.size(),
      imageWidth: width,
      imageHeight: height,
    };
  } finally {
    src.delete();
    gray.delete();
    blurred.delete();
    edges.delete();
    contours.delete();
    hierarchy.delete();
  }
}

// Operation: perspective correction
// Takes 4 corners and warps that quadrilateral to a straight rectangle
function processPerspectiveCorrect({ imageBitmap, width, height, corners, outputWidth, outputHeight }) {
  if (!cv || !isReady) throw new Error('OpenCV not ready');
  if (!corners || corners.length !== 4) {
    throw new Error('Exactly 4 corners required');
  }

  const src = bitmapToMat(imageBitmap, width, height);
  const dst = new cv.Mat();

  try {
    // Order corners: top-left, top-right, bottom-right, bottom-left
    const ordered = orderCorners(corners);

    // Source points (from detected corners)
    const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
      ordered.tl.x, ordered.tl.y,
      ordered.tr.x, ordered.tr.y,
      ordered.br.x, ordered.br.y,
      ordered.bl.x, ordered.bl.y,
    ]);

    // Destination points (output rectangle)
    const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0,
      outputWidth, 0,
      outputWidth, outputHeight,
      0, outputHeight,
    ]);

    // Get transformation matrix
    const M = cv.getPerspectiveTransform(srcPts, dstPts);

    // Apply warp
    const dsize = new cv.Size(outputWidth, outputHeight);
    cv.warpPerspective(src, dst, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

    const resultBitmap = matToBitmap(dst, outputWidth, outputHeight);

    srcPts.delete();
    dstPts.delete();
    M.delete();

    return {
      correctedBitmap: resultBitmap,
      width: outputWidth,
      height: outputHeight,
    };
  } finally {
    src.delete();
    dst.delete();
  }
}

// Helper: order 4 corners as top-left, top-right, bottom-right, bottom-left
function orderCorners(corners) {
  // Sum & diff to identify corners
  // top-left: smallest sum (x+y)
  // bottom-right: largest sum
  // top-right: smallest diff (y-x) or smallest (x-y reversed)
  // bottom-left: largest diff

  const withMetrics = corners.map((c) => ({
    ...c,
    sum: c.x + c.y,
    diff: c.y - c.x,
  }));

  const tl = withMetrics.reduce((a, b) => (a.sum < b.sum ? a : b));
  const br = withMetrics.reduce((a, b) => (a.sum > b.sum ? a : b));
  const tr = withMetrics.reduce((a, b) => (a.diff < b.diff ? a : b));
  const bl = withMetrics.reduce((a, b) => (a.diff > b.diff ? a : b));

  return { tl, tr, br, bl };
}

// Signal we're ready to receive messages
self.postMessage({ type: 'worker-ready' });
