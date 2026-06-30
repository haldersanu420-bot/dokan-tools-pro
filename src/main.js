import { t, setLanguage, getLanguage } from './locales/index.js';
import * as logger from './utils/logger.js';
import { registerGlobalHandlers, createError, handleError } from './utils/error-handler.js';
import * as toast from './ui/toast.js';
import { createUploadZone } from './ui/upload.js';
import { addImages, subscribe, getAll, remove, clear, getStats } from './core/image-store.js';
import {
  initOpenCVWorker,
  workerPreprocess,
  workerFindContours,
  workerPerspectiveCorrect,
  initONNXRuntime,
  testONNXInference,
  loadCardDetector,
  detectCardInImage,
  drawCornersOverlay,
} from './workers/worker-bridge.js';

registerGlobalHandlers();

/** @type {string} Current theme, restored from localStorage on load */
let currentTheme = localStorage.getItem('dokan-tools-theme') || 'light';
document.documentElement.setAttribute('data-theme', currentTheme);

/**
 * Wires up the theme and language toggle buttons. Must be called after
 * every innerHTML render since the buttons are recreated each time.
 */
function attachHeaderListeners() {
  const themeToggleBtn = document.getElementById('theme-toggle');
  if (themeToggleBtn) {
    themeToggleBtn.textContent = currentTheme === 'dark' ? '☀️' : '🌙';
    themeToggleBtn.addEventListener('click', () => {
      currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', currentTheme);
      themeToggleBtn.textContent = currentTheme === 'dark' ? '☀️' : '🌙';
      localStorage.setItem('dokan-tools-theme', currentTheme);
      logger.info('Theme changed', { theme: currentTheme }, 'THEME');
    });
  }

  const langToggleBtn = document.getElementById('lang-toggle');
  langToggleBtn?.addEventListener('click', () => {
    const next = getLanguage() === 'bn' ? 'en' : 'bn';
    setLanguage(next);
    location.reload(); // simple reload for now; later we'll re-render
  });
}

/**
 * Renders the home screen with module selection and the dev test panel.
 */
