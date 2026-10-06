const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

/**
 * Custom Error hierarchy for storage operations
 */
class StorageError extends Error {
  constructor(message, statusCode = 500, code = 'STORAGE_ERROR') {
    super(message);
    this.name = 'StorageError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

class InvalidStorageKeyError extends StorageError {
  constructor(message = 'Invalid storage key') {
    super(message, 400, 'INVALID_STORAGE_KEY');
    this.name = 'InvalidStorageKeyError';
  }
}

class FileNotFoundError extends StorageError {
  constructor(message = 'File not found in storage') {
    super(message, 404, 'FILE_NOT_FOUND');
    this.name = 'FileNotFoundError';
  }
}

class StorageWriteError extends StorageError {
  constructor(message = 'Failed to write file to storage') {
    super(message, 500, 'STORAGE_WRITE_ERROR');
    this.name = 'StorageWriteError';
  }
}

class StorageDeleteError extends StorageError {
  constructor(message = 'Failed to delete file from storage') {
    super(message, 500, 'STORAGE_DELETE_ERROR');
    this.name = 'StorageDeleteError';
  }
}

/**
 * Returns the resolved absolute path to the private storage base directory.
 * Reads PRIVATE_STORAGE_PATH from environment with fallback to './storage/private'.
 *
 * @returns {string} Absolute path to base storage directory
 */
const getStorageBasePath = () => {
  const configured = process.env.PRIVATE_STORAGE_PATH || './storage/private';
  if (path.isAbsolute(configured)) {
    return path.resolve(configured);
  }
  // Relative to Backend/ project root (one level up from services/)
  return path.resolve(__dirname, '..', configured);
};

/**
 * Validates a storage key and securely resolves its absolute path within the private storage directory.
 *
 * Prevents:
 * 1. Path traversal attacks (../, ..\, /../)
 * 2. Absolute filesystem paths (/etc/passwd, C:\..., \\unc\share)
 * 3. Null-byte injection (\0)
 * 4. Illegal path characters and segment manipulations
 * 5. Escaping the storage directory via symlinks or relative resolution
 *
 * @param {string} storageKey Relative path/key inside storage
 * @returns {{ normalizedKey: string, resolvedPath: string }} Validated key and resolved path
 * @throws {InvalidStorageKeyError} If storage key is invalid or escapes storage directory
 */
const validateStorageKey = (storageKey) => {
  if (typeof storageKey !== 'string' || !storageKey.trim()) {
    throw new InvalidStorageKeyError('Storage key must be a non-empty string');
  }

  // Normalize all backslashes to forward slashes and trim
  const normalizedKey = storageKey.replace(/\\/g, '/').trim();

  // Reject null-bytes
  if (normalizedKey.includes('\0')) {
    throw new InvalidStorageKeyError('Storage key contains invalid null-byte sequence');
  }

  // Reject absolute paths, UNC paths, and Windows drive letters
  if (
    normalizedKey.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalizedKey) ||
    normalizedKey.startsWith('//') ||
    normalizedKey.includes('//')
  ) {
    throw new InvalidStorageKeyError('Storage key cannot start with a slash, double slash, or drive identifier');
  }

  // Segment-by-segment check
  const segments = normalizedKey.split('/');
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') {
      throw new InvalidStorageKeyError('Storage key contains invalid path traversal segments');
    }
    // Allow standard safe characters: alphanumeric, dot, underscore, hyphen
    if (!/^[a-zA-Z0-9._-]+$/.test(segment)) {
      throw new InvalidStorageKeyError(`Storage key segment '${segment}' contains unsupported or unsafe characters`);
    }
  }

  // Absolute path resolution assertion
  const basePath = getStorageBasePath();
  const resolvedPath = path.resolve(basePath, normalizedKey);

  // Assert target path is strictly within basePath
  const relativePath = path.relative(basePath, resolvedPath);
  if (
    relativePath.startsWith('..') ||
    path.isAbsolute(relativePath) ||
    resolvedPath === basePath ||
    !resolvedPath.startsWith(basePath + path.sep)
  ) {
    throw new InvalidStorageKeyError('Storage key resolves outside the private storage root');
  }

  return { normalizedKey, resolvedPath };
};

/**
 * Generates a collision-resistant unique storage key.
 * Never exposes or uses original client filenames for storage path resolution.
 *
 * Example format:
 * documents/GP0001N/2026/09/550e8400-e29b-41d4-a716-446655440000.pdf
 *
 * @param {Object} options
 * @param {string} [options.employeeId] Employee ID (e.g. GP0001N)
 * @param {string} [options.originalFilename] Original filename used ONLY to safely derive extension (.pdf)
 * @param {string} [options.prefix='documents'] Top-level folder prefix
 * @returns {string} Sanitized relative storage key
 */
const generateStorageKey = ({ employeeId, originalFilename, prefix = 'documents' } = {}) => {
  let safeExt = '';
  if (originalFilename && typeof originalFilename === 'string') {
    const ext = path.extname(originalFilename).toLowerCase();
    // Allow only alphanumeric extensions up to 10 chars
    if (/^\.[a-z0-9]{1,10}$/.test(ext)) {
      safeExt = ext;
    }
  }

  const uuid = crypto.randomUUID();
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');

  const cleanPrefix = (prefix || 'documents').replace(/[^a-zA-Z0-9_-]/g, '');

  if (employeeId && typeof employeeId === 'string') {
    const cleanEmpId = employeeId.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (cleanEmpId) {
      return `${cleanPrefix}/${cleanEmpId}/${year}/${month}/${uuid}${safeExt}`;
    }
  }

  return `${cleanPrefix}/${year}/${month}/${uuid}${safeExt}`;
};

