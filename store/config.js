// Filled once by configure(). All store settings use the STORE_ prefix so they never
// clash with the bot's own variables. Read at request time, never at import time.
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
    configPrivateKey: (env.STORE_CONFIG_SIGNING_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    maxDevices: int(env, 'STORE_MAX_DEVICES', 2),
    maxRefunds30d: int(env, 'STORE_MAX_REFUNDS_PER_30_DAYS', 3),
    currency: env.STORE_CURRENCY_NAME || 'DASH',
  });
  return cfg;
}