function renderHome() {
  document.querySelector('#app').innerHTML = `
    <div class="app-layout">
      <header class="app-header">
        <h1>${t('app.title')}</h1>
        <div class="flex gap-2 items-center">
          <button id="lang-toggle" class="btn btn-secondary text-sm" style="min-height: 36px; padding: 6px 12px;">
            ${getLanguage() === 'bn' ? 'EN' : 'বাং'}
          </button>
          <button id="theme-toggle" class="btn btn-icon btn-secondary" aria-label="Toggle dark mode">
            🌙
          </button>
        </div>
      </header>

      <main class="app-main">
        <div class="card">
          <h2>${t('module.selectModule')}</h2>
          <p class="text-muted mt-4">${t('app.subtitle')}</p>

          <div class="flex flex-col gap-4 mt-5">
            <button class="btn btn-primary" id="module-card-sheet">
              📇 ${t('module.cardSheet')}
            </button>
            <button class="btn btn-primary" id="module-passport">
              📸 ${t('module.passportPhoto')}
            </button>
          </div>
        </div>

        <div class="card mt-5">
          <h3>Development Test Panel</h3>
          <p class="text-muted text-sm mt-4">Setup verification</p>
          <div class="flex gap-2 mt-4" style="flex-wrap: wrap;">
            <button class="btn btn-secondary text-sm" id="toast-test-btn">টোস্ট টেস্ট</button>
            <button class="btn btn-secondary text-sm" id="opencv-test-btn">OpenCV টেস্ট</button>
            <button class="btn btn-secondary text-sm" id="ui-freeze-test-btn">UI Freeze টেস্ট</button>
            <button class="btn btn-secondary text-sm" id="cv-pipeline-test-btn">CV Pipeline টেস্ট</button>
            <button class="btn btn-secondary text-sm" id="onnx-test-btn">AI ইঞ্জিন টেস্ট</button>
            <button class="btn btn-secondary text-sm" id="model-load-test-btn">AI মডেল লোড</button>
            <button class="btn btn-secondary text-sm" id="card-detect-test-btn">কার্ড ডিটেক্ট পাইপলাইন টেস্ট</button>
            <button class="btn btn-secondary text-sm" id="detect-uploaded-btn">আপলোডেড ছবিতে কার্ড খুঁজুন</button>
          </div>
          <div id="detection-result-area" style="margin-top: var(--space-4);"></div>
        </div>
      </main>

      <footer class="app-footer">
        ${t('app.title')} v0.1.0
      </footer>
    </div>
  `;

  attachHeaderListeners();

  document.getElementById('module-card-sheet')?.addEventListener('click', () => {
    renderCardSheetModule();
  });
  document.getElementById('module-passport')?.addEventListener('click', () => {
    toast.info('পাসপোর্ট ছবি মডিউল শীঘ্রই আসছে', { title: 'Coming Soon' });
  });

  document.getElementById('toast-test-btn')?.addEventListener('click', () => {
    toast.success('সফল! সব কিছু ঠিকঠাক চলছে');
    setTimeout(() => toast.info('তথ্য: এটি একটি info toast', { title: 'তথ্যমূলক বার্তা' }), 500);
    setTimeout(() => toast.warning('সাবধান, কিছু একটা ভুল হতে পারে', { title: 'সতর্কবার্তা' }), 1000);
    setTimeout(() => {
      const err = createError('NO_CARD_DETECTED', 'Test error from button');
      toast.showAppError(err);
    }, 1500);
  });

  document.getElementById('opencv-test-btn')?.addEventListener('click', async () => {
    const loadingToastId = toast.info(t('opencv.loading'), {
      title: t('opencv.loadingHint'),
      duration: 0,
    });

    try {
      const startTime = Date.now();
      const result = await initOpenCVWorker();
      const duration = Date.now() - startTime;

      toast.dismiss(loadingToastId);
      toast.success(t('opencv.ready'), {
        title: `Loaded in ${duration}ms`,
        recovery: `Worker active, OpenCV ${result.hasMatType ? 'fully ready' : 'partial'}`,
      });

      logger.success('OpenCV worker initialized', { duration, ...result }, 'OPENCV');
    } catch (err) {
      toast.dismiss(loadingToastId);
      const formatted = handleError(err);
      toast.error(formatted.userMessage, {
        title: t('opencv.failed'),
        recovery: t('opencv.networkHint'),
      });
    }
  });

  document.getElementById('ui-freeze-test-btn')?.addEventListener('click', () => {
    toast.info('পরের ৫ সেকেন্ড UI smooth আছে কিনা দেখুন — clicks, animations সব কাজ করবে');
    let counter = 0;
    const interval = setInterval(() => {
      counter++;
      logger.debug(`UI tick ${counter}`, null, 'UI_TEST');
      if (counter >= 50) clearInterval(interval);
    }, 100);
  });

  document.getElementById('cv-pipeline-test-btn')?.addEventListener('click', async () => {
    const loadingId = toast.info('CV pipeline test চলছে...', { duration: 0 });

    try {
      // Ensure worker ready
      await initOpenCVWorker();

      // Create a test canvas with a white rectangle on dark background (simulates a card)
      const testCanvas = document.createElement('canvas');
      testCanvas.width = 800;
      testCanvas.height = 600;
      const ctx = testCanvas.getContext('2d');
      ctx.fillStyle = '#222';
      ctx.fillRect(0, 0, 800, 600);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(150, 100, 500, 400); // a 500x400 white rect

      // Test 1: preprocess (should return edges)
      const t1 = Date.now();
      const preResult = await workerPreprocess(testCanvas);
      const preDuration = Date.now() - t1;
      logger.success('Preprocess done', { duration: preDuration, hasBitmap: !!preResult.edgesBitmap }, 'CV_TEST');

      // Test 2: find contours (should find at least 1 quad)
      const t2 = Date.now();
      const contoursResult = await workerFindContours(testCanvas);
      const contoursDuration = Date.now() - t2;
      logger.success('Find contours done', {
        duration: contoursDuration,
        quadsFound: contoursResult.quads.length,
        totalContours: contoursResult.totalContours,
      }, 'CV_TEST');

      // Test 3: if a quad found, perspective correct it
      let perspectiveDuration = 0;
      if (contoursResult.quads.length > 0) {
        const corners = contoursResult.quads[0].corners;
        const t3 = Date.now();
        const corrected = await workerPerspectiveCorrect(testCanvas, corners, 600, 400);
        perspectiveDuration = Date.now() - t3;
        logger.success('Perspective correct done', {
          duration: perspectiveDuration,
          hasBitmap: !!corrected.correctedBitmap,
        }, 'CV_TEST');

        // Store results for inspection
        window.__cvTestResults = { preResult, contoursResult, corrected };
      } else {
        window.__cvTestResults = { preResult, contoursResult };
      }

      toast.dismiss(loadingId);
      toast.success('CV Pipeline সফল!', {
        title: `${contoursResult.quads.length} টি quad পাওয়া গেছে`,
        recovery: `Preprocess: ${preDuration}ms, Contours: ${contoursDuration}ms, Perspective: ${perspectiveDuration}ms`,
      });
    } catch (err) {
      toast.dismiss(loadingId);
      const formatted = handleError(err);
      toast.error(formatted.userMessage, {
        title: 'CV Pipeline ব্যর্থ',
        recovery: err.message,
      });
      logger.error('CV pipeline test failed', err, 'CV_TEST');
    }
  });

  document.getElementById('onnx-test-btn')?.addEventListener('click', async () => {
    const loadingId = toast.info(t('ai.loading'), {
      title: t('ai.loadingHint'),
      duration: 0,
    });

    try {
      // Init ONNX in worker
      const t1 = Date.now();
      const initResult = await initONNXRuntime();
      const initDuration = Date.now() - t1;

      // Test inference (tensor creation)
      const t2 = Date.now();
      const testResult = await testONNXInference();
      const inferenceDuration = Date.now() - t2;

      toast.dismiss(loadingId);
      toast.success(t('ai.ready'), {
        title: `Init: ${initDuration}ms, Test: ${inferenceDuration}ms`,
        recovery: `Backend: ${testResult.backend}, Tensor dims: [${testResult.tensorDims.join('x')}]`,
      });

      logger.success('ONNX Runtime initialized + tested', {
        initDuration,
        inferenceDuration,
        ...testResult,
      }, 'ONNX');

      // Store for inspection
      window.__onnxTest = testResult;
    } catch (err) {
      toast.dismiss(loadingId);
      const formatted = handleError(err);
      toast.error(formatted.userMessage, {
        title: t('ai.failed'),
        recovery: err.message,
      });
      logger.error('ONNX test failed', err, 'ONNX');
    }
  });

  document.getElementById('model-load-test-btn')?.addEventListener('click', async () => {
    const loadingId = toast.info(t('ai.modelLoading'), { duration: 0 });

    try {
      const startTime = Date.now();
      const result = await loadCardDetector();
      const duration = Date.now() - startTime;

      toast.dismiss(loadingId);
      toast.success(t('ai.modelReady'), {
        title: `Loaded in ${duration}ms`,
        recovery: `Cached: ${result.cached}, Inputs: ${result.inputNames?.join(',')}`,
      });

      logger.success('Model loaded', { duration, ...result }, 'AI');
    } catch (err) {
      toast.dismiss(loadingId);
      toast.error(err.message || 'Model load failed', {
        title: t('ai.failed'),
        duration: 8000,
      });
      logger.error('Model load failed', err, 'AI');
    }
  });

  document.getElementById('card-detect-test-btn')?.addEventListener('click', async () => {
    const loadingId = toast.info('পাইপলাইন চলছে...', { duration: 0 });

    try {
      // Create test image (better simulation of an ID card)
      const testCanvas = document.createElement('canvas');
      testCanvas.width = 800;
      testCanvas.height = 600;
      const ctx = testCanvas.getContext('2d');

      // Dark background
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, 800, 600);

      // Card with slight rotation
      ctx.save();
      ctx.translate(400, 300);
      ctx.rotate(0.08); // ~5 degrees

      // Card body
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-220, -140, 440, 280);

      // Card content
      ctx.fillStyle = '#cccccc';
      ctx.fillRect(-200, -120, 110, 110); // photo
      ctx.fillStyle = '#333';
      ctx.font = '16px sans-serif';
      ctx.fillText('Sample ID Card', -80, -100);
      ctx.font = '12px sans-serif';
      ctx.fillText('Name: Test User', -80, -70);
      ctx.fillText('DOB: 01/01/2000', -80, -50);

      ctx.restore();

      // Run pipeline
      const result = await detectCardInImage(testCanvas, {
        onProgress: (stage) => {
          logger.debug(`Pipeline stage: ${stage}`, null, 'AI_PIPELINE');
        },
      });

      toast.dismiss(loadingId);

      if (result.found) {
        toast.success(`কার্ড পাওয়া গেছে!`, {
          title: `${result.duration}ms — Confidence: ${(result.confidence * 100).toFixed(1)}%`,
          recovery: `Coverage: ${(result.maskCoverage * 100).toFixed(1)}%`,
        });

        // Visualize result
        const overlayCanvas = drawCornersOverlay(testCanvas, result.corners);
        const resultArea = document.getElementById('detection-result-area');
        if (resultArea) {
          resultArea.innerHTML = `
            <div class="card">
              <h4>Detection Result</h4>
              <p class="text-sm text-muted mt-4">
                Corners (4): ${result.corners.map((c) => `(${c.x}, ${c.y})`).join(', ')}
              </p>
            </div>
          `;
          overlayCanvas.style.maxWidth = '100%';
          overlayCanvas.style.marginTop = '12px';
          overlayCanvas.style.borderRadius = '8px';
          resultArea.querySelector('.card').appendChild(overlayCanvas);
        }
      } else {
        toast.warning('কার্ড পাওয়া যায়নি', {
          title: `Coverage: ${(result.maskCoverage * 100).toFixed(1)}%`,
          recovery: result.reason || 'Try a different image',
        });
      }

      window.__lastDetection = result;
    } catch (err) {
      toast.dismiss(loadingId);
      toast.error(err.message, { title: 'পাইপলাইন ব্যর্থ' });
      logger.error('Pipeline test failed', err, 'AI_PIPELINE');
    }
  });

  // Detect on actual uploaded images via image-store
  document.getElementById('detect-uploaded-btn')?.addEventListener('click', async () => {
    const { getReady } = await import('./core/image-store.js');
    const readyImages = getReady();

    if (readyImages.length === 0) {
      toast.warning('কোনো আপলোডেড ছবি নেই', {
        recovery: 'প্রথমে আইডি কার্ড মডিউলে গিয়ে ছবি আপলোড করুন',
      });
      return;
    }

    const loadingId = toast.info(`${readyImages.length} টি ছবিতে কার্ড খুঁজছি...`, { duration: 0 });
    const resultArea = document.getElementById('detection-result-area');
    if (resultArea) resultArea.innerHTML = '';

    let foundCount = 0;

    try {
      for (let i = 0; i < readyImages.length; i++) {
        const entry = readyImages[i];
        const sourceCanvas = entry.loaded.processing.canvas;

        logger.info(`Detecting in image ${i + 1}/${readyImages.length}`,
          { filename: entry.file.name }, 'AI_PIPELINE');

        const result = await detectCardInImage(sourceCanvas);

        if (result.found) foundCount++;

        // Visualize
        if (resultArea) {
          const block = document.createElement('div');
          block.className = 'card';
          block.style.marginTop = '12px';

          const title = document.createElement('div');
          title.innerHTML = `<strong>${entry.file.name}</strong><br>
            <span class="text-sm text-muted">
              ${result.found ? '✅ Found' : '❌ Not found'} —
              ${result.duration}ms,
              Coverage: ${(result.maskCoverage * 100).toFixed(1)}%
            </span>`;
          block.appendChild(title);

          if (result.found) {
            const overlay = drawCornersOverlay(sourceCanvas, result.corners);
            overlay.style.maxWidth = '100%';
            overlay.style.marginTop = '8px';
            overlay.style.borderRadius = '8px';
            block.appendChild(overlay);
          }

          resultArea.appendChild(block);
        }
      }

      toast.dismiss(loadingId);
      toast.success(`${foundCount}/${readyImages.length} টি ছবিতে কার্ড পাওয়া গেছে`);
    } catch (err) {
      toast.dismiss(loadingId);
      toast.error(err.message, { title: 'ব্যর্থ' });
      logger.error('Uploaded detection failed', err, 'AI_PIPELINE');
    }
  });
}