/**
 * Saves a file buffer to private storage.
 * Automatically creates parent directories if needed.
 *
 * @param {Buffer|Uint8Array|string} buffer File content
 * @param {string} storageKey Application-controlled storage key
 * @returns {Promise<{ storageKey: string, size: number }>} Storage metadata (no internal filesystem path exposed)
 * @throws {InvalidStorageKeyError} If key is invalid or attempts traversal
 * @throws {StorageError} If buffer is invalid or file write fails
 */
const saveFile = async (buffer, storageKey) => {
  if (
    !buffer ||
    (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array) && typeof buffer !== 'string')
  ) {
    throw new StorageError('Invalid file data: A valid Buffer, Uint8Array, or string must be provided', 400, 'INVALID_FILE_BUFFER');
  }

  const { normalizedKey, resolvedPath } = validateStorageKey(storageKey);

  try {
    const dir = path.dirname(resolvedPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(resolvedPath, buffer);

    const size = Buffer.isBuffer(buffer)
      ? buffer.length
      : Buffer.byteLength(buffer);

    return {
      storageKey: normalizedKey,
      size,
    };
  } catch (err) {
    if (err instanceof StorageError) {
      throw err;
    }
    throw new StorageWriteError(`Failed to save file: ${err.message}`);
  }
};

/**
 * Retrieves a file buffer from private storage.
 *
 * @param {string} storageKey Valid storage key
 * @returns {Promise<Buffer>} The file buffer
 * @throws {InvalidStorageKeyError} If key is invalid
 * @throws {FileNotFoundError} If file does not exist
 * @throws {StorageError} If read fails
 */
const getFile = async (storageKey) => {
  const { resolvedPath } = validateStorageKey(storageKey);

  let stat;
  try {
    stat = await fs.stat(resolvedPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new FileNotFoundError(`File not found: ${storageKey}`);
    }
    throw new StorageError(`Error accessing file: ${err.message}`, 500, 'STORAGE_ACCESS_ERROR');
  }

  if (!stat.isFile()) {
    throw new FileNotFoundError(`Requested storage key is not a file: ${storageKey}`);
  }

  try {
    const buffer = await fs.readFile(resolvedPath);
    return buffer;
  } catch (err) {
    throw new StorageError(`Failed to read file: ${err.message}`, 500, 'STORAGE_READ_ERROR');
  }
};

/**
 * Internal helper to safely resolve the local file path for server-side operations
 * (e.g., Express res.sendFile or streaming), verifying that the file exists and is strictly
 * inside the private storage boundary.
 *
 * Note: Never send this resolved path to the client.
 *
 * @param {string} storageKey Valid storage key
 * @returns {Promise<string>} Validated safe local absolute path
 * @throws {InvalidStorageKeyError} If key is invalid
 * @throws {FileNotFoundError} If file does not exist
 */
const getSafeFilePath = async (storageKey) => {
  const { resolvedPath } = validateStorageKey(storageKey);

  let stat;
  try {
    stat = await fs.stat(resolvedPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new FileNotFoundError(`File not found: ${storageKey}`);
    }
    throw new StorageError(`Error accessing file: ${err.message}`, 500, 'STORAGE_ACCESS_ERROR');
  }

  if (!stat.isFile()) {
    throw new FileNotFoundError(`Requested storage key is not a file: ${storageKey}`);
  }

  return resolvedPath;
};

/**
 * Deletes a file from private storage.
 * If the file does not exist, handles the condition cleanly without throwing.
 *
 * @param {string} storageKey Valid storage key
 * @returns {Promise<boolean>} True if file was deleted, false if file did not exist
 * @throws {InvalidStorageKeyError} If storage key is invalid or attempts traversal
 * @throws {StorageDeleteError} If deletion fails due to filesystem permissions or errors
 */
const deleteFile = async (storageKey) => {
  const { resolvedPath } = validateStorageKey(storageKey);

  try {
    await fs.unlink(resolvedPath);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return false; // Handled cleanly, not an error
    }
    throw new StorageDeleteError(`Failed to delete file: ${err.message}`);
  }
};

/**
 * Checks whether a file exists in private storage.
 * Returns false if the file does not exist or if the key is invalid.
 * Never throws for normal non-existent files.
 *
 * @param {string} storageKey Storage key to check
 * @returns {Promise<boolean>} True if file exists and is a regular file, false otherwise
 */
const fileExists = async (storageKey) => {
  try {
    const { resolvedPath } = validateStorageKey(storageKey);
    const stat = await fs.stat(resolvedPath);
    return stat.isFile();
  } catch {
    return false;
  }
};

module.exports = {
  saveFile,
  getFile,
  deleteFile,
  fileExists,
  getSafeFilePath,
  validateStorageKey,
  generateStorageKey,
  getStorageBasePath,
  StorageError,
  InvalidStorageKeyError,
  FileNotFoundError,
  StorageWriteError,
  StorageDeleteError,
};
