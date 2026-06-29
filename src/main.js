import { t, setLanguage, getLanguage } from './locales/index.js';
import * as logger from './utils/logger.js';
import { registerGlobalHandlers, createError, handleError } from './utils/error-handler.js';
import * as toast from './ui/toast.js';
import { createUploadZone } from './ui/upload.js';
import { addImages, subscribe, getAll, remove, clear, getStats } from './core/image-store.js';
import { loadOpenCV } from './lib/opencv-loader.js';

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
          </div>
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
    toast.warning(t('opencv.loadingHint'), {
      title: t('opencv.loading'),
      duration: 8000,
    });

    // Let the warning toast render before the heavy script load begins.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const loadingToastId = toast.info(t('opencv.loading'), {
      title: t('opencv.loadingHint'),
      duration: 0, // don't auto-dismiss
    });

    try {
      const cv = await loadOpenCV();
      toast.dismiss(loadingToastId);
      toast.success(t('opencv.ready'), {
        title: `OpenCV ${cv.getBuildInformation ? 'loaded' : 'ready'}`,
        recovery: `Mat type available: ${typeof cv.Mat}`,
      });
      logger.success('OpenCV loaded successfully', {
        hasMat: typeof cv.Mat,
        hasImread: typeof cv.imread,
      }, 'OPENCV');
      // Store for console access
      window.__cv = cv;
    } catch (err) {
      toast.dismiss(loadingToastId);
      const formatted = handleError(err);
      toast.error(formatted.userMessage, {
        title: t('opencv.failed'),
        recovery: t('opencv.networkHint'),
      });
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
