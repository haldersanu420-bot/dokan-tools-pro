import { success, info } from './utils/logger.js';

document.querySelector('#app').innerHTML = `
  <h1>দোকান টুলস প্রো</h1>
  <p>Setup successful ✅</p>
  <p>Logger active — open browser console (F12) to see logs</p>
`;

success('App started', { version: '0.1.0' }, 'APP_INIT');
info('Logger system ready', null, 'LOGGER');
