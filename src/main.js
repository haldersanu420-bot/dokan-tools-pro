import { t, setLanguage, getLanguage } from './locales/index.js';
import * as logger from './utils/logger.js';
import { registerGlobalHandlers, createError } from './utils/error-handler.js';
import * as toast from './ui/toast.js';
import { createUploadZone } from './ui/upload.js';
import {
  addImages, subscribe, remove, clear, getAll, getStats, getReady,
  updateDetection, setUserDecision, setManualCorners, getConfirmed,
} from './core/image-store.js';
import { detectCardInImage, drawCornersOverlay } from './workers/worker-bridge.js';
import { openCornerAdjuster } from './ui/corner-adjuster.js';

registerGlobalHandlers();

/**
 * Escapes a string for safe insertion into innerHTML (prevents XSS from
 * untrusted values like user-provided filenames).
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str || '');
  return div.innerHTML;
}

/** @type {string} Current theme, restored from localStorage on load */
let currentTheme = localStorage.getItem('dokan-tools-theme') || 'light';
document.documentElement.setAttribute('data-theme', currentTheme);

/**
 * Wires up the theme and language toggle buttons. Must be called after
 * every innerHTML render since the buttons are recreated each time.
 */
function attachHeaderListeners() {
  const themeToggleBtn = document.getElementById('theme-toggle');
  if (themeToggleBtn) {
    themeToggleBtn.textContent = currentTheme === 'dark' ? '☀️' : '🌙';
    themeToggleBtn.addEventListener('click', () => {
      currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', currentTheme);
      themeToggleBtn.textContent = currentTheme === 'dark' ? '☀️' : '🌙';
      localStorage.setItem('dokan-tools-theme', currentTheme);
      logger.info('Theme changed', { theme: currentTheme }, 'THEME');
    });
  }

  const langToggleBtn = document.getElementById('lang-toggle');
  langToggleBtn?.addEventListener('click', () => {
    const next = getLanguage() === 'bn' ? 'en' : 'bn';
    setLanguage(next);
    location.reload(); // simple reload for now; later we'll re-render
  });
}

/**
 * Renders the home screen with module selection and the dev test panel.
 */
function renderHome() {
  document.querySelector('#app').innerHTML = `
    <div class="app-layout">
      <header class="app-header">
        <h1>${t('app.title')}</h1>
        <div class="flex gap-2 items-center">
          <button id="lang-toggle" class="btn btn-secondary text-sm" style="min-height: 36px; padding: 6px 12px;">
            ${getLanguage() === 'bn' ? 'EN' : 'বাং'}
          </button>
          <button id="theme-toggle" class="btn btn-icon btn-secondary" aria-label="Toggle dark mode">
            🌙
          </button>
        </div>
      </header>

      <main class="app-main">
        <div class="card">
          <h2>${t('module.selectModule')}</h2>
          <p class="text-muted mt-4">${t('app.subtitle')}</p>

          <div class="flex flex-col gap-4 mt-5">
            <button class="btn btn-primary" id="module-card-sheet">
              📇 ${t('module.cardSheet')}
            </button>
            <button class="btn btn-primary" id="module-passport">
              📸 ${t('module.passportPhoto')}
            </button>
          </div>
        </div>

        <div class="card mt-5">
          <h3>System Check</h3>
          <p class="text-muted text-sm mt-4">Click below to test app responsiveness</p>
          <div class="flex gap-2 mt-4" style="flex-wrap: wrap;">
            <button class="btn btn-secondary text-sm" id="toast-test-btn">
              টোস্ট টেস্ট
            </button>
          </div>
        </div>
      </main>

      <footer class="app-footer">
        ${t('app.title')} v0.1.0
      </footer>
    </div>
  `;

  attachHeaderListeners();

  document.getElementById('module-card-sheet')?.addEventListener('click', () => {
    renderCardSheetModule();
  });
  document.getElementById('module-passport')?.addEventListener('click', () => {
    toast.info('পাসপোর্ট ছবি মডিউল শীঘ্রই আসছে', { title: 'Coming Soon' });
  });

  document.getElementById('toast-test-btn')?.addEventListener('click', () => {
    toast.success('সফল! সব কিছু ঠিকঠাক চলছে');
    setTimeout(() => toast.info('তথ্য: এটি একটি info toast', { title: 'তথ্যমূলক বার্তা' }), 500);
    setTimeout(() => toast.warning('সাবধান, কিছু একটা ভুল হতে পারে', { title: 'সতর্কবার্তা' }), 1000);
    setTimeout(() => {
      const err = createError('NO_CARD_DETECTED', 'Test error from button');
      toast.showAppError(err);
    }, 1500);
  });
}

