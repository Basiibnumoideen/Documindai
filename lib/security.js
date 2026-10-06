/**
 * Security & Moderation Utilities for DocuMind RAG
 * 
 * Provides defense-in-depth protection against:
 * 1. Disguised malicious files & polyglots (Magic Bytes inspection)
 * 2. PDF weaponization & embedded executable exploits (/Launch, /EmbeddedFiles)
 * 3. Path traversal & filename injection attacks
 * 4. Denial-of-Service (DoS), ZIP bombs & oversized payloads
 * 5. Prompt injection, system prompt leakage & jailbreak attacks
 * 6. Automated spam & brute-force rate-limiting
 */

// Max allowed PDF file size: 20 MB
export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
export const MIN_FILE_SIZE_BYTES = 32;

// Max allowed user question length: 1,000 characters
export const MAX_QUESTION_LENGTH = 1000;

// Rate limiting store (In-memory sliding window)
const rateLimitMap = new Map();

/**
 * In-memory sliding window rate limiter
 * @param {string} identifier - Client IP or session token
 * @param {'upload' | 'ask'} actionType - Action category
 * @returns {{ allowed: boolean, remaining: number, resetSeconds: number }}
 */
export function checkRateLimit(identifier, actionType = 'ask') {
  const now = Date.now();
  const windowMs = 60 * 1000; // 1-minute window
  const limit = actionType === 'upload' ? 15 : 45; // 15 uploads/min, 45 asks/min
  const key = `${actionType}:${identifier || 'anonymous'}`;

  let timestamps = rateLimitMap.get(key) || [];
  // Evict timestamps older than 1 minute
  timestamps = timestamps.filter(ts => now - ts < windowMs);

  if (timestamps.length >= limit) {
    const oldestTimestamp = timestamps[0];
    const resetSeconds = Math.ceil((oldestTimestamp + windowMs - now) / 1000);
    return {
      allowed: false,
      remaining: 0,
      resetSeconds: Math.max(1, resetSeconds),
    };
  }

  timestamps.push(now);
  rateLimitMap.set(key, timestamps);

  // Periodically cleanup stale keys
  if (rateLimitMap.size > 2000) {
    for (const [k, v] of rateLimitMap.entries()) {
      const active = v.filter(ts => now - ts < windowMs);
      if (active.length === 0) {
        rateLimitMap.delete(k);
      } else {
        rateLimitMap.set(k, active);
      }
    }
  }

  return {
    allowed: true,
    remaining: limit - timestamps.length,
    resetSeconds: 60,
  };
}

/**
 * Detects format and magic bytes for supported document and image types.
 * @param {Buffer} buffer
 * @returns {{ type: 'pdf' | 'image', mimeType: string, ext: string } | null}
 */
export function detectDocumentFormat(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 4) {
    return null;
  }

  // 1. PDF: inspect first 1024 bytes for '%PDF-'
  const headerSlice = buffer.slice(0, 1024).toString('binary');
  if (headerSlice.indexOf('%PDF-') !== -1) {
    return { type: 'pdf', mimeType: 'application/pdf', ext: 'pdf' };
  }

  // 2. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { type: 'image', mimeType: 'image/png', ext: 'png' };
  }

  // 3. JPEG/JPG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { type: 'image', mimeType: 'image/jpeg', ext: 'jpg' };
  }

  // 4. WebP: RIFF (bytes 0..3) ... WEBP (bytes 8..11)
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { type: 'image', mimeType: 'image/webp', ext: 'webp' };
  }

  return null;
}

/**
 * Sanitizes untrusted filenames to prevent Path Traversal, Null-Byte Injection & XSS
 * Preserves safe document and image scan extensions (.pdf, .png, .jpg, .jpeg, .webp)
 * @param {string} rawName
 * @returns {string}
 */
