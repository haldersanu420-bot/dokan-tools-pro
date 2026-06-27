/**
 * Centralized error handling for Dokan Tools Pro.
 *
 * Categorizes errors (USER / SYSTEM / UNKNOWN), attaches Bengali user-facing
 * messages and recovery suggestions, logs technical details via logger.js,
 * and exposes global window error/unhandledrejection handlers.
 *
 * Usage:
 *   import { createError, handleError, registerGlobalHandlers } from './error-handler.js';
 *
 *   registerGlobalHandlers(); // call once at app startup
 *
 *   try {
 *     if (file.size > MAX_FILE_SIZE_BYTES) {
 *       throw createError('FILE_TOO_LARGE', `File size: ${file.size} bytes`, { size: file.size });
 *     }
 *   } catch (err) {
 *     const { userMessage, recovery } = handleError(err);
 *     // pass userMessage/recovery to a toast/UI layer (see Task B5)
 *   }
 */

import { error as logError } from './logger.js';

/** @type {{ USER: string, SYSTEM: string, UNKNOWN: string }} Error category enum */
export const ERROR_CATEGORY = {
  USER: 'USER',
  SYSTEM: 'SYSTEM',
  UNKNOWN: 'UNKNOWN',
};

/** @type {object} Lookup table of known error codes to their category and Bengali messages */
export const ERROR_CODES = {
  // ---- USER errors ----
  FILE_TOO_LARGE: {
    category: ERROR_CATEGORY.USER,
    userMessage: 'ছবিটি অনেক বড়। ২০ MB এর কম ছবি দিন।',
    recovery: 'ছবি ছোট করে আবার চেষ্টা করুন।',
  },
  INVALID_FORMAT: {
    category: ERROR_CATEGORY.USER,
    userMessage: 'এই ফরম্যাট সাপোর্ট করে না।',
    recovery: 'JPG, PNG, বা WebP ফরম্যাটের ছবি দিন।',
  },
  IMAGE_TOO_SMALL: {
    category: ERROR_CATEGORY.USER,
    userMessage: 'ছবি খুব ছোট।',
    recovery: 'আরো ভালো quality-র ছবি দিন (কমপক্ষে 500×500 pixel)।',
  },
  NO_CARD_DETECTED: {
    category: ERROR_CATEGORY.USER,
    userMessage: 'ছবিতে কোনো কার্ড পাওয়া যায়নি।',
    recovery: 'কার্ডটি পরিষ্কার ভাবে তুলে আবার চেষ্টা করুন।',
  },
  NO_FACE_DETECTED: {
    category: ERROR_CATEGORY.USER,
    userMessage: 'ছবিতে মুখ পাওয়া যায়নি।',
    recovery: 'সামনে তাকানো একটি স্পষ্ট ছবি দিন।',
  },

  // ---- SYSTEM errors ----
  MODEL_LOAD_FAILED: {
    category: ERROR_CATEGORY.SYSTEM,
    userMessage: 'AI মডেল লোড হচ্ছে না।',
    recovery: 'পেজ রিফ্রেশ করে আবার চেষ্টা করুন।',
  },
  OPENCV_LOAD_FAILED: {
    category: ERROR_CATEGORY.SYSTEM,
    userMessage: 'প্রসেসিং টুল লোড হচ্ছে না।',
    recovery: 'ইন্টারনেট চেক করে পেজ রিফ্রেশ করুন।',
  },
  OUT_OF_MEMORY: {
    category: ERROR_CATEGORY.SYSTEM,
    userMessage: 'মেমরি কম পড়ে গেছে।',
    recovery: 'অন্য ট্যাব বন্ধ করে আবার চেষ্টা করুন।',
  },
  PROCESSING_FAILED: {
    category: ERROR_CATEGORY.SYSTEM,
    userMessage: 'প্রসেসিং-এ সমস্যা হয়েছে।',
    recovery: 'অন্য একটি ছবি দিয়ে চেষ্টা করুন।',
  },
  PDF_GENERATION_FAILED: {
    category: ERROR_CATEGORY.SYSTEM,
    userMessage: 'PDF তৈরি করতে সমস্যা হয়েছে।',
    recovery: 'আবার চেষ্টা করুন।',
  },

  // ---- UNKNOWN errors ----
  UNKNOWN: {
    category: ERROR_CATEGORY.UNKNOWN,
    userMessage: 'একটি অজানা সমস্যা হয়েছে।',
    recovery: 'পেজ রিফ্রেশ করে আবার চেষ্টা করুন।',
  },
};

