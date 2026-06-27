/**
 * Bengali (bn) translations for Dokan Tools Pro.
 * Default locale — see ./index.js for the t() translator.
 */
export default {
  app: {
    title: 'দোকান টুলস প্রো',
    subtitle: 'AI চালিত আইডি কার্ড ও পাসপোর্ট ছবি তৈরি',
    loading: 'লোড হচ্ছে...',
    ready: 'প্রস্তুত',
  },
  module: {
    cardSheet: 'আইডি কার্ড শীট তৈরি',
    passportPhoto: 'পাসপোর্ট ছবি তৈরি',
    selectModule: 'কী তৈরি করতে চান?',
  },
  upload: {
    chooseFile: 'ছবি নির্বাচন করুন',
    dropHere: 'এখানে ছবি টেনে আনুন',
    or: 'অথবা',
    fromCamera: 'ক্যামেরা থেকে',
    fromGallery: 'গ্যালারি থেকে',
    multipleAllowed: 'একাধিক ছবি দিতে পারেন',
  },
  button: {
    upload: 'আপলোড করুন',
    process: 'প্রসেস করুন',
    download: 'ডাউনলোড করুন',
    retry: 'আবার চেষ্টা করুন',
    cancel: 'বাতিল',
    confirm: 'নিশ্চিত করুন',
    next: 'পরবর্তী',
    back: 'পেছনে',
    reset: 'নতুন শুরু',
  },
  process: {
    analyzing: 'ছবি বিশ্লেষণ হচ্ছে...',
    detectingCards: 'কার্ড খোঁজা হচ্ছে...',
    detectingFace: 'মুখ খোঁজা হচ্ছে...',
    removingBackground: 'ব্যাকগ্রাউন্ড সরানো হচ্ছে...',
    cropping: 'ক্রপ করা হচ্ছে...',
    arrangingLayout: 'লেআউট সাজানো হচ্ছে...',
    generatingPDF: 'PDF তৈরি হচ্ছে...',
    complete: 'সম্পন্ন!',
  },
  preview: {
    detectedCount: 'কার্ড পাওয়া গেছে',
    copyCount: 'কপি সংখ্যা',
    cardsPerSheet: 'প্রতি A4-এ কয়টি কার্ড',
  },
  error: {
    title: 'সমস্যা হয়েছে',
    fileTooLarge: 'ছবিটি অনেক বড়',
    invalidFormat: 'এই ফরম্যাট সাপোর্ট করে না',
    imageTooSmall: 'ছবি খুব ছোট',
    noCardDetected: 'কোনো কার্ড পাওয়া যায়নি',
    noFaceDetected: 'ছবিতে মুখ পাওয়া যায়নি',
    modelLoadFailed: 'AI মডেল লোড হচ্ছে না',
    outOfMemory: 'মেমরি কম পড়ে গেছে',
    processingFailed: 'প্রসেসিং-এ সমস্যা হয়েছে',
    pdfGenerationFailed: 'PDF তৈরি করতে সমস্যা হয়েছে',
    unknown: 'একটি অজানা সমস্যা হয়েছে',
    tryAgain: 'আবার চেষ্টা করুন',
  },
  success: {
    pdfReady: 'PDF প্রস্তুত!',
    downloadStarted: 'ডাউনলোড শুরু হয়েছে',
    saved: 'সংরক্ষিত হয়েছে',
  },
  common: {
    or: 'অথবা',
    and: 'এবং',
    of: 'এর',
    yes: 'হ্যাঁ',
    no: 'না',
    close: 'বন্ধ করুন',
  },
};
