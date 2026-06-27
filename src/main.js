import { success, info } from './utils/logger.js';
import { registerGlobalHandlers, createError, handleError } from './utils/error-handler.js';
import { t, setLanguage, getLanguage } from './locales/index.js';

document.querySelector('#app').innerHTML = `
  <h1>${t('app.title')}</h1>
  <p>${t('app.subtitle')}</p>
  <p>Setup successful ✅</p>
  <p>Logger active — open browser console (F12) to see logs</p>
  <p>Current language: ${getLanguage()}</p>
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
