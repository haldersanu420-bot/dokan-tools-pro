/**
 * Image loading core for Dokan Tools Pro.
 *
 * Converts a File into two canvas representations:
 * - "processing": downsized (max PROCESSING_MAX_DIMENSION) for AI work
 * - "original": full size, EXIF-rotation-corrected, for final output
 *
 * Handles HEIC/HEIF input (lazy-loads heic2any only when needed) and
 * reads EXIF orientation directly from the original file bytes.
 *
 * Usage:
 *   import { loadImage } from './core/image-loader.js';
 *
 *   const result = await loadImage(file, {
 *     onProgress: (stage, pct) => console.log(stage, pct),
 *   });
 *   // result.processing.canvas → use for AI
 *   // result.original.canvas → use for final output
 */

import { debug, info, success, error as logError } from '../utils/logger.js';
import { createError, AppError } from '../utils/error-handler.js';
import {
  PROCESSING_MAX_DIMENSION,
  MIN_IMAGE_WIDTH,
  MIN_IMAGE_HEIGHT,
  MAX_IMAGE_DIMENSION,
} from '../utils/constants.js';

/**
 * Checks whether a file is a HEIC/HEIF image (by MIME type or extension).
 * @param {File} file
 * @returns {boolean}
 */
function isHeic(file) {
  const type = (file.type || '').toLowerCase();
  if (type === 'image/heic' || type === 'image/heif') {
    return true;
  }
  const name = (file.name || '').toLowerCase();
  return name.endsWith('.heic') || name.endsWith('.heif');
}

/**
 * Converts a HEIC/HEIF file to a JPEG Blob using the heic2any library,
 * imported lazily so it never loads for non-HEIC uploads.
 * @param {File} file
 * @returns {Promise<Blob>}
 */
async function convertHeicToJpeg(file) {
  try {
    debug('Converting HEIC to JPEG', { fileName: file.name }, 'IMAGE_LOAD');
    const heic2any = (await import('heic2any')).default;
    const result = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    return Array.isArray(result) ? result[0] : result;
  } catch (err) {
    throw createError('PROCESSING_FAILED', `HEIC conversion failed: ${err.message}`, {
      fileName: file.name,
    });
  }
}

/**
 * Loads an Image element from a File/Blob/URL source using decode()
 * for reliable async loading. Revokes any object URL it creates.
 * @param {File|Blob|string} source
 * @returns {Promise<{ img: HTMLImageElement, width: number, height: number }>}
 */
async function loadImageElement(source) {
  const isObjectSource = source instanceof Blob;
  const url = isObjectSource ? URL.createObjectURL(source) : source;

  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { img, width: img.naturalWidth, height: img.naturalHeight };
  } catch (err) {
    throw createError('PROCESSING_FAILED', `Image decode failed: ${err.message}`);
  } finally {
    if (isObjectSource) {
      URL.revokeObjectURL(url);
    }
  }
}

/**
 * Checks whether the 6 bytes at `offset` spell "Exif\0\0".
 * @param {DataView} view
 * @param {number} offset
 * @returns {boolean}
 */
function isExifHeader(view, offset) {
  return (
    view.getUint8(offset) === 0x45 && // E
    view.getUint8(offset + 1) === 0x78 && // x
    view.getUint8(offset + 2) === 0x69 && // i
    view.getUint8(offset + 3) === 0x66 && // f
    view.getUint8(offset + 4) === 0x00 &&
    view.getUint8(offset + 5) === 0x00
  );
}

/**
 * Reads the EXIF Orientation tag (0x0112) from the first 64KB of a file.
 * Returns 1 (no transform) for non-JPEG files, missing EXIF, or any
 * parsing error — this function must never throw.
 * @param {File} file
 * @returns {Promise<number>} Orientation value 1-8
 */
async function getExifOrientation(file) {
  try {
    const buffer = await file.slice(0, 65536).arrayBuffer();
    const view = new DataView(buffer);

    if (view.getUint16(0, false) !== 0xffd8) {
      return 1; // Not a JPEG (e.g. PNG, WebP, or a freshly-converted HEIC->JPEG)
    }

    const length = view.byteLength;
    let offset = 2;

    while (offset + 4 <= length) {
      const marker = view.getUint16(offset, false);

      if (marker === 0xffe1) {
        const segmentStart = offset + 4;
        if (segmentStart + 6 > length || !isExifHeader(view, segmentStart)) {
          return 1;
        }

        const tiffOffset = segmentStart + 6;
        const byteOrderMark = view.getUint16(tiffOffset, false);
        const little = byteOrderMark === 0x4949;
        if (!little && byteOrderMark !== 0x4d4d) {
          return 1;
        }

        const firstIfdOffset = view.getUint32(tiffOffset + 4, little);
        const dirStart = tiffOffset + firstIfdOffset;
        if (dirStart + 2 > length) return 1;

        const numEntries = view.getUint16(dirStart, little);

        for (let i = 0; i < numEntries; i++) {
          const entryOffset = dirStart + 2 + i * 12;
          if (entryOffset + 12 > length) break;

          const tag = view.getUint16(entryOffset, little);
          if (tag === 0x0112) {
            return view.getUint16(entryOffset + 8, little);
          }
        }
        return 1;
      }

      if ((marker & 0xff00) !== 0xff00) break;

      const segmentLength = view.getUint16(offset + 2, false);
      offset += 2 + segmentLength;
    }

    return 1;
  } catch (err) {
    return 1;
  }
}

