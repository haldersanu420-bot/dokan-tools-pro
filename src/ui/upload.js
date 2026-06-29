/**
 * Reusable image upload zone for Dokan Tools Pro.
 *
 * Supports drag-and-drop, click-to-browse, and mobile camera capture.
 * Validates files against the app's format/size constants, shows toast
 * feedback on rejection, renders object-URL thumbnail previews, and
 * cleans up after itself (revokes object URLs, removes listeners).
 *
 * Usage:
 *   import { createUploadZone } from './ui/upload.js';
 *
 *   const zone = createUploadZone({
 *     container: document.querySelector('#upload-area'),
 *     onFilesAdded: (files) => console.log('got files', files),
 *   });
 *
 *   zone.getFiles();
 *   zone.removeFile(0);
 *   zone.clear();
 *   zone.destroy(); // call when the upload zone is unmounted
 */

import { info, warn } from '../utils/logger.js';
import { createError } from '../utils/error-handler.js';
import * as toast from './toast.js';
import { t } from '../locales/index.js';
import { SUPPORTED_FORMATS, SUPPORTED_EXTENSIONS, MAX_FILE_SIZE_BYTES } from '../utils/constants.js';

/**
 * Returns the lowercase extension (including the dot) of a filename.
 * @param {string} filename
 * @returns {string}
 */
function getExtension(filename) {
  const dotIndex = filename.lastIndexOf('.');
  return dotIndex === -1 ? '' : filename.slice(dotIndex).toLowerCase();
}

/**
 * Checks whether a file's MIME type or extension is supported.
 * @param {File} file
 * @returns {boolean}
 */
function isSupportedFormat(file) {
  if (SUPPORTED_FORMATS.includes(file.type)) {
    return true;
  }
  return SUPPORTED_EXTENSIONS.includes(getExtension(file.name));
}

/**
 * Creates an interactive upload zone inside the given container.
 * @param {object} options
 * @param {HTMLElement} options.container - Required mount point
 * @param {boolean} [options.multiple] - Allow multiple files, default true
 * @param {number} [options.maxFiles] - Max number of files allowed, default 10
 * @param {(files: File[]) => void} [options.onFilesAdded]
 * @param {(file: File, remainingFiles: File[]) => void} [options.onFileRemoved]
 * @param {() => void} [options.onClear]
 * @returns {{ getFiles: () => File[], addFiles: (fileList: FileList|File[]) => void, removeFile: (index: number) => void, clear: () => void, destroy: () => void }}
 */