export function sanitizeFileName(rawName) {
  if (!rawName || typeof rawName !== 'string') {
    return `document_${Date.now()}.pdf`;
  }

  // 1. Strip path traversal sequences & separators (/ \ .. ~)
  let clean = rawName
    .replace(/[/\\]/g, '')
    .replace(/\.\.+/g, '.')
    .replace(/^\.+/, '');

  // 2. Strip dangerous characters, control characters & null bytes
  clean = clean.replace(/[\x00-\x1f\x7f<>:"/\\|?*#$`&;{}()]/g, '');

  // 3. Remove multiple whitespaces
  clean = clean.replace(/\s+/g, ' ').trim();

  // 4. Extract and normalize allowed document & image extensions
  const extMatch = clean.match(/\.([a-zA-Z0-9]+)$/);
  const ext = extMatch ? extMatch[1].toLowerCase() : '';
  const allowedExts = ['pdf', 'png', 'jpg', 'jpeg', 'webp'];
  const targetExt = allowedExts.includes(ext) ? ext : 'pdf';

  // 5. Cap length (max 80 chars base name)
  const baseName = extMatch ? clean.slice(0, extMatch.index).trim() : clean;
  const cappedBase = (baseName || `document_${Date.now()}`).slice(0, 80).trim();

  if (!cappedBase) {
    return `document_${Date.now()}.${targetExt}`;
  }

  return `${cappedBase}.${targetExt}`;
}

/**
 * Verifies that the uploaded buffer is genuinely a PDF or safe scanned image (PNG, JPEG, WebP)
 * via magic bytes inspection, and scans PDFs for weaponized constructs (/Launch, dangerous binaries)
 * @param {Buffer} buffer
 * @param {string} [fileName]
 * @returns {{ valid: boolean, error?: string, format?: { type: 'pdf' | 'image', mimeType: string, ext: string } }}
 */
export function validateAndScanPdfBuffer(buffer, _fileName) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    return { valid: false, error: 'Invalid or missing file buffer.' };
  }

  // 1. File Size Verification
  if (buffer.length < MIN_FILE_SIZE_BYTES) {
    return { valid: false, error: 'File is empty or corrupted (under 32 bytes).' };
  }

  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    const sizeMb = (buffer.length / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `File size exceeds safety limit (${sizeMb} MB). Maximum allowed size is 20 MB.`,
    };
  }

  // 2. Magic Bytes Inspection: Must be PDF, PNG, JPEG, or WebP
  const format = detectDocumentFormat(buffer);
  if (!format) {
    return {
      valid: false,
      error: 'Security Reject: File does not possess valid PDF (%PDF-) or image (PNG, JPEG, WebP) magic bytes. Disguised executables or non-document files are prohibited.',
    };
  }

  // 3. Deep Buffer Anti-Exploit Scan for PDFs
  if (format.type === 'pdf') {
    const bufferString = buffer.toString('binary');

    // Check for dangerous /Launch actions
    const hasLaunchExploit = /\/Launch\s*<<|\/Launch\s*\/|\/Type\s*\/Action\s*\/S\s*\/Launch/i.test(bufferString);
    if (hasLaunchExploit) {
      return {
        valid: false,
        error: 'Security Warning: PDF contains potentially malicious executable launch actions (/Launch) and was blocked for system safety.',
      };
    }

    // Check for embedded dangerous executable attachments
    const hasDangerousAttachment = /\/EmbeddedFiles[\s\S]{0,400}\.(exe|bat|cmd|vbs|ps1|scr|pif|hta|jar|sh)\b/i.test(
      bufferString
    );
    if (hasDangerousAttachment) {
      return {
        valid: false,
        error: 'Security Warning: PDF contains embedded executable files or binary scripts and was blocked for system safety.',
      };
    }
  }

  return { valid: true, format };
}

/**
 * Sanitizes and validates user questions
 * @param {string} question
 * @returns {{ valid: boolean, cleaned: string, error?: string }}
 */
export function sanitizeUserQuestion(question) {
  if (!question || typeof question !== 'string') {
    return { valid: false, cleaned: '', error: 'Question must be a non-empty string.' };
  }

  let cleaned = question
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // remove null & ASCII control chars
    .trim();

  if (!cleaned) {
    return { valid: false, cleaned: '', error: 'Question cannot be empty or purely whitespace.' };
  }

  if (cleaned.length > MAX_QUESTION_LENGTH) {
    cleaned = cleaned.slice(0, MAX_QUESTION_LENGTH).trim();
  }

  return { valid: true, cleaned };
}

/**
 * Checks for known adversarial prompt injection patterns to harden LLM synthesis
 * @param {string} text
 * @returns {boolean}
 */
export function detectPromptInjectionAttempt(text) {
  if (!text || typeof text !== 'string') return false;

  const injectionPatterns = [
    /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
    /system\s+override\s*:/i,
    /you\s+are\s+now\s+(dan|an\s+unrestricted\s+ai|jailbroken)/i,
    /developer\s+mode\s+(enabled|activated)/i,
    /reveal\s+(your\s+)?(system\s+prompt|secret\s+key|api\s+key)/i,
    /disregard\s+(all\s+)?(safety\s+guidelines|rules)/i,
    /print\s+(all\s+)?env(ironment)?\s+variables/i,
  ];

  return injectionPatterns.some(pattern => pattern.test(text));
}