/**
 * Renders the ID Card Sheet module with the file upload zone.
 */
function renderCardSheetModule() {
  document.querySelector('#app').innerHTML = `
    <div class="app-layout">
      <header class="app-header">
        <button id="back-home" class="btn btn-secondary text-sm" style="min-height: 36px; padding: 6px 12px;">
          ← ${t('button.back')}
        </button>
        <h1>${t('module.cardSheet')}</h1>
        <div style="width: 60px;"></div>
      </header>
      <main class="app-main">
        <div class="card">
          <div id="upload-area"></div>
          <div id="detection-list" class="detection-list" hidden></div>
          <div id="bulk-actions" class="bulk-actions" hidden></div>
        </div>
      </main>
    </div>
  `;

  // Render detection list based on current store state
  function renderDetectionList(images) {
    const container = document.getElementById('detection-list');
    if (!container) return;

    if (images.length === 0) {
      container.hidden = true;
      container.innerHTML = '';
      return;
    }

    container.hidden = false;

    const items = images.map((entry) => {
      let statusClass = 'pending';
      let icon = '⏳';
      let statusText = t('process.detecting');
      let meta = '';

      if (entry.status === 'failed') {
        statusClass = 'failed';
        icon = '⚠️';
        statusText = entry.error?.userMessage || t('process.detectionFailed');
      } else if (entry.status === 'ready') {
        if (entry.detectionStatus === 'detected') {
          statusClass = 'detected';
          icon = '✅';
          statusText = t('process.detected');
          const det = entry.detectedCards[0];
          if (det) {
            meta = `${(det.confidence * 100).toFixed(0)}% • ${det.duration}ms`;
          }
        } else if (entry.detectionStatus === 'no_card') {
          statusClass = 'no_card';
          icon = '❌';
          statusText = t('process.notDetected');
        } else {
          // Still detecting
          statusClass = 'pending';
          icon = '⏳';
          statusText = t('process.detecting');
        }
      }

      const confirmActive = entry.userDecision === 'confirmed' ? 'is-active-confirm' : '';
      const rejectActive = entry.userDecision === 'rejected' ? 'is-active-reject' : '';
      const canEdit = entry.status === 'ready' && entry.detectionStatus === 'detected';

      return `
        <div class="detection-item detection-item-status-${statusClass} ${
          statusClass === 'pending' ? 'detection-item-pending' : ''
        }" data-entry-id="${entry.id}">
          <div class="detection-item-icon">${icon}</div>
          <div class="detection-item-thumb" data-thumb-for="${entry.id}">
            <span class="detection-item-thumb-placeholder">🖼️</span>
          </div>
          <div class="detection-item-info">
            <div class="detection-item-name">${escapeHtml(entry.file.name)}</div>
            <div class="detection-item-status">${statusText}</div>
          </div>
          ${meta ? `<div class="detection-item-meta">${meta}</div>` : ''}
          <div class="detection-item-actions">
            <button class="detection-action-btn ${confirmActive}"
                    data-action="confirm" data-id="${entry.id}"
                    title="${t('actions.confirm')}" ${!canEdit ? 'disabled' : ''}>
              ✓
            </button>
            <button class="detection-action-btn ${rejectActive}"
                    data-action="reject" data-id="${entry.id}"
                    title="${t('actions.reject')}">
              ✗
            </button>
            <button class="detection-action-btn"
                    data-action="edit" data-id="${entry.id}"
                    title="${t('actions.edit')}" ${!canEdit ? 'disabled' : ''}>
              ✎
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Summary at bottom
    const detected = images.filter((e) => e.detectionStatus === 'detected').length;
    const noCard = images.filter((e) => e.detectionStatus === 'no_card').length;
    const pending = images.filter((e) => e.status === 'ready' && !e.detectionStatus).length;

    let summary = '';
    if (images.length > 0) {
      summary = `
        <div class="detection-summary">
          <span>${images.length} টি ছবি</span>
          <span class="text-muted text-sm">
            ✅ ${detected} • ❌ ${noCard} ${pending > 0 ? `• ⏳ ${pending}` : ''}
          </span>
        </div>
      `;
    }

    container.innerHTML = items + summary;

    // Populate thumbnails (async, non-blocking)
    for (const entry of images) {
      if (entry.status !== 'ready' || entry.detectionStatus !== 'detected') continue;
      const det = entry.detectedCards[0];
      if (!det || !det.corners) continue;

      const thumbSlot = container.querySelector(`[data-thumb-for="${entry.id}"]`);
      if (!thumbSlot) continue;

      try {
        // Use the processing canvas (already exists, smaller size)
        const sourceCanvas = entry.loaded.processing.canvas;

        // Scale corners to a small preview canvas (160x120 for 2x retina)
        const previewWidth = 160;
        const previewHeight = 120;
        const scaleX = previewWidth / sourceCanvas.width;
        const scaleY = previewHeight / sourceCanvas.height;

        const scaledCorners = det.corners.map((c) => ({
          x: c.x * scaleX,
          y: c.y * scaleY,
        }));

        // Draw the source image scaled down
        const smallCanvas = document.createElement('canvas');
        smallCanvas.width = previewWidth;
        smallCanvas.height = previewHeight;
        const sctx = smallCanvas.getContext('2d');
        sctx.drawImage(sourceCanvas, 0, 0, previewWidth, previewHeight);

        // Draw overlay
        const overlay = drawCornersOverlay(smallCanvas, scaledCorners, {
          lineColor: '#22c55e',
          lineWidth: 2,
          cornerRadius: 4,
          cornerColor: '#ef4444',
        });

        // Clear placeholder and insert canvas
        thumbSlot.innerHTML = '';
        thumbSlot.appendChild(overlay);
      } catch (err) {
        logger.warn('Failed to render thumbnail', {
          id: entry.id,
          error: err.message,
        }, 'UI');
        // Keep the placeholder
      }
    }

    // Action button handlers (event delegation)
    container.querySelectorAll('.detection-action-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        const entry = images.find((img) => img.id === id);
        if (!entry) return;

        if (action === 'confirm') {
          setUserDecision(id, 'confirmed');
          toast.success(t('process.confirmed'), { duration: 1500 });
        } else if (action === 'reject') {
          setUserDecision(id, 'rejected');
          toast.info(t('process.rejected'), { duration: 1500 });
        } else if (action === 'edit') {
          if (!entry.detectedCards[0]?.corners) {
            toast.warning('Detected corners নেই');
            return;
          }

          const sourceCanvas = entry.loaded.processing.canvas;
          const currentCorners = entry.detectedCards[0].corners;

          try {
            const newCorners = await openCornerAdjuster(sourceCanvas, currentCorners);
            if (newCorners) {
              setManualCorners(id, newCorners);
              toast.success('কোনা সংরক্ষিত হয়েছে');
            }
          } catch (err) {
            toast.error('সমস্যা: ' + err.message);
            logger.error('Corner adjust failed', err, 'UI');
          }
        }
      });
    });

    renderBulkActions(images);
  }

  function renderBulkActions(images) {
    const container = document.getElementById('bulk-actions');
    if (!container) return;

    const detected = images.filter((e) =>
      e.status === 'ready' && e.detectionStatus === 'detected'
    );

    if (detected.length === 0) {
      container.hidden = true;
      container.innerHTML = '';
      return;
    }

    const confirmed = detected.filter((e) => e.userDecision === 'confirmed');
    const rejected = detected.filter((e) => e.userDecision === 'rejected');
    const pending = detected.filter((e) => !e.userDecision);

    container.hidden = false;
    container.innerHTML = `
      <div class="bulk-actions-info">
        <strong>${confirmed.length}</strong> ${t('process.selectedSummary')}
        <br>
        <span class="text-xs">
          ✓ ${confirmed.length} • ✗ ${rejected.length} • ⏳ ${pending.length}
        </span>
      </div>
      <button class="bulk-action-btn" data-bulk="confirm-all"
              ${pending.length === 0 ? 'disabled' : ''}>
        ✓ ${t('actions.confirmAll')}
      </button>
      <button class="bulk-action-btn" data-bulk="reject-all"
              ${pending.length === 0 ? 'disabled' : ''}>
        ✗ ${t('actions.rejectAll')}
      </button>
      <button class="bulk-action-btn bulk-action-btn-process"
              data-bulk="process"
              ${confirmed.length === 0 ? 'disabled' : ''}>
        ➡ ${t('actions.processSelected')} (${confirmed.length})
      </button>
    `;

    container.querySelectorAll('.bulk-action-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.bulk;

        if (action === 'confirm-all') {
          let count = 0;
          for (const entry of pending) {
            setUserDecision(entry.id, 'confirmed');
            count++;
          }
          if (count > 0) toast.success(`${count} টি নিশ্চিত করা হয়েছে`);
        } else if (action === 'reject-all') {
          let count = 0;
          for (const entry of pending) {
            setUserDecision(entry.id, 'rejected');
            count++;
          }
          if (count > 0) toast.info(`${count} টি বাদ দেওয়া হয়েছে`);
        } else if (action === 'process') {
          const ready = getConfirmed();
          if (ready.length === 0) {
            toast.warning('কোনো নিশ্চিত ছবি নেই');
            return;
          }

          const loadingId = toast.info(t('correction.processing'), { duration: 0 });

          try {
            const { runCorrectionPipeline, renderCorrectionView } =
              await import('./modules/card-sheet/correction-view.js');

            const result = await runCorrectionPipeline(({ current, total, filename }) => {
              toast.dismiss(loadingId);
              toast.info(
                `${t('correction.processingItem')} ${current}/${total}: ${filename}`,
                { duration: 0 }
              );
            });

            toast.dismissAll();

            if (result.processed > 0) {
              toast.success(
                `${result.processed} ${t('correction.complete')}`,
                result.failed > 0 ? { recovery: `${result.failed} ব্যর্থ` } : undefined
              );

              // Render the correction view
              renderCorrectionView(document.querySelector('#app'), {
                onBack: () => renderCardSheetModule(),
                onProceedToPDF: () => {
                  toast.info('Phase H coming next', {
                    title: 'PDF Export',
                    recovery: 'সব কার্ড A4-এ সাজানো হবে',
                  });
                },
              });
            } else {
              toast.error('কোনো কার্ড process হয়নি');
            }
          } catch (err) {
            toast.dismissAll();
            toast.error(err.message || 'Processing failed');
            logger.error('Correction pipeline failed', err, 'CORRECTION');
          }
        }
      });
    });
  }

  const unsubscribeStore = subscribe(({ images, stats }) => {
    logger.debug('Store updated', stats, 'IMAGE_STORE');
    renderDetectionList(images);
  });

  // Initial render (empty)
  renderDetectionList([]);

  const zone = createUploadZone({
    container: document.getElementById('upload-area'),
    onFilesAdded: (files) => {
      toast.info(`${files.length} টি ছবি যোগ হচ্ছে...`);
      const ids = addImages(files);
      logger.info('Files added to store', { ids, count: ids.length }, 'UPLOAD');

      // Wait for all to be ready (loaded), then auto-detect
      const checkInterval = setInterval(async () => {
        const stats = getStats();

        // All loading done?
        if (stats.pending === 0 && stats.loading === 0) {
          clearInterval(checkInterval);

          if (stats.failed > 0) {
            toast.warning(`${stats.ready} টি প্রস্তুত, ${stats.failed} টি ব্যর্থ`);
          }

          if (stats.ready === 0) return;

          // Start detection on all ready images
          const ready = getReady();
          toast.info(`${ready.length} টি ছবিতে কার্ড খুঁজছি...`, { duration: 0 });

          let detected = 0;
          let noCard = 0;

          for (const entry of ready) {
            try {
              // Skip if already detected
              if (entry.detectionStatus) continue;

              const result = await detectCardInImage(entry.loaded.processing.canvas);
              updateDetection(entry.id, result);

              if (result.found) {
                detected++;
                logger.success('Card detected', {
                  file: entry.file.name,
                  confidence: result.confidence,
                  duration: result.duration,
                }, 'AUTO_DETECT');
              } else {
                noCard++;
                logger.warn('No card in image', {
                  file: entry.file.name,
                  coverage: result.maskCoverage,
                }, 'AUTO_DETECT');
              }
            } catch (err) {
              logger.error('Detection failed for image', {
                file: entry.file.name,
                error: err.message,
              }, 'AUTO_DETECT');
              updateDetection(entry.id, null);
            }
          }

          toast.dismissAll();

          if (detected === ready.length) {
            toast.success(`${detected} টি কার্ড পাওয়া গেছে`, {
              title: 'সব ছবিতে কার্ড সফলভাবে detect হয়েছে',
            });
          } else if (detected > 0) {
            toast.warning(`${detected}/${ready.length} টি কার্ড পাওয়া গেছে`, {
              title: 'কিছু ছবিতে কার্ড detect হয়নি',
              recovery: `${noCard} টি ছবি manually check করুন`,
            });
          } else {
            toast.error('কোনো ছবিতে কার্ড পাওয়া যায়নি', {
              title: 'Detection ব্যর্থ',
              recovery: 'কার্ডের পরিষ্কার ছবি দিন',
            });
          }
        }
      }, 500);
    },
    onFileRemoved: (file, remaining) => {
      const entry = getAll().find((e) => e.file === file);
      if (entry) {
        remove(entry.id);
        logger.info('Image removed from store', { id: entry.id }, 'IMAGE_STORE');
      }
    },
    onClear: () => {
      const count = clear();
      logger.info('All images cleared', { count }, 'IMAGE_STORE');
    },
  });

  document.getElementById('back-home')?.addEventListener('click', () => {
    zone.destroy();
    unsubscribeStore();
    clear();
    renderHome();
  });
}

renderHome();

logger.success('App initialized', {
  language: getLanguage(),
  theme: currentTheme,
}, 'APP_INIT');