export function createUploadZone(options) {
  const {
    container,
    multiple = true,
    maxFiles = 10,
    onFilesAdded = () => {},
    onFileRemoved = () => {},
    onClear = () => {},
  } = options;

  /** @type {File[]} */
  let files = [];

  /** @type {string[]} Object URLs aligned by index with `files` */
  let previewUrls = [];

  container.innerHTML = `
    <div class="upload-zone">
      <div class="dropzone" tabindex="0" role="button" aria-label="Upload images">
        <span class="dropzone-icon">📁</span>
        <div class="dropzone-text">${t('upload.dragHere')}</div>
        <div class="dropzone-or">${t('common.or')}</div>
        <button type="button" class="btn btn-primary">
          ${t('upload.clickToBrowse')}
        </button>
        <div class="dropzone-hint">
          ${t('upload.supportedFormats')} • ${t('upload.maxSize')}
        </div>
        <input type="file" accept="image/*" ${multiple ? 'multiple' : ''} capture="environment" />
      </div>

      <div class="file-preview-grid" hidden></div>

      <div class="upload-summary" hidden>
        <span class="upload-count"></span>
        <button type="button" class="btn btn-secondary text-sm" data-action="clear-all">
          ${t('upload.clearAll')}
        </button>
      </div>
    </div>
  `;

  const dropzoneEl = container.querySelector('.dropzone');
  const inputEl = container.querySelector('input[type="file"]');
  const previewGridEl = container.querySelector('.file-preview-grid');
  const summaryEl = container.querySelector('.upload-summary');
  const countEl = container.querySelector('.upload-count');
  const clearAllBtn = container.querySelector('[data-action="clear-all"]');

  /**
   * Re-renders the preview grid and summary based on current `files`.
   */
  function render() {
    const hasFiles = files.length > 0;
    previewGridEl.hidden = !hasFiles;
    summaryEl.hidden = !hasFiles;

    previewGridEl.innerHTML = files
      .map((file, index) => `
        <div class="file-preview-item" data-index="${index}">
          <img src="${previewUrls[index]}" alt="${file.name}" />
          <button type="button" class="file-preview-remove" data-action="remove" data-index="${index}" aria-label="${t('upload.removeFile')}">×</button>
          <div class="file-preview-name">${file.name}</div>
        </div>
      `)
      .join('');

    countEl.textContent = `${files.length} ${t('upload.selectedCount')}`;
  }

  /**
   * Validates a single file against supported formats and max size.
   * Shows a toast and logs a warning if invalid.
   * @param {File} file
   * @returns {boolean}
   */
  function validateFile(file) {
    if (!isSupportedFormat(file)) {
      const err = createError('INVALID_FORMAT', `Unsupported file type: ${file.type || getExtension(file.name)}`, {
        fileName: file.name,
      });
      warn('Rejected file: invalid format', { fileName: file.name, type: file.type }, 'UPLOAD');
      toast.showAppError(err);
      return false;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      const err = createError('FILE_TOO_LARGE', `File too large: ${file.size} bytes`, {
        fileName: file.name,
        size: file.size,
      });
      warn('Rejected file: too large', { fileName: file.name, size: file.size }, 'UPLOAD');
      toast.showAppError(err);
      return false;
    }

    return true;
  }

  /**
   * Validates and appends new files to the internal list, respecting
   * maxFiles. Notifies via onFilesAdded with the newly accepted files.
   * @param {FileList|File[]} fileList
   */
  function addFiles(fileList) {
    const incoming = Array.from(fileList);
    const valid = incoming.filter(validateFile);

    if (valid.length === 0) {
      return;
    }

    const availableSlots = maxFiles - files.length;
    const accepted = valid.slice(0, Math.max(availableSlots, 0));

    if (accepted.length < valid.length) {
      toast.warning(t('upload.maxFilesReached', `Maximum ${maxFiles} images allowed`));
    }

    accepted.forEach((file) => {
      files.push(file);
      previewUrls.push(URL.createObjectURL(file));
      info('File added', { fileName: file.name, size: file.size }, 'UPLOAD');
    });

    if (accepted.length > 0) {
      render();
      onFilesAdded(accepted);
    }
  }

  /**
   * Removes a file at the given index, revoking its object URL.
   * @param {number} index
   */
  function removeFile(index) {
    if (index < 0 || index >= files.length) return;

    const [removedFile] = files.splice(index, 1);
    const [removedUrl] = previewUrls.splice(index, 1);
    URL.revokeObjectURL(removedUrl);

    render();
    onFileRemoved(removedFile, [...files]);
  }

  /**
   * Clears all files, revoking all object URLs.
   */
  function clear() {
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    files = [];
    previewUrls = [];
    render();
    onClear();
  }

  /**
   * Returns a shallow copy of the currently held files.
   * @returns {File[]}
   */
  function getFiles() {
    return [...files];
  }

  // ---- Event wiring ----

  function handleInputChange(event) {
    addFiles(event.target.files);
    event.target.value = '';
  }

  function handleDragEnter(event) {
    event.preventDefault();
    dropzoneEl.classList.add('is-dragging');
  }

  function handleDragOver(event) {
    event.preventDefault();
  }

  function handleDragLeave() {
    dropzoneEl.classList.remove('is-dragging');
  }

  function handleDrop(event) {
    event.preventDefault();
    dropzoneEl.classList.remove('is-dragging');
    addFiles(event.dataTransfer.files);
  }

  function handleDropzoneKeydown(event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      inputEl.click();
    }
  }

  function handlePreviewGridClick(event) {
    const removeBtn = event.target.closest('[data-action="remove"]');
    if (!removeBtn) return;
    removeFile(Number(removeBtn.dataset.index));
  }

  function handleClearAllClick() {
    clear();
  }

  inputEl.addEventListener('change', handleInputChange);
  dropzoneEl.addEventListener('dragenter', handleDragEnter);
  dropzoneEl.addEventListener('dragover', handleDragOver);
  dropzoneEl.addEventListener('dragleave', handleDragLeave);
  dropzoneEl.addEventListener('drop', handleDrop);
  dropzoneEl.addEventListener('keydown', handleDropzoneKeydown);
  previewGridEl.addEventListener('click', handlePreviewGridClick);
  clearAllBtn.addEventListener('click', handleClearAllClick);

  /**
   * Revokes all object URLs, removes listeners, and clears the container.
   */
  function destroy() {
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    files = [];
    previewUrls = [];

    inputEl.removeEventListener('change', handleInputChange);
    dropzoneEl.removeEventListener('dragenter', handleDragEnter);
    dropzoneEl.removeEventListener('dragover', handleDragOver);
    dropzoneEl.removeEventListener('dragleave', handleDragLeave);
    dropzoneEl.removeEventListener('drop', handleDrop);
    dropzoneEl.removeEventListener('keydown', handleDropzoneKeydown);
    previewGridEl.removeEventListener('click', handlePreviewGridClick);
    clearAllBtn.removeEventListener('click', handleClearAllClick);

    container.innerHTML = '';
  }

  return { getFiles, addFiles, removeFile, clear, destroy };
}
