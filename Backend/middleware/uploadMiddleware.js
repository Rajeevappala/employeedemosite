const multer = require('multer');
const path = require('path');

const ALLOWED_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
const ALLOWED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// Store files in memory buffer; storageService will persist them into private local storage
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname || '').toLowerCase();

  // Validate both MIME type and extension
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype) || !ALLOWED_EXTENSIONS.includes(ext)) {
    const error = new Error('Invalid file type. Only PDF, PNG, and JPEG/JPG files are allowed.');
    error.statusCode = 400;
    error.code = 'INVALID_FILE_TYPE';
    return cb(error, false);
  }

  cb(null, true);
};

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },
  fileFilter,
});

/**
 * Validates buffer magic bytes against expected file signatures.
 * Ensures the physical file payload matches the declared MIME type.
 *
 * Supported formats:
 * - PDF: %PDF- (0x25 0x50 0x44 0x46)
 * - PNG: \x89PNG (0x89 0x50 0x4E 0x47)
 * - JPEG/JPG: \xFF\xD8\xFF
 */
const validateMagicBytes = (buffer, mimetype) => {
  if (!buffer || buffer.length < 3) return false;

  if (mimetype === 'application/pdf') {
    return (
      buffer.length >= 4 &&
      buffer[0] === 0x25 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x44 &&
      buffer[3] === 0x46
    );
  }

  if (mimetype === 'image/png') {
    return (
      buffer.length >= 4 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    );
  }

  if (mimetype === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  if (mimetype === 'image/webp') {
    return (
      buffer.length >= 12 &&
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50
    );
  }

  return false;
};

/**
 * Middleware that handles single document upload under field name 'file'.
 * Formats errors to match portal API standards and validates physical magic bytes.
 */
const uploadSingleDocument = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            message: 'File size exceeds the 10 MB limit',
          });
        }
        return res.status(400).json({
          success: false,
          message: err.message || 'File upload error',
        });
      }

      if (err.statusCode) {
        return res.status(err.statusCode).json({
          success: false,
          message: err.message,
        });
      }

      return res.status(400).json({
        success: false,
        message: err.message || 'File upload error',
      });
    }

    // Validate actual file buffer magic bytes
    if (req.file && req.file.buffer) {
      if (!validateMagicBytes(req.file.buffer, req.file.mimetype)) {
        return res.status(400).json({
          success: false,
          message: 'File content signature does not match the expected format.',
        });
      }
    }

    next();
  });
};

/**
 * Validates whether buffer begins with standard PKZIP / XLSX header (0x50 0x4B 0x03 0x04).
 */
const validateExcelMagicBytes = (buffer) => {
  if (!buffer || buffer.length < 4) return false;
  return buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
};

const excelUpload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ext !== '.xlsx') {
      const error = new Error('Invalid file type. Only .xlsx Excel files are allowed. Macro-enabled (.xlsm) or executable files are rejected.');
      error.statusCode = 400;
      error.code = 'INVALID_EXCEL_TYPE';
      return cb(error, false);
    }
    cb(null, true);
  },
});

/**
 * Middleware for single Excel upload (.xlsx) under field name 'file'.
 */
const uploadSingleExcel = (req, res, next) => {
  excelUpload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            message: 'File size exceeds the 10 MB limit.',
          });
        }
        return res.status(400).json({
          success: false,
          message: err.message || 'Excel file upload error.',
        });
      }

      return res.status(err.statusCode || 400).json({
        success: false,
        message: err.message || 'Invalid file uploaded.',
      });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        message: 'No Excel file provided. Please choose a valid .xlsx file to upload.',
      });
    }

    if (!validateExcelMagicBytes(req.file.buffer)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Excel file format. File signature does not match an authentic .xlsx workbook.',
      });
    }

    next();
  });
};

const onboardingUpload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 15,
  },
  fileFilter,
});

/**
 * Middleware for multiple document and file uploads during employee onboarding wizard.
 * Handles multipart/form-data with fields or files, or gracefully passes through if JSON.
 */
const uploadOnboardingFiles = (req, res, next) => {
  onboardingUpload.any()(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            message: 'One or more files exceed the 10 MB limit.',
          });
        }
        return res.status(400).json({
          success: false,
          message: err.message || 'File upload error',
        });
      }

      if (err.statusCode) {
        return res.status(err.statusCode).json({
          success: false,
          message: err.message,
        });
      }

      return res.status(400).json({
        success: false,
        message: err.message || 'File upload error',
      });
    }

    // Validate magic bytes for all uploaded files
    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      for (const file of req.files) {
        if (file.buffer && !validateMagicBytes(file.buffer, file.mimetype)) {
          return res.status(400).json({
            success: false,
            message: `File content signature for '${file.originalname || file.fieldname}' does not match the expected format. Only authentic PDF, PNG, and JPEG files are permitted.`,
          });
        }
      }
    }

    next();
  });
};

