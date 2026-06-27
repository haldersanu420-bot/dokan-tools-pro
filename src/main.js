import { t, setLanguage, getLanguage } from './locales/index.js';
import * as logger from './utils/logger.js';
import { registerGlobalHandlers, createError, handleError } from './utils/error-handler.js';
import * as toast from './ui/toast.js';

registerGlobalHandlers();

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

// Theme toggle
const themeToggleBtn = document.getElementById('theme-toggle');
themeToggleBtn?.addEventListener('click', () => {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  themeToggleBtn.textContent = next === 'dark' ? '☀️' : '🌙';
  localStorage.setItem('dokan-tools-theme', next);
  logger.info('Theme changed', { theme: next }, 'THEME');
});

// Restore theme from localStorage
const savedTheme = localStorage.getItem('dokan-tools-theme') || 'light';
document.documentElement.setAttribute('data-theme', savedTheme);
themeToggleBtn.textContent = savedTheme === 'dark' ? '☀️' : '🌙';

// Language toggle
const langToggleBtn = document.getElementById('lang-toggle');
langToggleBtn?.addEventListener('click', () => {
  const next = getLanguage() === 'bn' ? 'en' : 'bn';
  setLanguage(next);
  location.reload(); // simple reload for now; later we'll re-render
});

// Module buttons (placeholders for now)
document.getElementById('module-card-sheet')?.addEventListener('click', () => {
  toast.info('আইডি কার্ড মডিউল শীঘ্রই আসছে', { title: 'Coming Soon' });
});
document.getElementById('module-passport')?.addEventListener('click', () => {
  toast.info('পাসপোর্ট ছবি মডিউল শীঘ্রই আসছে', { title: 'Coming Soon' });
});

// Toast test (keep for now)
document.getElementById('toast-test-btn')?.addEventListener('click', () => {
  toast.success('সফল! সব কিছু ঠিকঠাক চলছে');
  setTimeout(() => toast.info('তথ্য: এটি একটি info toast', { title: 'তথ্যমূলক বার্তা' }), 500);
  setTimeout(() => toast.warning('সাবধান, কিছু একটা ভুল হতে পারে', { title: 'সতর্কবার্তা' }), 1000);
  setTimeout(() => {
    const err = createError('NO_CARD_DETECTED', 'Test error from button');
    toast.showAppError(err);
  }, 1500);
});

logger.success('App initialized', {
  language: getLanguage(),
  theme: savedTheme,
}, 'APP_INIT');
