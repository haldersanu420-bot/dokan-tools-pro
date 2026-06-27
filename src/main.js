import { success, info } from './utils/logger.js';
import { registerGlobalHandlers, createError, handleError } from './utils/error-handler.js';
import { t, setLanguage, getLanguage } from './locales/index.js';
import * as toast from './ui/toast.js';

document.querySelector('#app').innerHTML = `
  <h1>${t('app.title')}</h1>
  <p>${t('app.subtitle')}</p>
  <p>Setup successful ✅</p>
  <p>Logger active — open browser console (F12) to see logs</p>
  <p>Current language: ${getLanguage()}</p>
  <button id="toast-test-btn" style="margin-top: 16px; padding: 8px 16px; cursor: pointer;">
    ${t('toast.test', 'টোস্ট টেস্ট')}
  </button>
`;

registerGlobalHandlers();

success('App started', { version: '0.1.0' }, 'APP_INIT');
info('Logger system ready', null, 'LOGGER');
success('Locales loaded', { lang: getLanguage() }, 'LOCALE');

try {
  throw createError('FILE_TOO_LARGE', 'Test error from main.js');
} catch (err) {
  const formatted = handleError(err);
  info('Test error handled', formatted, 'ERROR_TEST');
}

setTimeout(() => {
  toast.success('অ্যাপ চালু হয়েছে');
}, 1000);

setTimeout(() => {
  toast.info('নতুন ফিচার যুক্ত হয়েছে', {
    title: 'তথ্য',
    recovery: 'বিস্তারিত জানতে রিফ্রেশ করুন',
  });
}, 2000);

document.querySelector('#toast-test-btn').addEventListener('click', () => {
  toast.success('সফল হয়েছে');
  setTimeout(() => toast.info('তথ্যমূলক বার্তা'), 500);
  setTimeout(() => toast.warning('সতর্কবার্তা', { recovery: 'একটু সতর্ক থাকুন' }), 1000);
  setTimeout(() => toast.error('একটি সমস্যা হয়েছে', { recovery: 'আবার চেষ্টা করুন' }), 1500);

  setTimeout(() => {
    const testError = createError('NO_CARD_DETECTED', 'Test AppError for toast.showAppError');
    toast.showAppError(testError);
  }, 2000);
});
