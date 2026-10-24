const axios = require('axios');

const ipCache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 5000;

function cleanIp(raw) {
  return String(raw || '').replace(/^::ffff:/, '');
}

// Behind Cloudflare, req.ip is a Cloudflare edge address. The real visitor is in CF-Connecting-IP.
function getClientIp(req) {
  return cleanIp(req.headers['cf-connecting-ip'] || req.ip || req.socket.remoteAddress);
}

// Provider 1: free, no key, HTTPS
async function lookupIpwho(ip) {
  try {
    const { data } = await axios.get(`https://ipwho.is/${ip}`, { timeout: 4000 });
    if (data && data.success && data.country_code) return String(data.country_code).toUpperCase();
    console.error('checkVpn: ipwho.is returned no country:', data && data.message);
  } catch (err) {
    console.error('checkVpn: ipwho.is failed', err.message);
  }
  return null;
}

// Provider 2 (backup): free, plain-text 2-letter country code
async function lookupIpapi(ip) {
  try {
    const { data } = await axios.get(`https://ipapi.co/${ip}/country/`, { timeout: 4000, responseType: 'text' });
    const code = String(data || '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(code)) return code;
    console.error('checkVpn: ipapi.co returned no country');
  } catch (err) {
    console.error('checkVpn: ipapi.co failed', err.message);
  }
  return null;
}

async function getCountry(ip) {
  const cached = ipCache.get(ip);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.country;

  let source = 'ipwho.is';
  let country = await lookupIpwho(ip);
  if (!country) {
    source = 'ipapi.co';
    country = await lookupIpapi(ip);
  }

  console.log('checkVpn lookup', { ip, country, source: country ? source : 'none' });
  if (country) {
    if (ipCache.size >= CACHE_MAX) ipCache.clear();
    ipCache.set(ip, { ts: Date.now(), country }); // never cache a failed lookup
  }
  return country;
}

// Country check only. No VPN / proxy / fraud scoring.
// req.vpnCheck keeps its old shape so the routes that read it need no changes.
async function checkVpn(req, res, next) {
  const ip = getClientIp(req);
  const country = await getCountry(ip);

  if (!country) {
    console.warn('checkVpn: no country for request', { ip, xff: req.headers['x-forwarded-for'] });
  }

  req.vpnCheck = { ip, country, action: 'allow', fraudScore: 0, isVpn: false, isProxy: false, isTor: false };
  next();
}

module.exports = checkVpn;
