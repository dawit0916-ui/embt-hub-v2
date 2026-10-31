// Filled once by configure(). All store settings use the STORE_ prefix so they never
// clash with the bot's own variables. Read at request time, never at import time.
import crypto from 'node:crypto';

export const cfg = {};

const need = (env, k) => {
  const v = env[k];
  if (!v) throw new Error(`Missing required environment variable ${k}`);
  return v;
};
const int = (env, k, d) => {
  const n = Number(env[k] ?? d);
  if (!Number.isFinite(n)) throw new Error(`${k} must be a number`);
  return n;
};

// Reads the Ed25519 private key however it was pasted: PEM with real newlines, PEM with
// literal \n, PEM with spaces instead of newlines, or base64 of the PKCS8 bytes.
export function parsePrivateKey(raw) {
  if (!raw) return null;
  try {
    let v = String(raw).trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');
    if (v.includes('BEGIN')) {
      const m = v.match(/-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/);
      if (!m) throw new Error('expected a PKCS8 "BEGIN PRIVATE KEY" block');
      const body = m[1].replace(/\s+/g, '').match(/.{1,64}/g).join('\n');
      return crypto.createPrivateKey(`-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`);
    }
    return crypto.createPrivateKey({ key: Buffer.from(v.replace(/\s+/g, ''), 'base64'), format: 'der', type: 'pkcs8' });
  } catch (e) {
    console.error('[store] STORE_CONFIG_SIGNING_PRIVATE_KEY is not a valid Ed25519 private key:', e.message);
    return null;
  }
}

export function configure(env = process.env) {
  Object.assign(cfg, {
    jwtSecret: need(env, 'STORE_JWT_SECRET'),
    hmacSecret: need(env, 'STORE_HMAC_SECRET'),
    adminToken: need(env, 'STORE_ADMIN_TOKEN'),
    github: {
      token: env.STORE_GH_TOKEN || '',
      owner: env.STORE_GH_OWNER || '',
      repo: env.STORE_GH_REPO || '',
    },
    pins: (env.STORE_CERT_PINS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    configPrivateKey: parsePrivateKey(env.STORE_CONFIG_SIGNING_PRIVATE_KEY),
    maxDevices: int(env, 'STORE_MAX_DEVICES', 2),
    maxRefunds30d: int(env, 'STORE_MAX_REFUNDS_PER_30_DAYS', 3),
    currency: env.STORE_CURRENCY_NAME || 'DASH',
  });
  return cfg;
}
