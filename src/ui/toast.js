/**
 * Toast notification UI for Dokan Tools Pro.
 *
 * A self-contained, accessible toast system (CSS injected on first use,
 * no external dependencies). Stacks up to 3 toasts at a time, auto-dismisses
 * after a type-based duration (pausable on hover), and supports a special
 * helper for showing AppError instances from error-handler.js.
 *
 * Usage:
 *   import { success, error, info, warning, showAppError } from './ui/toast.js';
 *
 *   success('PDF তৈরি হয়েছে');
 *   error('কার্ড পাওয়া যায়নি', { recovery: 'অন্য ছবি দিন' });
 *   info('Processing started', { title: 'Heads up', duration: 0 });
 *   showAppError(myAppError);
 */

import { debug } from '../utils/logger.js';
import { t } from '../locales/index.js';

/** @type {{ SUCCESS: string, INFO: string, WARNING: string, ERROR: string }} Toast type enum */
export const TOAST_TYPE = {
  SUCCESS: 'success',
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
};

const CONTAINER_ID = 'dokan-toast-container';
const STYLE_ID = 'dokan-toast-styles';
const MAX_VISIBLE_TOASTS = 3;

const DEFAULT_DURATIONS = {
  [TOAST_TYPE.SUCCESS]: 3000,
  [TOAST_TYPE.INFO]: 3000,
  [TOAST_TYPE.WARNING]: 6000,
  [TOAST_TYPE.ERROR]: 6000,
};

const TYPE_ICON = {
  [TOAST_TYPE.SUCCESS]: '✓',
  [TOAST_TYPE.INFO]: 'ℹ',
  [TOAST_TYPE.WARNING]: '⚠',
  [TOAST_TYPE.ERROR]: '✕',
};

const ARIA_LIVE_BY_TYPE = {
  [TOAST_TYPE.SUCCESS]: 'polite',
  [TOAST_TYPE.INFO]: 'polite',
  [TOAST_TYPE.WARNING]: 'assertive',
  [TOAST_TYPE.ERROR]: 'assertive',
};

/** @type {HTMLElement|null} Lazily-created toast container */
let containerEl = null;

/** @type {boolean} Whether toast styles have already been injected */
let stylesInjected = false;

/** @type {number} Monotonically increasing id source for toasts */
let nextToastId = 1;

/** @type {Map<string, { el: HTMLElement, timeoutId: number|null, remaining: number, startedAt: number, duration: number }>} */
const activeToasts = new Map();

/** Tracks insertion order to know which toast is oldest when evicting. */
const insertionOrder = [];

/**
 * Injects the toast stylesheet into <head> once.
 */