/**
 * Renders the ID Card Sheet module with the file upload zone.
 */
function renderCardSheetModule() {
  document.querySelector('#app').innerHTML = `
    <div class="app-layout">
      <header class="app-header">
        <button id="back-home" class="btn btn-secondary text-sm" style="min-height: 36px; padding: 6px 12px;">
          ← ${t('button.back')}
        </button>
        <h1>${t('module.cardSheet')}</h1>
        <div style="width: 60px;"></div>
      </header>
      <main class="app-main">
        <div class="card">
          <div id="upload-area"></div>
        </div>
      </main>
    </div>
  `;

  const unsubscribeStore = subscribe(({ images, stats }) => {
    logger.debug('Image store updated', stats, 'IMAGE_STORE');
  });

  const zone = createUploadZone({
    container: document.getElementById('upload-area'),
    onFilesAdded: (files) => {
      toast.info(`${files.length} টি ছবি যোগ হচ্ছে...`);
      const ids = addImages(files);
      logger.info('Files added to store', { ids, count: ids.length }, 'UPLOAD');

      const interval = setInterval(() => {
        const stats = getStats();
        if (stats.pending === 0 && stats.loading === 0) {
          clearInterval(interval);
          if (stats.failed > 0) {
            toast.warning(`${stats.ready} টি প্রস্তুত, ${stats.failed} টি ব্যর্থ`);
          } else {
            toast.success(`${stats.ready} টি ছবি প্রস্তুত`);
          }
        }
      }, 500);
    },
    onFileRemoved: (file, remaining) => {
      const entry = getAll().find((e) => e.file === file);
      if (entry) {
        remove(entry.id);
        logger.info('Image removed from store', { id: entry.id }, 'IMAGE_STORE');
      }
    },
    onClear: () => {
      const count = clear();
      logger.info('All images cleared', { count }, 'IMAGE_STORE');
    },
  });

  document.getElementById('back-home')?.addEventListener('click', () => {
    zone.destroy();
    unsubscribeStore();
    clear();
    renderHome();
  });
}

renderHome();

logger.success('App initialized', {
  language: getLanguage(),
  theme: currentTheme,
}, 'APP_INIT');
