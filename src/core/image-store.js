/**
 * Central state store for uploaded images (singleton).
 *
 * Tracks every uploaded file by a unique id, loads it via image-loader.js
 * in the background, and notifies subscribers whenever the collection
 * changes (add/remove/clear/status transitions). Owns memory cleanup —
 * removing or clearing entries always releases their canvas data.
 *
 * Usage:
 *   import { addImage, subscribe, getAll, remove } from './core/image-store.js';
 *
 *   const unsub = subscribe(({ images, stats }) => {
 *     console.log(`${stats.ready}/${stats.total} ready`);
 *   });
 *
 *   const id = addImage(myFile); // returns immediately, loads in background
 */

import { info, debug } from '../utils/logger.js';
import { handleError } from '../utils/error-handler.js';
import { loadImage, releaseImageData } from './image-loader.js';

/** @type {Map<string, object>} All tracked image entries, keyed by id */
const images = new Map();

/** @type {Set<Function>} Subscriber callbacks notified on every change */
const subscribers = new Set();

/** @type {number} Monotonic counter used to keep generated ids unique */
let idCounter = 0;

/**
 * Generates a unique id for a new image entry.
 * @returns {string}
 */
function generateId() {
  return `img_${Date.now()}_${++idCounter}`;
}

/**
 * Calls every subscriber with a snapshot of the current state. Each
 * callback is isolated in its own try/catch so one bad subscriber
 * can't break the others.
 */
function notifySubscribers() {
  const snapshot = { images: getAll(), stats: getStats() };
  subscribers.forEach((callback) => {
    try {
      callback(snapshot);
    } catch (err) {
      handleError(err);
    }
  });
}

/**
 * Loads a tracked entry's file via image-loader.js and updates its
 * status/loaded/error fields as the load progresses. Internal — not
 * exported.
 * @param {string} id
 */
async function loadInBackground(id) {
  const entry = images.get(id);
  if (!entry) return;

  entry.status = 'loading';
  notifySubscribers();

  try {
    const loaded = await loadImage(entry.file);
    const current = images.get(id);
    if (!current) return; // entry was removed while loading

    current.loaded = loaded;
    current.status = 'ready';
    notifySubscribers();
  } catch (err) {
    const current = images.get(id);
    if (!current) return; // entry was removed while loading

    current.error = handleError(err);
    current.status = 'failed';
    notifySubscribers();
  }
}

/**
 * Adds a file to the store and starts loading it in the background.
 * Returns immediately with the new entry's id.
 * @param {File} file
 * @returns {string} The generated image id
 */
export function addImage(file) {
  const id = generateId();
  const entry = {
    id,
    file,
    loaded: null,
    status: 'pending',
    error: null,
    detectedCards: [],
    timestamp: Date.now(),
  };

  images.set(id, entry);
  notifySubscribers();

  loadInBackground(id);

  return id;
}

/**
 * Adds multiple files to the store.
 * @param {File[]} files
 * @returns {string[]} The generated ids, in the same order as `files`
 */
export function addImages(files) {
  return files.map((file) => addImage(file));
}

/**
 * Returns a single entry by id.
 * @param {string} id
 * @returns {object|null}
 */
export function get(id) {
  return images.get(id) || null;
}

/**
 * Returns all entries sorted by insertion time (oldest first).
 * @returns {object[]}
 */
export function getAll() {
  return [...images.values()].sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Returns only entries with status === 'ready'.
 * @returns {object[]}
 */
export function getReady() {
  return getAll().filter((entry) => entry.status === 'ready');
}

/**
 * Removes an entry by id, releasing its canvas memory if loaded.
 * @param {string} id
 * @returns {boolean} Whether an entry was found and removed
 */
export function remove(id) {
  const entry = images.get(id);
  if (!entry) return false;

  if (entry.loaded) {
    releaseImageData(entry.loaded);
    debug('Released image memory', { id }, 'IMAGE_STORE');
  }

  images.delete(id);
  notifySubscribers();
  info('Image removed from store', { id }, 'IMAGE_STORE');

  return true;
}

/**
 * Removes all entries, releasing canvas memory for each.
 * @returns {number} The number of entries removed
 */
export function clear() {
  const count = images.size;

  images.forEach((entry, id) => {
    if (entry.loaded) {
      releaseImageData(entry.loaded);
      debug('Released image memory', { id }, 'IMAGE_STORE');
    }
  });

  images.clear();
  notifySubscribers();
  info('Image store cleared', { count }, 'IMAGE_STORE');

  return count;
}

/**
 * Subscribes to store changes. The callback is invoked immediately on
 * every add/remove/clear/status transition with { images, stats }.
 * @param {(snapshot: { images: object[], stats: object }) => void} callback
 * @returns {Function} Unsubscribe function
 */
export function subscribe(callback) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

/**
 * Computes aggregate counts across all entries.
 * @returns {{ total: number, ready: number, pending: number, loading: number, failed: number }}
 */
export function getStats() {
  const stats = { total: 0, ready: 0, pending: 0, loading: 0, failed: 0 };

  images.forEach((entry) => {
    stats.total += 1;
    stats[entry.status] += 1;
  });

  return stats;
}
