// src/ui/corner-adjuster.js
// Modal overlay for manual corner adjustment with loupe magnifier

import { t } from '../locales/index.js';
import * as logger from '../utils/logger.js';

/**
 * Open the corner adjuster modal.
 * @param {HTMLCanvasElement} sourceCanvas - The image to display
 * @param {Array<{x,y}>} initialCorners - 4 corners [TL, TR, BR, BL]
 * @returns {Promise<Array<{x,y}> | null>} - resolved with new corners, or null if cancelled
 */
export function openCornerAdjuster(sourceCanvas, initialCorners) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'corner-adjust-overlay';
    overlay.innerHTML = `
      <div class="corner-adjust-header">
        <h2>${t('process.adjustingCorners')}</h2>
        <button class="btn btn-icon" id="ca-close" aria-label="Close">✕</button>
      </div>
      <div class="corner-adjust-hint">${t('process.adjustHint')}</div>
      <div class="corner-adjust-canvas-wrap">
        <canvas class="corner-adjust-canvas" id="ca-canvas"></canvas>
        <div class="corner-adjust-loupe" id="ca-loupe"></div>
      </div>
      <div class="corner-adjust-footer">
        <button class="btn btn-secondary" id="ca-cancel">${t('actions.cancel')}</button>
        <button class="btn btn-secondary" id="ca-reset">${t('actions.reset')}</button>
        <button class="btn btn-primary" id="ca-save">${t('actions.save')}</button>
      </div>
    `;
    document.body.appendChild(overlay);

    const canvas = overlay.querySelector('#ca-canvas');
    const loupe = overlay.querySelector('#ca-loupe');
    const ctx = canvas.getContext('2d');

    // Determine display size based on viewport
    const wrap = overlay.querySelector('.corner-adjust-canvas-wrap');
    const wrapRect = wrap.getBoundingClientRect();
    const maxW = wrapRect.width - 20;
    const maxH = wrapRect.height - 20;

    const scale = Math.min(maxW / sourceCanvas.width, maxH / sourceCanvas.height);
    const displayW = Math.floor(sourceCanvas.width * scale);
    const displayH = Math.floor(sourceCanvas.height * scale);

    canvas.width = displayW;
    canvas.height = displayH;
    canvas.style.width = displayW + 'px';
    canvas.style.height = displayH + 'px';

    // Convert source corners (in source coordinates) to display coordinates
    let corners = initialCorners.map((c) => ({
      x: c.x * scale,
      y: c.y * scale,
    }));
    const originalCorners = corners.map((c) => ({ ...c }));

    const labels = ['TL', 'TR', 'BR', 'BL'];
    let dragIndex = -1;
    const HANDLE_RADIUS = 14;
    const TOUCH_HIT_RADIUS = 30;

    function redraw() {
      ctx.clearRect(0, 0, displayW, displayH);
      ctx.drawImage(sourceCanvas, 0, 0, displayW, displayH);

      // Draw polygon
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      ctx.lineTo(corners[1].x, corners[1].y);
      ctx.lineTo(corners[2].x, corners[2].y);
      ctx.lineTo(corners[3].x, corners[3].y);
      ctx.closePath();
      ctx.stroke();

      // Draw corner handles
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(corners[i].x, corners[i].y, HANDLE_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.fillText(labels[i], corners[i].x, corners[i].y);
      }
    }

    function findHitCorner(x, y, radius = TOUCH_HIT_RADIUS) {
      for (let i = 0; i < 4; i++) {
        const dx = x - corners[i].x;
        const dy = y - corners[i].y;
        if (dx * dx + dy * dy <= radius * radius) return i;
      }
      return -1;
    }

    function getEventPos(e) {
      const rect = canvas.getBoundingClientRect();
      const point = e.touches ? e.touches[0] : e;
      return {
        x: point.clientX - rect.left,
        y: point.clientY - rect.top,
      };
    }

    function updateLoupe(visible, canvasX, canvasY) {
      if (!visible) {
        loupe.classList.remove('is-visible');
        return;
      }
      loupe.classList.add('is-visible');

      // Position loupe near cursor but not under it
      const rect = canvas.getBoundingClientRect();
      const wrapRect2 = wrap.getBoundingClientRect();
      let lx = rect.left + canvasX - wrapRect2.left + 30;
      let ly = rect.top + canvasY - wrapRect2.top - 130;

      // Keep on screen
      if (lx + 120 > wrapRect2.width) lx = canvasX + rect.left - wrapRect2.left - 150;
      if (ly < 0) ly = canvasY + rect.top - wrapRect2.top + 30;

      loupe.style.left = lx + 'px';
      loupe.style.top = ly + 'px';

      // Render zoomed view: 3x zoom
      const srcSize = 40;
      const dstSize = 120;

      // Source coords in display canvas
      const srcX = canvasX - srcSize / 2;
      const srcY = canvasY - srcSize / 2;

      // Loupe uses a child canvas drawn from the main display canvas
      let loupeCanvas = loupe.querySelector('canvas');
      if (!loupeCanvas) {
        loupeCanvas = document.createElement('canvas');
        loupeCanvas.width = dstSize;
        loupeCanvas.height = dstSize;
        loupeCanvas.style.width = '100%';
        loupeCanvas.style.height = '100%';
        loupe.insertBefore(loupeCanvas, loupe.firstChild);
      }
      const lc = loupeCanvas.getContext('2d');
      lc.fillStyle = '#fff';
      lc.fillRect(0, 0, dstSize, dstSize);
      lc.imageSmoothingEnabled = false;
      lc.drawImage(canvas, srcX, srcY, srcSize, srcSize, 0, 0, dstSize, dstSize);
    }

    function onStart(e) {
      e.preventDefault();
      const pos = getEventPos(e);
      const idx = findHitCorner(pos.x, pos.y);
      if (idx >= 0) {
        dragIndex = idx;
        updateLoupe(true, pos.x, pos.y);
      }
    }

    function onMove(e) {
      const pos = getEventPos(e);
      if (dragIndex >= 0) {
        e.preventDefault();
        corners[dragIndex].x = Math.max(0, Math.min(displayW, pos.x));
        corners[dragIndex].y = Math.max(0, Math.min(displayH, pos.y));
        redraw();
        updateLoupe(true, corners[dragIndex].x, corners[dragIndex].y);
      } else {
        const hover = findHitCorner(pos.x, pos.y);
        canvas.style.cursor = hover >= 0 ? 'grab' : 'crosshair';
      }
    }

    function onEnd() {
      if (dragIndex >= 0) {
        dragIndex = -1;
        updateLoupe(false);
      }
    }

    // Mouse events
    canvas.addEventListener('mousedown', onStart);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseup', onEnd);
    canvas.addEventListener('mouseleave', onEnd);

    // Touch events
    canvas.addEventListener('touchstart', onStart, { passive: false });
    canvas.addEventListener('touchmove', onMove, { passive: false });
    canvas.addEventListener('touchend', onEnd);
    canvas.addEventListener('touchcancel', onEnd);

    // Buttons
    function close(result) {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }

    overlay.querySelector('#ca-close').addEventListener('click', () => close(null));
    overlay.querySelector('#ca-cancel').addEventListener('click', () => close(null));
    overlay.querySelector('#ca-reset').addEventListener('click', () => {
      corners = originalCorners.map((c) => ({ ...c }));
      redraw();
    });
    overlay.querySelector('#ca-save').addEventListener('click', () => {
      // Convert back to source coordinates
      const result = corners.map((c) => ({
        x: Math.round(c.x / scale),
        y: Math.round(c.y / scale),
      }));
      logger.info('Manual corners saved', { corners: result }, 'CORNER_ADJUST');
      close(result);
    });

    function onKey(e) {
      if (e.key === 'Escape') close(null);
    }
    document.addEventListener('keydown', onKey);

    redraw();
  });
}
