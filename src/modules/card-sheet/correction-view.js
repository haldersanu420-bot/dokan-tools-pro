// src/modules/card-sheet/correction-view.js
// Renders the perspective-corrected cards grid

import { t } from '../../locales/index.js';
import * as logger from '../../utils/logger.js';
import { correctCardFinal } from '../../workers/worker-bridge.js';
import {
  getConfirmed,
  setCorrectedCard,
  getCorrectedCards,
} from '../../core/image-store.js';
import { CARD_WIDTH_MM, CARD_HEIGHT_MM, OUTPUT_DPI } from '../../utils/constants.js';

const CARD_WIDTH_PX = Math.round(CARD_WIDTH_MM / 25.4 * OUTPUT_DPI);
const CARD_HEIGHT_PX = Math.round(CARD_HEIGHT_MM / 25.4 * OUTPUT_DPI);

/**
 * Run perspective correction on all confirmed cards.
 * Updates progress UI as it goes.
 * @param {(progress: { current: number, total: number, filename: string }) => void} [onProgress]
 * @returns {Promise<{ processed: number, failed: number }>}
 */
export async function runCorrectionPipeline(onProgress) {
  const confirmed = getConfirmed();
  if (confirmed.length === 0) {
    return { processed: 0, failed: 0 };
  }

  let processed = 0;
  let failed = 0;

  for (let i = 0; i < confirmed.length; i++) {
    const entry = confirmed[i];

    onProgress?.({
      current: i + 1,
      total: confirmed.length,
      filename: entry.file.name,
    });

    try {
      const corners = entry.detectedCards[0].corners;

      // Use ORIGINAL canvas for max quality, but scale corners from processing → original
      const originalCanvas = entry.loaded.original.canvas;
      const processingCanvas = entry.loaded.processing.canvas;

      const scaleX = originalCanvas.width / processingCanvas.width;
      const scaleY = originalCanvas.height / processingCanvas.height;

      const scaledCorners = corners.map((c) => ({
        x: c.x * scaleX,
        y: c.y * scaleY,
      }));

      const result = await correctCardFinal(originalCanvas, scaledCorners, {
        outputWidth: CARD_WIDTH_PX,
        outputHeight: CARD_HEIGHT_PX,
        enhance: true,
      });

      // Convert ImageBitmap to canvas for storage
      const correctedCanvas = document.createElement('canvas');
      correctedCanvas.width = result.width;
      correctedCanvas.height = result.height;
      const ctx = correctedCanvas.getContext('2d');
      ctx.drawImage(result.correctedBitmap, 0, 0);
      result.correctedBitmap.close();

      setCorrectedCard(entry.id, {
        canvas: correctedCanvas,
        width: result.width,
        height: result.height,
      });

      processed++;
      logger.success('Card corrected', {
        filename: entry.file.name,
        size: `${result.width}x${result.height}`,
      }, 'CORRECTION');
    } catch (err) {
      failed++;
      logger.error('Correction failed', {
        filename: entry.file.name,
        error: err.message,
      }, 'CORRECTION');
    }
  }

  return { processed, failed };
}

/**
 * Render the correction results view.
 * @param {HTMLElement} containerEl
 * @param {{ onBack: () => void, onProceedToPDF: () => void }} callbacks
 */
export function renderCorrectionView(containerEl, { onBack, onProceedToPDF }) {
  const corrected = getCorrectedCards();

  containerEl.innerHTML = `
    <div class="app-layout">
      <header class="app-header">
        <button id="correction-back" class="btn btn-secondary text-sm"
                style="min-height: 36px; padding: 6px 12px;">
          ← ${t('correction.backToEdit')}
        </button>
        <h1>${t('correction.correctedCards')}</h1>
        <div style="width: 60px;"></div>
      </header>
      <main class="app-main">
        <div class="card">
          <div class="flex items-center justify-between mt-4" style="margin-bottom: 16px;">
            <div>
              <strong>${corrected.length}</strong> ${t('correction.correctedCards')}
              <div class="text-xs text-muted mt-4">
                ${t('correction.cardSize')}: ${CARD_WIDTH_MM}mm × ${CARD_HEIGHT_MM}mm
                (${CARD_WIDTH_PX}×${CARD_HEIGHT_PX}px)
              </div>
            </div>
            <button class="btn btn-primary" id="proceed-pdf">
              ${t('correction.download')} →
            </button>
          </div>
          <div id="corrected-grid" class="corrected-grid"></div>
        </div>
      </main>
    </div>
  `;

  // Render grid
  const grid = document.getElementById('corrected-grid');
  for (const entry of corrected) {
    const item = document.createElement('div');
    item.className = 'corrected-item';

    const previewCanvas = document.createElement('canvas');
    const displayScale = Math.min(400 / entry.correctedCard.width, 1);
    previewCanvas.width = entry.correctedCard.width * displayScale;
    previewCanvas.height = entry.correctedCard.height * displayScale;
    previewCanvas.style.width = '100%';
    previewCanvas.style.height = 'auto';

    const ctx = previewCanvas.getContext('2d');
    ctx.drawImage(
      entry.correctedCard.canvas,
      0, 0,
      previewCanvas.width, previewCanvas.height
    );

    item.appendChild(previewCanvas);

    const caption = document.createElement('div');
    caption.className = 'corrected-item-caption';
    caption.textContent = entry.file.name;
    item.appendChild(caption);

    grid.appendChild(item);
  }

  // Wire up buttons
  document.getElementById('correction-back')?.addEventListener('click', onBack);
  document.getElementById('proceed-pdf')?.addEventListener('click', onProceedToPDF);
}
