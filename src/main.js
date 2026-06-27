import { success, info } from './utils/logger.js';
import { registerGlobalHandlers, createError, handleError } from './utils/error-handler.js';

document.querySelector('#app').innerHTML = `
  <h1>দোকান টুলস প্রো</h1>
  <p>Setup successful ✅</p>
  <p>Logger active — open browser console (F12) to see logs</p>
`;

registerGlobalHandlers();

success('App started', { version: '0.1.0' }, 'APP_INIT');
info('Logger system ready', null, 'LOGGER');

try {
  throw createError('FILE_TOO_LARGE', 'Test error from main.js');
} catch (err) {
  const formatted = handleError(err);
  info('Test error handled', formatted, 'ERROR_TEST');
}
