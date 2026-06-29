import { t, setLanguage, getLanguage } from './locales/index.js';
import * as logger from './utils/logger.js';
import { registerGlobalHandlers, createError } from './utils/error-handler.js';
import * as toast from './ui/toast.js';
import { createUploadZone } from './ui/upload.js';

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

  const zone = createUploadZone({
    container: document.getElementById('upload-area'),
    onFilesAdded: (files) => {
      toast.success(`${files.length} টি ছবি লোড হয়েছে`);
      logger.info('Files added to card sheet module', { count: files.length }, 'UPLOAD');
    },
    onFileRemoved: (file, remaining) => {
      logger.info('File removed', { name: file.name, remaining: remaining.length }, 'UPLOAD');
    },
    onClear: () => {
      logger.info('All files cleared', null, 'UPLOAD');
    },
  });

  document.getElementById('back-home')?.addEventListener('click', () => {
    zone.destroy();
    renderHome();
  });
}

renderHome();

logger.success('App initialized', {
  language: getLanguage(),
  theme: currentTheme,
}, 'APP_INIT');
