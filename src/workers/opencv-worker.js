// src/workers/opencv-worker.js
// OpenCV Web Worker — runs OpenCV.js in a background thread so the main
// thread never freezes during WASM download/init or heavy processing.
// No DOM access here; communication happens via postMessage only.

const OPENCV_CDN_URL = 'https://docs.opencv.org/4.8.0/opencv.js';

let cv = null;
let isReady = false;
let loadPromise = null;

// ONNX Runtime state.
// NOTE: deliberately NOT named `ort` — ort.min.js itself declares a
// top-level `ort` global when loaded via importScripts() into this same
// worker scope, and a pre-existing `let ort` here would collide with it
// ("Identifier 'ort' has already been declared") on every load attempt.
let ortRuntime = null;
let ortReady = false;
let ortLoadPromise = null;
let ortBackend = 'unknown';

// Model state
let cardDetectorSession = null;
let modelLoadPromise = null;

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

      case 'initONNX':
        await loadONNXRuntime();
        result = {
          ready: true,
          backend: ortBackend,
          version: 'onnxruntime-web',
        };
        break;

      case 'onnxTestInference':
        await loadONNXRuntime();
        result = await runOnnxTestInference();
        break;

      case 'loadCardDetectorModel':
        await loadONNXRuntime();
        result = await loadCardDetectorModel(payload);
        break;

      case 'detectCardMask':
        await loadONNXRuntime();
        result = await detectCardMask(payload);
        break;

      case 'detectCardCorners':
        await loadONNXRuntime();
        result = await detectCardCorners(payload);
        break;

      case 'correctCardFinal':
        await loadONNXRuntime(); // ensure cv too via loadOpenCV path
        result = await correctCardFinal(payload);
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

// Final high-quality perspective correction
// Uses original (full-res) canvas data, not the downsized processing version
async function correctCardFinal({ imageBitmap, width, height, corners, outputWidth, outputHeight, enhance = true }) {
  if (!cv || !isReady) throw new Error('OpenCV not ready');
  if (!corners || corners.length !== 4) throw new Error('4 corners required');

  const src = bitmapToMat(imageBitmap, width, height);
  const dst = new cv.Mat();

  try {
    // Order corners properly
    const ordered = orderCorners(corners);

    // Source points
    const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
      ordered.tl.x, ordered.tl.y,
      ordered.tr.x, ordered.tr.y,
      ordered.br.x, ordered.br.y,
      ordered.bl.x, ordered.bl.y,
    ]);

    // Destination points (clean rectangle)
    const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0,
      outputWidth, 0,
      outputWidth, outputHeight,
      0, outputHeight,
    ]);

    // Transformation matrix
    const M = cv.getPerspectiveTransform(srcPts, dstPts);

    // Apply warp with high-quality interpolation
    const dsize = new cv.Size(outputWidth, outputHeight);
    cv.warpPerspective(
      src, dst, M, dsize,
      cv.INTER_CUBIC, // higher quality than INTER_LINEAR
      cv.BORDER_REPLICATE
    );

    // Optional: quality enhancement
    if (enhance) {
      // 1. Slight sharpening using unsharp mask technique
      const blurred = new cv.Mat();
      cv.GaussianBlur(dst, blurred, new cv.Size(0, 0), 1.5);
      cv.addWeighted(dst, 1.5, blurred, -0.5, 0, dst);
      blurred.delete();

      // 2. Auto contrast (simple: stretch histogram)
      // Convert to LAB color space for L channel processing
      const lab = new cv.Mat();
      cv.cvtColor(dst, lab, cv.COLOR_RGBA2RGB);
      cv.cvtColor(lab, lab, cv.COLOR_RGB2Lab);

      const labChannels = new cv.MatVector();
      cv.split(lab, labChannels);

      // Apply CLAHE to L channel
      const lChannel = labChannels.get(0);
      const clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
      clahe.apply(lChannel, lChannel);
      clahe.delete();

      // Merge back
      cv.merge(labChannels, lab);
      cv.cvtColor(lab, lab, cv.COLOR_Lab2RGB);
      cv.cvtColor(lab, dst, cv.COLOR_RGB2RGBA);

      lab.delete();
      labChannels.delete();
    }

    // Convert result to ImageBitmap
    const resultBitmap = matToBitmap(dst, outputWidth, outputHeight);

    srcPts.delete();
    dstPts.delete();
    M.delete();

    return {
      correctedBitmap: resultBitmap,
      width: outputWidth,
      height: outputHeight,
      enhanced: enhance,
    };
  } finally {
    src.delete();
    dst.delete();
  }
}

