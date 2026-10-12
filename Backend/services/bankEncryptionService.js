const crypto = require('crypto');

/**
 * Bank Details Encryption & Masking Service
 * Implements AES-256-GCM encryption at rest for sensitive bank account numbers.
 * The master encryption key is loaded from the environment (BANK_ENCRYPTION_KEY or fallback).
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recommended for GCM
const AUTH_TAG_LENGTH = 16;

/**
 * Derives a deterministic 32-byte (256-bit) buffer key from the environment secret.
 * @returns {Buffer} 32-byte key
 */
function getEncryptionKey() {
  const secret = process.env.BANK_ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    'gaintpro-hrm-bank-encryption-master-key-32b';
  return crypto.createHash('sha256').update(String(secret)).digest();
}

/**
 * Encrypts a plaintext account number using AES-256-GCM.
 * @param {string} plaintext - The plain account number
 * @returns {string} Serialized encrypted string: iv:authTag:ciphertext
 */
function encryptAccountNumber(plaintext) {
  if (!plaintext || typeof plaintext !== 'string') {
    throw new Error('Invalid account number provided for encryption.');
  }

  const cleanText = plaintext.trim();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);

  let encrypted = cipher.update(cleanText, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts an encrypted account number using AES-256-GCM.
 * @param {string} encryptedPayload - Serialized string iv:authTag:ciphertext
 * @returns {string} Plaintext account number
 */
function decryptAccountNumber(encryptedPayload) {
  if (!encryptedPayload || typeof encryptedPayload !== 'string') {
    throw new Error('Invalid encrypted payload provided for decryption.');
  }

  const parts = encryptedPayload.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted payload structure.');
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Masks an account number showing only the last 4 digits.
 * Example: "123456789012" -> "••••••••9012"
 * @param {string} accountNumberOrLast4 - Account number or 4-digit suffix
 * @returns {string} Masked account string
 */
function maskAccountNumber(accountNumberOrLast4) {
  if (!accountNumberOrLast4) return '••••••••';
  const str = String(accountNumberOrLast4).trim();
  const last4 = str.length > 4 ? str.slice(-4) : str;
  return `••••••••${last4}`;
}

/**
 * Validates Indian IFSC Code format:
 * Exactly 11 characters: 4 uppercase letters, 5th character '0', followed by 6 alphanumeric characters.
 * @param {string} ifsc
 * @returns {boolean}
 */
function isValidIFSC(ifsc) {
  if (!ifsc || typeof ifsc !== 'string') return false;
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.trim().toUpperCase());
}

/**
 * Validates Bank Account Number format (9 to 18 digits numeric)
 * @param {string} accNum
 * @returns {boolean}
 */
function isValidAccountNumber(accNum) {
  if (!accNum || typeof accNum !== 'string') return false;
  return /^\d{9,18}$/.test(accNum.trim());
}

module.exports = {
  encryptAccountNumber,
  decryptAccountNumber,
  maskAccountNumber,
  isValidIFSC,
  isValidAccountNumber,
};