/**
 * Middleware for uploading a single PDF payslip file.
 * Strictly enforces PDF extension, application/pdf MIME type, and %PDF- magic bytes.
 */
const uploadSinglePayslipPdf = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            message: 'File size exceeds the 10 MB limit',
          });
        }
        return res.status(400).json({
          success: false,
          message: err.message || 'File upload error',
        });
      }

      if (err.statusCode) {
        return res.status(err.statusCode).json({
          success: false,
          message: err.message,
        });
      }

      return res.status(400).json({
        success: false,
        message: err.message || 'File upload error',
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded. A PDF file is required under field name "file".',
      });
    }

    const ext = path.extname(req.file.originalname || '').toLowerCase();
    if (ext !== '.pdf' || req.file.mimetype !== 'application/pdf') {
      return res.status(400).json({
        success: false,
        message: 'Invalid file type. Only PDF files are allowed for payslips.',
      });
    }

    if (!validateMagicBytes(req.file.buffer, 'application/pdf')) {
      return res.status(400).json({
        success: false,
        message: 'File content signature does not match PDF format. Only authentic PDF files are allowed.',
      });
    }

    next();
  });
};

const ALLOWED_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_PHOTO_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const MAX_PHOTO_SIZE = 5 * 1024 * 1024; // 5 MB

const photoUpload = multer({
  storage,
  limits: {
    fileSize: MAX_PHOTO_SIZE,
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_PHOTO_MIME_TYPES.includes(file.mimetype) || !ALLOWED_PHOTO_EXTENSIONS.includes(ext)) {
      const error = new Error('Invalid file type. Only JPEG, PNG, and WebP images are allowed for profile photos.');
      error.statusCode = 400;
      error.code = 'INVALID_FILE_TYPE';
      return cb(error, false);
    }
    cb(null, true);
  },
});

/**
 * Middleware for uploading a single profile photo.
 * Accepts either field 'photo' or 'file'.
 * Strictly enforces JPEG, PNG, WebP format, 5MB limit, and magic bytes.
 */
const uploadSingleProfilePhoto = (req, res, next) => {
  const handler = photoUpload.fields([
    { name: 'photo', maxCount: 1 },
    { name: 'file', maxCount: 1 },
  ]);

  handler(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            message: 'File size exceeds the 5 MB limit',
          });
        }
        return res.status(400).json({
          success: false,
          message: err.message || 'File upload error',
        });
      }

      if (err.statusCode) {
        return res.status(err.statusCode).json({
          success: false,
          message: err.message,
        });
      }

      return res.status(400).json({
        success: false,
        message: err.message || 'File upload error',
      });
    }

    const uploadedFile = (req.files?.photo && req.files.photo[0]) || (req.files?.file && req.files.file[0]) || req.file;

    if (!uploadedFile) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded. An image file (JPEG, PNG, or WebP) is required.',
      });
    }

    // Attach as req.file for downstream controller
    req.file = uploadedFile;

    const ext = path.extname(req.file.originalname || '').toLowerCase();
    if (!ALLOWED_PHOTO_EXTENSIONS.includes(ext) || !ALLOWED_PHOTO_MIME_TYPES.includes(req.file.mimetype)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file type. Only JPEG, PNG, and WebP images are allowed for profile photos.',
      });
    }

    if (!validateMagicBytes(req.file.buffer, req.file.mimetype)) {
      return res.status(400).json({
        success: false,
        message: 'File content signature does not match expected image format. Only authentic JPEG, PNG, and WebP files are allowed.',
      });
    }

    next();
  });
};

module.exports = {
  uploadSingleDocument,
  uploadSingleExcel,
  uploadSinglePayslipPdf,
  uploadSingleProfilePhoto,
  uploadOnboardingFiles,
  validateMagicBytes,
  validateExcelMagicBytes,
  ALLOWED_MIME_TYPES,
  ALLOWED_EXTENSIONS,
  ALLOWED_PHOTO_MIME_TYPES,
  ALLOWED_PHOTO_EXTENSIONS,
  MAX_FILE_SIZE,
  MAX_PHOTO_SIZE,
};

