/**
 * Dual-purpose logging system for Dokan Tools Pro.
 *
 * - Developer debugging: colorful, leveled console output (skips DEBUG in production).
 * - User-visible activity log: in-memory ring buffer of the last 50 entries,
 *   retrievable via getHistory() for an in-app activity/log panel.
 *
 * Usage:
 *   import { debug, info, success, warn, error, getHistory, clearHistory, getStats } from './logger.js';
 *
 *   debug('Decoded image buffer', { bytes: 204800 }, 'IMAGE_LOAD');
 *   info('Starting card detection', null, 'CARD_DETECT');
 *   success('Card detected', { count: 2 }, 'CARD_DETECT');
 *   warn('Low resolution image', { width: 400 }, 'IMAGE_LOAD');
 *   error('Failed to load model', { reason: err.message }, 'MODEL_LOAD');
 *
 *   const history = getHistory(); // last 50 log entries
 *   const stats = getStats();     // { total, errors, warnings }
 */

/** @type {Record<string, number>} Log level severities */
const LEVELS = {
  DEBUG: 0,
  INFO: 1,
  SUCCESS: 2,
  WARN: 3,
  ERROR: 4,
};

/** Console styling per level: [console method, CSS color] */
const CONSOLE_STYLE = {
  DEBUG: { method: 'debug', color: '#9e9e9e' },
  INFO: { method: 'info', color: '#2196f3' },
  SUCCESS: { method: 'log', color: '#4caf50' },
  WARN: { method: 'warn', color: '#ff9800' },
  ERROR: { method: 'error', color: '#f44336' },
};

/** @type {number} Maximum number of log entries kept in memory */
const HISTORY_LIMIT = 50;

/** @type {boolean} Whether the app is running in production mode */
const isProduction = import.meta.env.MODE === 'production';

/** @type {Array<object>} In-memory ring buffer of log entries */
let history = [];

/** @type {{ total: number, errors: number, warnings: number }} Running counters */
let stats = { total: 0, errors: 0, warnings: 0 };

/**
 * Formats a Date as HH:MM:SS for console output.
 * @param {Date} date
 * @returns {string}
 */
function formatTime(date) {
  return date.toTimeString().slice(0, 8);
}

/**
 * Core logging function used by all level helpers.
 * @param {string} level - One of LEVELS keys
 * @param {string} message
 * @param {object|null} [data]
 * @param {string|null} [stage]
 */
function log(level, message, data = null, stage = null) {
  const now = new Date();
  const entry = {
    timestamp: now.toISOString(),
    level,
    message,
    data,
    stage,
  };

  history.push(entry);
  if (history.length > HISTORY_LIMIT) {
    history.shift();
  }

  stats.total += 1;
  if (level === 'ERROR') stats.errors += 1;
  if (level === 'WARN') stats.warnings += 1;

  if (isProduction && level === 'DEBUG') {
    return;
  }

  const { method, color } = CONSOLE_STYLE[level];
  const stagePart = stage ? `[${stage}] ` : '';
  const prefix = `[${formatTime(now)}] [${level}] ${stagePart}${message}`;

  if (data != null) {
    console[method](`%c${prefix}`, `color: ${color}`, data);
  } else {
    console[method](`%c${prefix}`, `color: ${color}`);
  }
}

/**
 * Logs a DEBUG-level message (detailed dev info, skipped in production console).
 * @param {string} message
 * @param {object} [data]
 * @param {string} [stage]
 */
export function debug(message, data, stage) {
  log('DEBUG', message, data, stage);
}

/**
 * Logs an INFO-level message (general info).
 * @param {string} message
 * @param {object} [data]
 * @param {string} [stage]
 */
export function info(message, data, stage) {
  log('INFO', message, data, stage);
}

/**
 * Logs a SUCCESS-level message (successful operation).
 * @param {string} message
 * @param {object} [data]
 * @param {string} [stage]
 */
export function success(message, data, stage) {
  log('SUCCESS', message, data, stage);
}

/**
 * Logs a WARN-level message (warning).
 * @param {string} message
 * @param {object} [data]
 * @param {string} [stage]
 */
export function warn(message, data, stage) {
  log('WARN', message, data, stage);
}

/**
 * Logs an ERROR-level message (error).
 * @param {string} message
 * @param {object} [data]
 * @param {string} [stage]
 */
export function error(message, data, stage) {
  log('ERROR', message, data, stage);
}

/**
 * Returns a copy of the last 50 log entries (oldest first).
 * @returns {Array<object>}
 */
export function getHistory() {
  return [...history];
}

/**
 * Clears the in-memory log history and resets stats.
 */
export function clearHistory() {
  history = [];
  stats = { total: 0, errors: 0, warnings: 0 };
}

/**
 * Returns running counters for total/error/warning log entries.
 * @returns {{ total: number, errors: number, warnings: number }}
 */
export function getStats() {
  return { ...stats };
}

export { LEVELS };
