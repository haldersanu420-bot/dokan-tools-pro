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
import { clearDetectionCache } from '../workers/worker-bridge.js';

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
    detectionStatus: null,
    userDecision: null, // 'confirmed' | 'rejected' | null
    manualCorners: null, // user-edited corners
    correctedCard: null, // { canvas, width, height } after perspective correction
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

  // Release loaded image canvases
  if (entry.loaded) {
    releaseImageData(entry.loaded);
    debug('Released image memory', { id }, 'IMAGE_STORE');
  }

  // Clear detection-specific data (helps GC, drops references promptly)
  if (entry.detectedCards && entry.detectedCards.length > 0) {
    entry.detectedCards.length = 0;
  }
  entry.manualCorners = null;

  // Release the corrected-output canvas, if any
  if (entry.correctedCard?.canvas) {
    entry.correctedCard.canvas.width = 0;
    entry.correctedCard.canvas.height = 0;
  }
  entry.correctedCard = null;

  images.delete(id);
  clearDetectionCache();
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
    if (entry.detectedCards) {
      entry.detectedCards.length = 0;
    }
    entry.manualCorners = null;

    if (entry.correctedCard?.canvas) {
      entry.correctedCard.canvas.width = 0;
      entry.correctedCard.canvas.height = 0;
    }
    entry.correctedCard = null;
  });

  images.clear();
  clearDetectionCache();
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

/**
 * Records a card detection result against an entry and notifies
 * subscribers.
 * @param {string} id
 * @param {object|null} detectionResult - Result from detectCardInImage(), or null on failure
 * @returns {boolean} Whether an entry was found and updated
 */
export function updateDetection(id, detectionResult) {
  const entry = images.get(id);
  if (!entry) return false;

  entry.detectedCards = detectionResult ? [detectionResult] : [];
  entry.detectionStatus = detectionResult?.found ? 'detected' : 'no_card';

  notifySubscribers();
  return true;
}

/**
 * Computes aggregate detection counts across all entries.
 * @returns {{ total: number, detected: number, noCard: number, pending: number }}
 */
export function getDetectionStats() {
  const all = getAll();
  return {
    total: all.length,
    detected: all.filter((e) => e.detectionStatus === 'detected').length,
    noCard: all.filter((e) => e.detectionStatus === 'no_card').length,
    pending: all.filter((e) => !e.detectionStatus).length,
  };
}

/**
 * Records the user's confirm/reject decision for an entry.
 * @param {string} id
 * @param {'confirmed'|'rejected'|null} decision
 * @returns {boolean} Whether an entry was found and updated
 */
export function setUserDecision(id, decision) {
  const entry = images.get(id);
  if (!entry) return false;

  entry.userDecision = decision;
  notifySubscribers();
  info('User decision set', { id, decision }, 'IMAGE_STORE');
  return true;
}

/**
 * Records user-edited corners for an entry, treating it as confirmed.
 * Updates the active detection result (or creates a synthetic one) so
 * the manually-placed corners become the corners used downstream.
 * @param {string} id
 * @param {Array<{x: number, y: number}>} corners
 * @returns {boolean} Whether an entry was found and updated
 */
export function setManualCorners(id, corners) {
  const entry = images.get(id);
  if (!entry) return false;

  entry.manualCorners = corners;
  // If user manually set corners, treat as confirmed
  entry.userDecision = 'confirmed';

  // Also update the detection result so it's the "active" one
  if (entry.detectedCards.length > 0) {
    entry.detectedCards[0].corners = corners;
    entry.detectedCards[0].userAdjusted = true;
  } else {
    // Create a synthetic detection entry
    entry.detectedCards = [{
      found: true,
      corners,
      confidence: 1.0,
      userAdjusted: true,
      duration: 0,
    }];
    entry.detectionStatus = 'detected';
  }

  notifySubscribers();
  info('Manual corners set', { id }, 'IMAGE_STORE');
  return true;
}

/**
 * Returns entries the user has confirmed and that have a detection result.
 * @returns {object[]}
 */
export function getConfirmed() {
  return getAll().filter((e) =>
    e.userDecision === 'confirmed' &&
    e.detectedCards.length > 0
  );
}

/**
 * Records the perspective-corrected output canvas for an entry.
 * @param {string} id
 * @param {{ canvas: HTMLCanvasElement, width: number, height: number }} correctedData
 * @returns {boolean} Whether an entry was found and updated
 */
export function setCorrectedCard(id, correctedData) {
  const entry = images.get(id);
  if (!entry) return false;

  entry.correctedCard = correctedData;
  notifySubscribers();
  info('Corrected card set', { id }, 'IMAGE_STORE');
  return true;
}

/**
 * Returns confirmed entries that have a corrected (perspective-fixed) output.
 * @returns {object[]}
 */
export function getCorrectedCards() {
  return getAll().filter((e) =>
    e.userDecision === 'confirmed' &&
    e.correctedCard !== null
  );
}
