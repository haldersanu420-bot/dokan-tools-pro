/**
 * Locale system for Dokan Tools Pro.
 * Provides a dot-notated translator t(), language switching, and
 * persistence via localStorage. Default language: Bengali (bn).
 *
 * Usage:
 *   import { t, setLanguage, getLanguage, getAvailableLanguages } from './locales/index.js';
 *
 *   t('app.title');               // 'দোকান টুলস প্রো'
 *   t('error.fileTooLarge');      // 'ছবিটি অনেক বড়'
 *   t('missing.key', 'Fallback'); // 'Fallback' if not found in any locale
 *
 *   setLanguage('en');            // switches language, persists choice, fires 'languagechange'
 *   getLanguage();                // 'en'
 *
 *   window.addEventListener('languagechange', (e) => {
 *     console.log('New language:', e.detail.language);
 *   });
 */

import bn from './bn.js';
import en from './en.js';
import { info, warn } from '../utils/logger.js';

/** @type {string} localStorage key used to persist the user's language choice */
const STORAGE_KEY = 'dokan-tools-lang';

/** @type {Record<string, object>} Available locale dictionaries by language code */
const locales = { bn, en };

/** @type {string[]} Supported language codes */
const AVAILABLE_LANGUAGES = ['bn', 'en'];

/**
 * Reads and validates the persisted language choice from localStorage.
 * Falls back to 'bn' if unavailable, invalid, or localStorage throws.
 * @returns {string}
 */
function readStoredLanguage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (AVAILABLE_LANGUAGES.includes(stored)) {
      return stored;
    }
  } catch (err) {
    // localStorage may be unavailable (private mode, disabled storage, etc.)
  }
  return 'bn';
}

/** @type {string} Currently active language code */
let currentLanguage = readStoredLanguage();

/**
 * Looks up a dot-notated key (e.g., 'app.title') inside a locale object.
 * @param {object} locale
 * @param {string} key
 * @returns {string|undefined}
 */
function lookup(locale, key) {
  return key.split('.').reduce((node, part) => {
    return node && typeof node === 'object' ? node[part] : undefined;
  }, locale);
}

/**
 * Translates a dot-notated key using the active language. Falls back to
 * the other available locale, then to the provided fallback, then to the
 * key itself. Logs a warning whenever a key is missing from a locale.
 * @param {string} key - e.g., 'app.title', 'error.fileTooLarge'
 * @param {string} [fallback] - Returned if the key is missing everywhere
 * @returns {string}
 */
export function t(key, fallback) {
  const activeLocale = locales[currentLanguage];
  const activeValue = lookup(activeLocale, key);
  if (activeValue !== undefined) {
    return activeValue;
  }

  warn(`Missing translation key in "${currentLanguage}"`, { key }, 'LOCALE');

  const otherLang = AVAILABLE_LANGUAGES.find((lang) => lang !== currentLanguage);
  const otherValue = otherLang ? lookup(locales[otherLang], key) : undefined;
  if (otherValue !== undefined) {
    return otherValue;
  }

  return fallback !== undefined ? fallback : key;
}

/**
 * Switches the active language, persists the choice, and notifies the
 * app via a 'languagechange' CustomEvent on window.
 * @param {string} lang - 'bn' or 'en'
 */
export function setLanguage(lang) {
  if (!AVAILABLE_LANGUAGES.includes(lang)) {
    warn('Attempted to set unsupported language', { lang }, 'LOCALE');
    return;
  }

  currentLanguage = lang;

  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch (err) {
    warn('Failed to persist language choice', { lang }, 'LOCALE');
  }

  info('Language changed', { lang }, 'LOCALE');

  window.dispatchEvent(new CustomEvent('languagechange', { detail: { language: lang } }));
}

/**
 * Returns the currently active language code.
 * @returns {string}
 */
export function getLanguage() {
  return currentLanguage;
}

/**
 * Returns the list of supported language codes.
 * @returns {string[]}
 */
export function getAvailableLanguages() {
  return [...AVAILABLE_LANGUAGES];
}

/**
 * Indicates whether the locale system is ready to use.
 * Always true today; reserved for future async locale loading.
 * @returns {boolean}
 */
export function isReady() {
  return true;
}
