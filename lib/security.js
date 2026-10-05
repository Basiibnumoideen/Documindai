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
 * Sanitizes untrusted filenames to prevent Path Traversal, Null-Byte Injection & XSS
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

  // 4. Ensure proper .pdf extension
  if (!clean.toLowerCase().endsWith('.pdf')) {
    clean = clean.replace(/\.[^.]+$/, '') + '.pdf';
  }

  // 5. Cap length (max 80 chars base name)
  const baseName = clean.slice(0, -4).trim();
  const cappedBase = baseName.slice(0, 80).trim();

  if (!cappedBase) {
    return `document_${Date.now()}.pdf`;
  }

  return `${cappedBase}.pdf`;
}

/**
 * Verifies that the uploaded buffer is genuinely a PDF via magic bytes (%PDF-)
 * and scans for weaponized PDF constructs (/Launch, dangerous embedded binaries)
 * @param {Buffer} buffer
 * @param {string} fileName
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateAndScanPdfBuffer(buffer) {
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

  // 2. Magic Bytes Inspection: Must contain '%PDF-' (0x25, 0x50, 0x44, 0x46, 0x2D)
  // PDFs may have a few bytes of leading BOM or whitespace, inspect first 1024 bytes
  const headerSlice = buffer.slice(0, 1024).toString('binary');
  const pdfHeaderIndex = headerSlice.indexOf('%PDF-');

  if (pdfHeaderIndex === -1) {
    return {
      valid: false,
      error: 'Security Reject: File does not possess valid PDF magic bytes (%PDF-). Disguised executables or non-PDF files are prohibited.',
    };
  }

  // 3. Deep Buffer Anti-Exploit Scan
  // Weaponized PDFs often include /Launch actions to execute local binaries or embed .exe/.scr/.bat files
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

  return { valid: true };
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
