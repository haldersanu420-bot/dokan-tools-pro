/**
 * Application-wide constants for Dokan Tools Pro.
 * Central place for app metadata, file limits, image/card dimensions,
 * and output settings used across modules (ID Card Sheet Generator,
 * Passport Photo Maker, etc).
 */

// ---- App metadata ----

/** @type {string} Display name of the application */
export const APP_NAME = 'দোকান টুলস প্রো';

/** @type {string} Current application version */
export const APP_VERSION = '0.1.0';

/** @type {string} Default UI language code */
export const DEFAULT_LANGUAGE = 'bn';

// ---- Image upload limits ----

/** @type {number} Maximum allowed upload size in megabytes */
export const MAX_FILE_SIZE_MB = 20;

/** @type {number} Maximum allowed upload size in bytes */
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

/** @type {number} Minimum accepted image width in pixels */
export const MIN_IMAGE_WIDTH = 500;

/** @type {number} Minimum accepted image height in pixels */
export const MIN_IMAGE_HEIGHT = 500;

/** @type {number} Maximum accepted image dimension (width or height) in pixels */
export const MAX_IMAGE_DIMENSION = 8000;

// ---- Supported formats ----

/** @type {string[]} Accepted MIME types for image uploads */
export const SUPPORTED_FORMATS = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

/** @type {string[]} Accepted file extensions for image uploads */
export const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.heic'];

// ---- Processing ----

/** @type {number} Max dimension images are downsized to before AI processing */
export const PROCESSING_MAX_DIMENSION = 2000;

/** @type {number} Output resolution in dots per inch */
export const OUTPUT_DPI = 300;

// ---- Card output dimensions (Aadhaar/PAN/Voter/DL standard) ----

/** @type {number} Standard ID card width in millimeters */
export const CARD_WIDTH_MM = 86;

/** @type {number} Standard ID card height in millimeters */
export const CARD_HEIGHT_MM = 54;

/** @type {number} Standard ID card aspect ratio (width / height) */
export const CARD_ASPECT_RATIO = CARD_WIDTH_MM / CARD_HEIGHT_MM;

// ---- A4 paper ----

/** @type {number} A4 paper width in millimeters */
export const A4_WIDTH_MM = 210;

/** @type {number} A4 paper height in millimeters */
export const A4_HEIGHT_MM = 297;

/** @type {number} A4 paper width in pixels at 300 DPI */
export const A4_WIDTH_PX_300DPI = 2480;

/** @type {number} A4 paper height in pixels at 300 DPI */
export const A4_HEIGHT_PX_300DPI = 3508;

// ---- Layout ----

/** @type {number} Margin reserved for cutting guides in millimeters */
export const CUTTING_MARGIN_MM = 3;

/** @type {number[]} Allowed options for number of cards per A4 sheet */
export const CARDS_PER_A4_OPTIONS = [4, 6, 8, 10];

// ---- PDF ----

/** @type {number} JPEG compression quality used when embedding images in PDF (0-1) */
export const PDF_JPEG_QUALITY = 0.9;

// ---- AI model paths and config ----

/** @type {{ cardDetector: string }} Paths to self-hosted ONNX model files */
export const MODEL_PATHS = {
  cardDetector: '/models/u2netp.onnx',
};

/** @type {number} U²-Net expects a 320x320 RGB input */
export const U2NET_INPUT_SIZE = 320;

/** @type {number[]} ImageNet normalization mean (R, G, B) */
export const U2NET_INPUT_MEAN = [0.485, 0.456, 0.406];

/** @type {number[]} ImageNet normalization std deviation (R, G, B) */
export const U2NET_INPUT_STD = [0.229, 0.224, 0.225];

// ---- Mask post-processing ----

/** @type {number} Binarization threshold: mask pixels > this value are card area */
export const MASK_THRESHOLD = 0.5;
