import crypto from 'node:crypto';

export class AppError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const hmac = (secret, value) =>
  crypto.createHmac('sha256', secret).update(String(value)).digest('hex');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// No 0/O/1/I/L so codes are easy to read and type.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Long code for linking the app to the bot account (about 40 bits). */
export function linkCode(len = 8) {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return s;
}

/** Short numeric code for purchase confirmation (tied to one purchase, attempts are limited). */
export function numericCode(len = 6) {
  return String(crypto.randomInt(0, 10 ** len)).padStart(len, '0');
}

export const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

export function needPackage(v) {
  if (typeof v !== 'string' || v.length > 200 || !PACKAGE_RE.test(v)) {
    throw new AppError(400, 'bad_package', 'Invalid package id');
  }
  return v;
}

export function needInt(v, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new AppError(400, 'bad_value', `Invalid ${name}`);
  }
  return n;
}

export function needString(v, name, max = 500) {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) {
    throw new AppError(400, 'bad_value', `Invalid ${name}`);
  }
  return v;
}

/**
 * Signs a payload with an Ed25519 private key. The client verifies the exact bytes it
 * received (payload is base64 of the JSON), so there is no JSON canonicalization problem.
 */
export function signPayload(privateKeyPem, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  const sig = crypto.sign(null, body, privateKeyPem);
  return { payload: body.toString('base64'), sig: sig.toString('base64') };
}

export function verifyPayload(publicKeyPem, { payload, sig }) {
  return crypto.verify(
    null,
    Buffer.from(payload, 'base64'),
    publicKeyPem,
    Buffer.from(sig, 'base64')
  );
}

export const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