function injectStyles() {
  if (stylesInjected || document.getElementById(STYLE_ID)) {
    stylesInjected = true;
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
#${CONTAINER_ID} {
  position: fixed;
  top: var(--space-4, 16px);
  right: var(--space-4, 16px);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: var(--space-2, 8px);
  pointer-events: none;
  max-width: calc(100vw - 2 * var(--space-4, 16px));
}

.toast {
  pointer-events: auto;
  min-width: 280px;
  max-width: 400px;
  padding: var(--space-3, 12px) var(--space-4, 16px);
  border-radius: var(--radius-md, 8px);
  background: var(--color-surface-elevated, white);
  color: var(--color-text, #111827);
  box-shadow: var(--shadow-lg, 0 4px 12px rgba(0, 0, 0, 0.15));
  border-left: 4px solid var(--color-info, #3b82f6);
  font-family: var(--font-bengali, system-ui, -apple-system, 'Segoe UI', sans-serif);
  font-size: var(--text-sm, 14px);
  line-height: 1.4;
  display: flex;
  gap: 10px;
  align-items: flex-start;
  animation: slideIn 0.3s ease-out;
}

.toast-success { border-left-color: var(--color-success, #10b981); }
.toast-info { border-left-color: var(--color-info, #3b82f6); }
.toast-warning { border-left-color: var(--color-warning, #f59e0b); }
.toast-error { border-left-color: var(--color-error, #ef4444); }

.toast-icon {
  font-size: 18px;
  line-height: 1;
  flex-shrink: 0;
}

.toast-success .toast-icon { color: var(--color-success, #10b981); }
.toast-info .toast-icon { color: var(--color-info, #3b82f6); }
.toast-warning .toast-icon { color: var(--color-warning, #f59e0b); }
.toast-error .toast-icon { color: var(--color-error, #ef4444); }

.toast-body {
  flex: 1;
  min-width: 0;
}

.toast-title {
  font-weight: 600;
  margin-bottom: 2px;
}

.toast-recovery {
  font-size: var(--text-xs, 12px);
  color: var(--color-text-muted, #6b7280);
  margin-top: 4px;
}

.toast-close {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 18px;
  color: var(--color-text-muted, #9ca3af);
  padding: 0 4px;
  line-height: 1;
  margin-left: auto;
  align-self: flex-start;
}

.toast.toast-leaving {
  animation: slideOut 0.3s ease-in forwards;
}

@keyframes slideIn {
  from { transform: translateX(120%); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}

@keyframes slideOut {
  from { transform: translateX(0); opacity: 1; }
  to { transform: translateX(120%); opacity: 0; }
}

@media (max-width: 640px) {
  #${CONTAINER_ID} {
    left: var(--space-3, 12px);
    right: var(--space-3, 12px);
    top: var(--space-3, 12px);
    max-width: calc(100vw - 2 * var(--space-3, 12px));
  }

  .toast {
    min-width: 0;
    max-width: 100%;
  }

  @keyframes slideIn {
    from { transform: translateY(-120%); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }

  @keyframes slideOut {
    from { transform: translateY(0); opacity: 1; }
    to { transform: translateY(-120%); opacity: 0; }
  }
}
`;
  document.head.appendChild(style);
  stylesInjected = true;
}

/**
 * Lazily creates and returns the fixed-position toast container.
 * @returns {HTMLElement}
 */
function getContainer() {
  if (containerEl && document.body.contains(containerEl)) {
    return containerEl;
  }

  containerEl = document.createElement('div');
  containerEl.id = CONTAINER_ID;
  document.body.appendChild(containerEl);
  return containerEl;
}

/**
 * Removes a toast's DOM node and internal bookkeeping immediately.
 * @param {string} toastId
 */
function removeToast(toastId) {
  const record = activeToasts.get(toastId);
  if (!record) return;

  if (record.timeoutId) {
    clearTimeout(record.timeoutId);
  }

  record.el.remove();
  activeToasts.delete(toastId);

  const orderIndex = insertionOrder.indexOf(toastId);
  if (orderIndex !== -1) {
    insertionOrder.splice(orderIndex, 1);
  }
}

/**
 * Plays the slide-out animation, then removes the toast from the DOM.
 * @param {string} toastId
 */
function animateOutAndRemove(toastId) {
  const record = activeToasts.get(toastId);
  if (!record) return;

  record.el.classList.add('toast-leaving');
  record.el.addEventListener(
    'animationend',
    () => removeToast(toastId),
    { once: true }
  );
}

/**
 * Starts (or restarts) the auto-dismiss timer for a toast.
 * @param {string} toastId
 */
function startTimer(toastId) {
  const record = activeToasts.get(toastId);
  if (!record || record.duration <= 0) return;

  record.startedAt = Date.now();
  record.timeoutId = window.setTimeout(() => {
    animateOutAndRemove(toastId);
  }, record.remaining);
}

/**
 * Pauses the auto-dismiss timer (called on mouseenter).
 * @param {string} toastId
 */
function pauseTimer(toastId) {
  const record = activeToasts.get(toastId);
  if (!record || record.duration <= 0 || !record.timeoutId) return;

  clearTimeout(record.timeoutId);
  record.timeoutId = null;
  record.remaining -= Date.now() - record.startedAt;
}

/**
 * Resumes the auto-dismiss timer (called on mouseleave).
 * @param {string} toastId
 */
function resumeTimer(toastId) {
  const record = activeToasts.get(toastId);
  if (!record || record.duration <= 0 || record.remaining <= 0) return;

  startTimer(toastId);
}

/**
 * Evicts the oldest visible toast if the max-visible limit is exceeded.
 */
function evictOldestIfNeeded() {
  while (insertionOrder.length > MAX_VISIBLE_TOASTS) {
    const oldestId = insertionOrder[0];
    animateOutAndRemove(oldestId);
    // animateOutAndRemove removes asynchronously on animationend;
    // drop it from the order list now so the loop terminates correctly.
    insertionOrder.shift();
  }
}

/**
 * Builds the DOM node for a toast.
 * @param {string} toastId
 * @param {string} type
 * @param {string} message
 * @param {{ title?: string, recovery?: string, dismissible?: boolean }} options
 * @returns {HTMLElement}
 */
function buildToastElement(toastId, type, message, { title, recovery, dismissible }) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', 'alert');
  el.setAttribute('aria-live', ARIA_LIVE_BY_TYPE[type] || 'polite');
  el.setAttribute('data-toast-id', toastId);

  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.textContent = TYPE_ICON[type] || TYPE_ICON[TOAST_TYPE.INFO];
  icon.setAttribute('aria-hidden', 'true');

  const body = document.createElement('div');
  body.className = 'toast-body';

  if (title) {
    const titleEl = document.createElement('div');
    titleEl.className = 'toast-title';
    titleEl.textContent = title;
    body.appendChild(titleEl);
  }

  const messageEl = document.createElement('div');
  messageEl.className = 'toast-message';
  messageEl.textContent = message;
  body.appendChild(messageEl);

  if (recovery) {
    const recoveryEl = document.createElement('div');
    recoveryEl.className = 'toast-recovery';
    recoveryEl.textContent = recovery;
    body.appendChild(recoveryEl);
  }

  el.appendChild(icon);
  el.appendChild(body);

  if (dismissible) {
    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', t('common.close', 'Close'));
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => dismiss(toastId));
    el.appendChild(closeBtn);
  }

  el.addEventListener('mouseenter', () => pauseTimer(toastId));
  el.addEventListener('mouseleave', () => resumeTimer(toastId));

  return el;
}

/**
 * Shows a toast notification.
 * @param {string} message
 * @param {object} [options]
 * @param {string} [options.type] - One of TOAST_TYPE values, default 'info'
 * @param {string} [options.title] - Optional bold title above the message
 * @param {string} [options.recovery] - Optional smaller recovery text below the message
 * @param {number} [options.duration] - Auto-dismiss delay in ms (0 = no auto-dismiss)
 * @param {boolean} [options.dismissible] - Whether to show a close button, default true
 * @returns {string} The generated toast id
 */
export function show(message, options = {}) {
  const type = options.type || TOAST_TYPE.INFO;
  const dismissible = options.dismissible !== false;
  const duration = options.duration !== undefined
    ? options.duration
    : DEFAULT_DURATIONS[type] ?? DEFAULT_DURATIONS[TOAST_TYPE.INFO];

  injectStyles();
  const container = getContainer();

  const toastId = `toast-${nextToastId++}`;
  const el = buildToastElement(toastId, type, message, {
    title: options.title,
    recovery: options.recovery,
    dismissible,
  });

  container.appendChild(el);
  insertionOrder.push(toastId);
  activeToasts.set(toastId, {
    el,
    timeoutId: null,
    remaining: duration,
    startedAt: Date.now(),
    duration,
  });

  startTimer(toastId);
  evictOldestIfNeeded();

  debug('Toast shown', { type, message }, 'TOAST');

  return toastId;
}

/**
 * Shows a success toast.
 * @param {string} message
 * @param {object} [options]
 * @returns {string}
 */
export function success(message, options = {}) {
  return show(message, { ...options, type: TOAST_TYPE.SUCCESS });
}

/**
 * Shows an info toast.
 * @param {string} message
 * @param {object} [options]
 * @returns {string}
 */
export function info(message, options = {}) {
  return show(message, { ...options, type: TOAST_TYPE.INFO });
}

/**
 * Shows a warning toast.
 * @param {string} message
 * @param {object} [options]
 * @returns {string}
 */
export function warning(message, options = {}) {
  return show(message, { ...options, type: TOAST_TYPE.WARNING });
}

/**
 * Shows an error toast.
 * @param {string} message
 * @param {object} [options]
 * @returns {string}
 */
export function error(message, options = {}) {
  return show(message, { ...options, type: TOAST_TYPE.ERROR });
}

/**
 * Shows an error toast for an AppError instance (see error-handler.js),
 * using its userMessage/recovery and the localized error title.
 * @param {import('../utils/error-handler.js').AppError} appError
 * @returns {string}
 */
export function showAppError(appError) {
  return error(appError.userMessage, {
    title: t('error.title'),
    recovery: appError.recovery,
  });
}

/**
 * Manually dismisses a specific toast by id (plays slide-out animation).
 * @param {string} toastId
 */
export function dismiss(toastId) {
  animateOutAndRemove(toastId);
}

/**
 * Dismisses all currently visible toasts.
 */
export function dismissAll() {
  [...activeToasts.keys()].forEach((toastId) => animateOutAndRemove(toastId));
}