/**
 * Draws an image onto a new canvas, applying the transform implied by
 * an EXIF orientation value (1-8). targetWidth/targetHeight are the
 * final (post-orientation-swap) dimensions of the canvas.
 * @param {HTMLImageElement} img
 * @param {number} orientation
 * @param {number} targetWidth
 * @param {number} targetHeight
 * @returns {HTMLCanvasElement}
 */
function drawImageWithOrientation(img, orientation, targetWidth, targetHeight) {
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');

  switch (orientation) {
    case 2:
      ctx.transform(-1, 0, 0, 1, targetWidth, 0);
      break;
    case 3:
      ctx.transform(-1, 0, 0, -1, targetWidth, targetHeight);
      break;
    case 4:
      ctx.transform(1, 0, 0, -1, 0, targetHeight);
      break;
    case 5:
      ctx.transform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      ctx.transform(0, 1, -1, 0, targetHeight, 0);
      break;
    case 7:
      ctx.transform(0, -1, -1, 0, targetHeight, targetWidth);
      break;
    case 8:
      ctx.transform(0, -1, 1, 0, 0, targetWidth);
      break;
    default:
      break; // 1 or unrecognized: no transform
  }

  // The image's natural dimensions are the *pre-swap* dimensions.
  const rawWidth = orientation > 4 ? targetHeight : targetWidth;
  const rawHeight = orientation > 4 ? targetWidth : targetHeight;
  ctx.drawImage(img, 0, 0, rawWidth, rawHeight);

  return canvas;
}

/**
 * Scales width/height down proportionally so the larger side equals
 * maxDimension. Returns the original size unchanged if already within
 * bounds.
 * @param {number} width
 * @param {number} height
 * @param {number} maxDimension
 * @returns {{ width: number, height: number }}
 */
function calculateProcessingSize(width, height, maxDimension) {
  const largerSide = Math.max(width, height);
  if (largerSide <= maxDimension) {
    return { width: Math.round(width), height: Math.round(height) };
  }

  const scale = maxDimension / largerSide;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

/**
 * Validates final image dimensions against the app's min/max bounds.
 * @param {number} width
 * @param {number} height
 * @throws {AppError}
 */
function validateImageDimensions(width, height) {
  if (width < MIN_IMAGE_WIDTH || height < MIN_IMAGE_HEIGHT) {
    throw createError('IMAGE_TOO_SMALL', `${width}x${height}`, { width, height });
  }
  if (Math.max(width, height) > MAX_IMAGE_DIMENSION) {
    throw createError('PROCESSING_FAILED', 'Image too large in dimensions', { width, height });
  }
}

/**
 * Loads a File into processing + original canvas representations,
 * handling HEIC conversion and EXIF rotation correction.
 * @param {File} file
 * @param {object} [options]
 * @param {(stage: string, progress?: number) => void} [options.onProgress]
 * @returns {Promise<{
 *   original: { canvas: HTMLCanvasElement, width: number, height: number },
 *   processing: { canvas: HTMLCanvasElement, width: number, height: number },
 *   metadata: object,
 * }>}
 */
export async function loadImage(file, options = {}) {
  const { onProgress = () => {} } = options;

  try {
    onProgress('loading', 0);
    info('Image load started', { fileName: file.name, size: file.size }, 'IMAGE_LOAD');

    let source = file;
    if (isHeic(file)) {
      onProgress('convertingHeic', 10);
      source = await convertHeicToJpeg(file);
    }

    onProgress('decoding', 30);
    const orientation = await getExifOrientation(file);

    const { img, width: rawWidth, height: rawHeight } = await loadImageElement(source);

    const finalWidth = orientation > 4 ? rawHeight : rawWidth;
    const finalHeight = orientation > 4 ? rawWidth : rawHeight;

    validateImageDimensions(finalWidth, finalHeight);

    onProgress('resizing', 60);
    const originalCanvas = drawImageWithOrientation(img, orientation, finalWidth, finalHeight);

    const procSize = calculateProcessingSize(finalWidth, finalHeight, PROCESSING_MAX_DIMENSION);
    const processingCanvas = document.createElement('canvas');
    processingCanvas.width = procSize.width;
    processingCanvas.height = procSize.height;
    const procCtx = processingCanvas.getContext('2d');
    procCtx.imageSmoothingQuality = 'high';
    procCtx.drawImage(originalCanvas, 0, 0, procSize.width, procSize.height);

    onProgress('ready', 100);

    success('Image loaded', {
      fileName: file.name,
      finalWidth,
      finalHeight,
      processedDimensions: procSize,
    }, 'IMAGE_LOAD');

    return {
      original: { canvas: originalCanvas, width: finalWidth, height: finalHeight },
      processing: { canvas: processingCanvas, width: procSize.width, height: procSize.height },
      metadata: {
        filename: file.name,
        size: file.size,
        format: file.type,
        originalDimensions: { width: rawWidth, height: rawHeight },
        orientation,
        processedDimensions: procSize,
      },
    };
  } catch (err) {
    const appError = err instanceof AppError ? err : createError('PROCESSING_FAILED', err.message, {
      fileName: file.name,
    });
    logError(`Image load failed: ${file.name}`, {
      code: appError.code,
      message: appError.technicalMessage,
    }, 'IMAGE_LOAD');
    throw appError;
  }
}

/**
 * Releases canvas memory for a loaded image by zeroing both canvases'
 * dimensions. Call when a loaded image is no longer needed.
 * @param {{ original: { canvas: HTMLCanvasElement }, processing: { canvas: HTMLCanvasElement } }} loadedImage
 */
export function releaseImageData(loadedImage) {
  if (!loadedImage) return;

  ['original', 'processing'].forEach((key) => {
    const data = loadedImage[key];
    if (data?.canvas) {
      data.canvas.width = 0;
      data.canvas.height = 0;
    }
  });
}