// Load ONNX Runtime inside worker. Self-hosted from /onnxruntime/ (same
// origin) is tried first — this avoids third-party CDN domains, which are
// commonly blocked by ad-blockers/antivirus on shop computers. CDN URLs
// are kept as a last-resort fallback for environments where the local
// build is missing the assets.
function loadONNXRuntime() {
  if (ortReady) return Promise.resolve();
  if (ortLoadPromise) return ortLoadPromise;

  ortLoadPromise = new Promise((resolve, reject) => {
    try {
      // If a prior attempt in this same worker already evaluated ort.min.js
      // (e.g. partially, before throwing for an unrelated reason), self.ort
      // may already exist. Reuse it instead of trying to import again —
      // re-running importScripts on a script that top-level const/let
      // declares globals throws "Identifier has already been declared".
      if (self.ort) {
        ortRuntime = self.ort;
        ortRuntime.env.wasm.wasmPaths = ortRuntime.env.wasm.wasmPaths || `${self.location.origin}/onnxruntime/`;
        ortBackend = 'wasm';
        ortReady = true;
        resolve();
        return;
      }

      const ORT_VERSION = '1.17.1';
      const BASES = [
        `${self.location.origin}/onnxruntime/`, // self-hosted, same-origin
        `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`,
        `https://unpkg.com/onnxruntime-web@${ORT_VERSION}/dist/`,
      ];

      let loadedBase = null;
      const attempts = [];

      for (const base of BASES) {
        const url = `${base}ort.min.js`;
        try {
          importScripts(url);
          loadedBase = base;
          break;
        } catch (err) {
          // If the script already partially executed in an earlier attempt,
          // self.ort may now exist even though importScripts just threw.
          if (self.ort) {
            loadedBase = base;
            break;
          }
          attempts.push({ url, error: err.message || String(err) });
        }
      }

      if (!loadedBase || !self.ort) {
        reject(new Error(
          `ONNX Runtime failed to load from all sources: ${JSON.stringify(attempts)}`
        ));
        return;
      }

      ortRuntime = self.ort;

      // Configure WASM paths (point to whichever source succeeded)
      ortRuntime.env.wasm.wasmPaths = loadedBase;

      // Detect available backends
      // Try wasm first (most compatible), can later try webgpu
      ortBackend = 'wasm';

      ortReady = true;
      resolve();
    } catch (err) {
      reject(err);
    }
  }).catch((err) => {
    // Allow a clean retry on the next call instead of replaying this
    // same rejected promise forever.
    ortLoadPromise = null;
    throw err;
  });

  return ortLoadPromise;
}

// Test ONNX with a tiny manually-created tensor (no model needed)
async function runOnnxTestInference() {
  if (!ortRuntime || !ortReady) throw new Error('ONNX Runtime not ready');

  // Create a small tensor manually to verify ort.Tensor works
  const data = Float32Array.from([1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
  const tensor = new ortRuntime.Tensor('float32', data, [2, 3]);

  return {
    tensorCreated: true,
    tensorType: tensor.type,
    tensorDims: tensor.dims,
    tensorDataLength: tensor.data.length,
    backend: ortBackend,
    ortAvailable: typeof ortRuntime === 'object',
    inferenceSessionAvailable: typeof ortRuntime.InferenceSession === 'function',
  };
}

// Load the U²-Net model
async function loadCardDetectorModel({ modelUrl }) {
  if (cardDetectorSession) {
    return { loaded: true, cached: true };
  }
  if (modelLoadPromise) {
    await modelLoadPromise;
    return { loaded: true, cached: true };
  }

  modelLoadPromise = (async () => {
    try {
      // ortRuntime is the variable we renamed from `ort` in Task E1
      cardDetectorSession = await ortRuntime.InferenceSession.create(modelUrl, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });

      return cardDetectorSession;
    } catch (err) {
      modelLoadPromise = null;
      throw err;
    }
  })();

  await modelLoadPromise;

  // Inspect model
  const inputNames = cardDetectorSession.inputNames;
  const outputNames = cardDetectorSession.outputNames;

  return {
    loaded: true,
    cached: false,
    inputNames,
    outputNames,
  };
}

// Run card detection on an image
// Input: ImageBitmap + dimensions
// Output: a probability mask (Float32Array) at model's native size (320x320)
async function detectCardMask({ imageBitmap, width, height }) {
  if (!cardDetectorSession) {
    throw new Error('Card detector model not loaded. Call loadCardDetectorModel first.');
  }

  const INPUT_SIZE = 320;
  const MEAN = [0.485, 0.456, 0.406];
  const STD = [0.229, 0.224, 0.225];

  // Resize input to 320x320 using OffscreenCanvas
  const canvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imageBitmap, 0, 0, INPUT_SIZE, INPUT_SIZE);
  const imageData = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  const pixels = imageData.data; // RGBA, length = 320*320*4

  // Convert to CHW float32 tensor with normalization
  // Format expected by U²-Net: [1, 3, 320, 320]
  const tensorData = new Float32Array(1 * 3 * INPUT_SIZE * INPUT_SIZE);

  for (let i = 0; i < INPUT_SIZE * INPUT_SIZE; i++) {
    const r = pixels[i * 4] / 255;
    const g = pixels[i * 4 + 1] / 255;
    const b = pixels[i * 4 + 2] / 255;

    // Normalize and arrange in CHW layout
    tensorData[i] = (r - MEAN[0]) / STD[0]; // R channel
    tensorData[i + INPUT_SIZE * INPUT_SIZE] = (g - MEAN[1]) / STD[1]; // G channel
    tensorData[i + 2 * INPUT_SIZE * INPUT_SIZE] = (b - MEAN[2]) / STD[2]; // B channel
  }

  const inputTensor = new ortRuntime.Tensor('float32', tensorData, [1, 3, INPUT_SIZE, INPUT_SIZE]);

  const inputName = cardDetectorSession.inputNames[0];
  const feeds = { [inputName]: inputTensor };

  // Run inference
  const outputs = await cardDetectorSession.run(feeds);
  const outputName = cardDetectorSession.outputNames[0];
  const outputTensor = outputs[outputName];

  // Output is typically [1, 1, 320, 320] — probability mask
  // Extract just the mask data
  const maskData = new Float32Array(outputTensor.data);

  return {
    mask: maskData, // 320x320 = 102400 floats, values in [0, 1]
    maskWidth: INPUT_SIZE,
    maskHeight: INPUT_SIZE,
    originalWidth: width,
    originalHeight: height,
  };
}

