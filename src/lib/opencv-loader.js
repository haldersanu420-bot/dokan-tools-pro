/**
 * Lazy loader for OpenCV.js (~10MB), loaded from CDN on first use.
 *
 * Multiple simultaneous callers share the same loading promise. State
 * transitions (idle/loading/ready/failed) are broadcast to subscribers
 * so UI code can react (toasts, progress, etc).
 *
 * Usage:
 *   import { loadOpenCV, isReady } from './lib/opencv-loader.js';
 *
 *   // Lazy load when needed:
 *   const cv = await loadOpenCV({
 *     onProgress: (state) => console.log('Loading state:', state),
 *   });
 *
 *   // Use OpenCV:
 *   const mat = cv.imread(myCanvas);
 *   // ... do stuff
 *   mat.delete();
 */

import { info, warn } from '../utils/logger.js';
import { createError } from '../utils/error-handler.js';

const OPENCV_CDN_URL = 'https://docs.opencv.org/4.8.0/opencv.js';
const LOAD_TIMEOUT_MS = 60000; // 60 seconds max
const SCRIPT_ID = 'opencv-script-tag';

/** @type {object|null} The cv namespace once loaded */
let cvInstance = null;

/** @type {Promise<object>|null} In-flight load promise, shared across callers */
let loadingPromise = null;

/** @type {'idle'|'loading'|'ready'|'failed'} Current loader state */
let loadState = 'idle';

/** @type {import('../utils/error-handler.js').AppError|null} */
let lastError = null;

/** @type {Set<Function>} Subscribers notified on every state change */
const stateListeners = new Set();

/**
 * Updates internal state and notifies subscribers. Internal — not exported.
 * @param {'idle'|'loading'|'ready'|'failed'} newState
 * @param {*} [error]
 */
function setState(newState, error = null) {
  loadState = newState;
  lastError = error;
  info('OpenCV state change', { state: newState }, 'OPENCV');

  stateListeners.forEach((cb) => {
    try {
      cb({ state: newState, error });
    } catch (e) {
      warn('OpenCV listener error', { message: e.message }, 'OPENCV');
    }
  });
}

/**
 * Performs the actual script injection and waits for OpenCV's WASM
 * runtime to finish initializing. Internal — not exported.
 * @param {{ onProgress?: (state: string) => void }} options
 * @returns {Promise<object>}
 */
function doLoad(options) {
  return new Promise((resolve, reject) => {
    let timeoutId;

    // requestIdleCallback (or a setTimeout fallback) breaks the resolution
    // out of OpenCV's synchronous WASM-init call chain, which otherwise
    // tends to trigger the browser's "Page Unresponsive" warning.
    const schedule = window.requestIdleCallback || ((fn) => setTimeout(fn, 0));

    const finish = (cv) => {
      clearTimeout(timeoutId);
      schedule(() => {
        cvInstance = cv;
        setState('ready');
        options.onProgress?.('ready');
        resolve(cv);
      });
    };

    const fail = (err) => {
      clearTimeout(timeoutId);
      setState('failed', err);
      options.onProgress?.('failed');
      reject(err);
    };

    if (window.cv && window.cv.Mat) {
      finish(window.cv);
      return;
    }

    const handleReady = async () => {
      try {
        let cv = window.cv;
        if (cv && typeof cv.then === 'function') {
          // Newer OpenCV.js builds expose a promise-like before the real namespace
          cv = await cv;
          window.cv = cv;
        }

        if (!cv) {
          throw new Error('window.cv missing after script load');
        }

        if (cv.onRuntimeInitialized !== undefined) {
          cv.onRuntimeInitialized = () => finish(cv);
        } else {
          finish(cv);
        }
      } catch (err) {
        fail(createError('OPENCV_LOAD_FAILED', err.message));
      }
    };

    timeoutId = setTimeout(() => {
      fail(createError('OPENCV_LOAD_FAILED', 'Load timeout'));
    }, LOAD_TIMEOUT_MS);

    const existingScript = document.getElementById(SCRIPT_ID);
    if (existingScript) {
      handleReady();
      return;
    }

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = OPENCV_CDN_URL;
    script.async = true;

    script.onload = () => {
      options.onProgress?.('loading');
      handleReady();
    };

    script.onerror = () => {
      fail(createError('OPENCV_LOAD_FAILED', 'Script load failed'));
    };

    document.head.appendChild(script);
  });
}

/**
 * Loads OpenCV.js, deduplicating concurrent calls so only one script tag
 * is ever injected. Resolves immediately if already loaded.
 * @param {{ onProgress?: (state: string) => void }} [options]
 * @returns {Promise<object>} The cv namespace
 */
export function loadOpenCV(options = {}) {
  if (loadState === 'ready' && cvInstance) {
    return Promise.resolve(cvInstance);
  }

  if (loadState === 'loading' && loadingPromise) {
    return loadingPromise;
  }

  options.onProgress?.('beforeLoad');
  setState('loading');
  options.onProgress?.('loading');
  loadingPromise = doLoad(options);
  return loadingPromise;
}

/**
 * @returns {boolean} Whether OpenCV is loaded and ready to use
 */
export function isReady() {
  return loadState === 'ready' && cvInstance !== null;
}

/**
 * @returns {object|null} The cv namespace, or null if not ready
 */
export function getCV() {
  return cvInstance;
}

/**
 * @returns {{ state: string, error: * }} Current loader state snapshot
 */
export function getState() {
  return { state: loadState, error: lastError };
}

/**
 * Subscribes to loader state changes.
 * @param {(snapshot: { state: string, error: * }) => void} callback
 * @returns {Function} Unsubscribe function
 */
export function onStateChange(callback) {
  stateListeners.add(callback);
  return () => stateListeners.delete(callback);
}

/**
 * Resets the loader after a failure so loadOpenCV() can be retried from
 * scratch (removes the stale script tag).
 */
export function resetLoader() {
  const existingScript = document.getElementById(SCRIPT_ID);
  existingScript?.remove();

  cvInstance = null;
  loadingPromise = null;
  setState('idle');
  info('OpenCV loader reset', null, 'OPENCV');
}