/**
 * Application-specific error carrying a code, category, and Bengali
 * user-facing message alongside the original technical message.
 */
export class AppError extends Error {
  /**
   * @param {string} code - Key from ERROR_CODES (e.g., 'FILE_TOO_LARGE')
   * @param {string} category - One of ERROR_CATEGORY values
   * @param {string} technicalMessage - English message for logs
   * @param {object} [options]
   * @param {string} [options.userMessage] - Bengali message for UI
   * @param {string} [options.recovery] - Bengali recovery suggestion
   * @param {object} [options.data] - Additional context
   */
  constructor(code, category, technicalMessage, options = {}) {
    super(technicalMessage);
    this.name = 'AppError';
    this.code = code;
    this.category = category;
    this.technicalMessage = technicalMessage;
    this.userMessage = options.userMessage || ERROR_CODES.UNKNOWN.userMessage;
    this.recovery = options.recovery || ERROR_CODES.UNKNOWN.recovery;
    this.data = options.data || null;
    this.timestamp = new Date().toISOString();
  }
}

/** @type {{ total: number }} Running count of errors handled */
const errorStats = { total: 0 };

/**
 * Creates an AppError from a known error code, looking up its category
 * and Bengali messages from ERROR_CODES. Falls back to UNKNOWN if the
 * code is not recognized.
 * @param {string} code
 * @param {string} [technicalMessage]
 * @param {object} [data]
 * @returns {AppError}
 */
export function createError(code, technicalMessage, data) {
  const definition = ERROR_CODES[code] || ERROR_CODES.UNKNOWN;
  const resolvedCode = ERROR_CODES[code] ? code : 'UNKNOWN';

  return new AppError(
    resolvedCode,
    definition.category,
    technicalMessage || resolvedCode,
    {
      userMessage: definition.userMessage,
      recovery: definition.recovery,
      data,
    }
  );
}

/**
 * Main error handling entry point. Normalizes any thrown value into an
 * AppError, logs it, and returns a UI-ready formatted object.
 * Never throws.
 * @param {*} err - The caught error (AppError, generic Error, or anything else)
 * @returns {{ userMessage: string, recovery: string, category: string, code: string }}
 */
export function handleError(err) {
  try {
    let appError;

    if (err instanceof AppError) {
      appError = err;
    } else if (err instanceof Error) {
      appError = createError('UNKNOWN', err.message, { stack: err.stack });
    } else {
      appError = createError('UNKNOWN', String(err));
    }

    errorStats.total += 1;

    logError(appError.technicalMessage, {
      code: appError.code,
      category: appError.category,
      data: appError.data,
      timestamp: appError.timestamp,
    }, 'ERROR_HANDLER');

    return {
      userMessage: appError.userMessage,
      recovery: appError.recovery,
      category: appError.category,
      code: appError.code,
    };
  } catch (internalError) {
    // handleError must never throw — fall back to a safe default
    return {
      userMessage: ERROR_CODES.UNKNOWN.userMessage,
      recovery: ERROR_CODES.UNKNOWN.recovery,
      category: ERROR_CATEGORY.UNKNOWN,
      code: 'UNKNOWN',
    };
  }
}

/**
 * Attaches global handlers for uncaught errors and unhandled promise
 * rejections so nothing crashes silently. Call once at app startup.
 */
export function registerGlobalHandlers() {
  window.addEventListener('error', (event) => {
    handleError(event.error || event.message);
    event.preventDefault();
  });

  window.addEventListener('unhandledrejection', (event) => {
    handleError(event.reason);
    event.preventDefault();
  });
}

/**
 * Returns aggregate stats about errors handled so far.
 * @returns {{ total: number }}
 */
export function getErrorStats() {
  return { ...errorStats };
}