// Complete pipeline: AI mask → OpenCV contour → 4 corners
// Input: imageBitmap + dimensions
// Output: { found, corners, confidence, maskCoverage, duration }
async function detectCardCorners({ imageBitmap, width, height }) {
  if (!cardDetectorSession) {
    throw new Error('Card detector not loaded');
  }
  if (!cv || !isReady) {
    throw new Error('OpenCV not ready');
  }

  const startTime = Date.now();

  // Step 1: Run AI to get mask
  // We'll inline the inference here (same logic as detectCardMask)
  const INPUT_SIZE = 320;
  const MEAN = [0.485, 0.456, 0.406];
  const STD = [0.229, 0.224, 0.225];

  // Resize to 320x320
  const aiCanvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
  const aiCtx = aiCanvas.getContext('2d');
  aiCtx.drawImage(imageBitmap, 0, 0, INPUT_SIZE, INPUT_SIZE);
  const aiImageData = aiCtx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  const pixels = aiImageData.data;

  const tensorData = new Float32Array(1 * 3 * INPUT_SIZE * INPUT_SIZE);
  for (let i = 0; i < INPUT_SIZE * INPUT_SIZE; i++) {
    const r = pixels[i * 4] / 255;
    const g = pixels[i * 4 + 1] / 255;
    const b = pixels[i * 4 + 2] / 255;
    tensorData[i] = (r - MEAN[0]) / STD[0];
    tensorData[i + INPUT_SIZE * INPUT_SIZE] = (g - MEAN[1]) / STD[1];
    tensorData[i + 2 * INPUT_SIZE * INPUT_SIZE] = (b - MEAN[2]) / STD[2];
  }

  const inputTensor = new ortRuntime.Tensor('float32', tensorData,
    [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const inputName = cardDetectorSession.inputNames[0];
  const outputs = await cardDetectorSession.run({ [inputName]: inputTensor });
  const outputName = cardDetectorSession.outputNames[0];
  const maskData = outputs[outputName].data; // Float32Array, 320*320

  // Step 2: Convert mask to OpenCV Mat for processing
  // Threshold and convert to 8-bit
  const maskBinary = new Uint8Array(INPUT_SIZE * INPUT_SIZE);
  let maskPixelCount = 0;
  for (let i = 0; i < INPUT_SIZE * INPUT_SIZE; i++) {
    if (maskData[i] > 0.4) {
      maskBinary[i] = 255;
      maskPixelCount++;
    }
  }

  const maskCoverage = maskPixelCount / (INPUT_SIZE * INPUT_SIZE);

  // If no mask detected, return early
  if (maskCoverage < 0.01) {
    return {
      found: false,
      corners: null,
      confidence: 0,
      maskCoverage,
      duration: Date.now() - startTime,
      reason: 'No significant mask detected',
    };
  }

  // Create cv.Mat from mask
  const maskMat = cv.matFromArray(INPUT_SIZE, INPUT_SIZE, cv.CV_8UC1,
    Array.from(maskBinary));

  // Step 3: Morphological operations to clean mask
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7));
  const cleaned = new cv.Mat();
  cv.morphologyEx(maskMat, cleaned, cv.MORPH_CLOSE, kernel);
  cv.morphologyEx(cleaned, cleaned, cv.MORPH_OPEN, kernel);

  // Step 4: Find contours
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(cleaned, contours, hierarchy, cv.RETR_EXTERNAL,
    cv.CHAIN_APPROX_SIMPLE);

  let bestQuad = null;
  let bestArea = 0;
  let bestConfidence = 0;

  // Step 5: Find best quad-shaped contour
  for (let i = 0; i < contours.size(); i++) {
    const contour = contours.get(i);
    const area = cv.contourArea(contour);

    if (area < 100) {
      contour.delete();
      continue;
    }

    const perimeter = cv.arcLength(contour, true);

    // Try multiple epsilon values to get a 4-point polygon
    let approx = null;
    for (const epsilonRatio of [0.02, 0.03, 0.04, 0.05]) {
      const candidate = new cv.Mat();
      cv.approxPolyDP(contour, candidate, epsilonRatio * perimeter, true);
      if (candidate.rows === 4) {
        approx = candidate;
        break;
      }
      candidate.delete();
    }

    if (approx) {
      // Calculate quad's aspect ratio
      const corners4 = [];
      for (let j = 0; j < 4; j++) {
        corners4.push({
          x: approx.data32S[j * 2],
          y: approx.data32S[j * 2 + 1],
        });
      }

      // Find min/max for bounding box
      const xs = corners4.map((c) => c.x);
      const ys = corners4.map((c) => c.y);
      const quadW = Math.max(...xs) - Math.min(...xs);
      const quadH = Math.max(...ys) - Math.min(...ys);
      const aspectRatio = Math.max(quadW, quadH) / Math.min(quadW, quadH);

      // Score components:
      // 1. Mask fill: how much of the mask is inside this quad (use area ratio to mask coverage)
      const maskFillScore = Math.min(1, area / (maskPixelCount + 1));

      // 2. Aspect ratio: ID cards are roughly 1.4-1.8, score higher for closer match
      const idealRatio = 1.586; // Aadhaar/PAN/Voter standard
      const ratioDiff = Math.abs(aspectRatio - idealRatio);
      const aspectScore = Math.max(0, 1 - ratioDiff / 2);

      // 3. Convexity: required for proper card shape
      const isConvex = cv.isContourConvex(approx);
      const convexScore = isConvex ? 1 : 0.3;

      // 4. Size: prefer reasonable-sized detections (not too small, not full image)
      const sizeRatio = area / (INPUT_SIZE * INPUT_SIZE);
      const sizeScore = sizeRatio > 0.05 && sizeRatio < 0.95 ? 1 : 0.5;

      // Combined confidence (weighted average)
      const confidence = (
        maskFillScore * 0.35 +
        aspectScore * 0.25 +
        convexScore * 0.20 +
        sizeScore * 0.20
      );

      if (area > bestArea || confidence > bestConfidence) {
        if (bestQuad) bestQuad.delete();
        bestQuad = approx;
        bestArea = area;
        bestConfidence = confidence;
      } else {
        approx.delete();
      }
    }

    contour.delete();
  }

  let corners = null;

  if (bestQuad) {
    // Extract corners and scale back to original image dimensions
    const scaleX = width / INPUT_SIZE;
    const scaleY = height / INPUT_SIZE;

    corners = [];
    for (let i = 0; i < 4; i++) {
      corners.push({
        x: Math.round(bestQuad.data32S[i * 2] * scaleX),
        y: Math.round(bestQuad.data32S[i * 2 + 1] * scaleY),
      });
    }

    // Order corners (TL, TR, BR, BL)
    corners = orderCorners(corners);
    corners = [corners.tl, corners.tr, corners.br, corners.bl];

    bestQuad.delete();
  }

  // Cleanup
  maskMat.delete();
  cleaned.delete();
  kernel.delete();
  contours.delete();
  hierarchy.delete();

  const duration = Date.now() - startTime;

  return {
    found: corners !== null,
    corners,
    confidence: bestConfidence,
    maskCoverage,
    duration,
    rawMaskCoverage: maskCoverage,
  };
}

// Signal we're ready to receive messages
self.postMessage({ type: 'worker-ready' });
