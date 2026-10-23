const axios = require('axios');
const { VPN_BLOCK_THRESHOLD, VPN_REVIEW_THRESHOLD } = require('../config/constants');

const ipCache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;

const EMPTY = { isVpn: false, isProxy: false, isTor: false, fraudScore: 0, country: null, region: null, city: null };

function cleanIp(raw) {
  return String(raw || '').replace(/^::ffff:/, '');
}
// Behind Cloudflare, req.ip is a Cloudflare edge address. The real visitor is in CF-Connecting-IP.
function getClientIp(req) {
  return cleanIp(req.headers['cf-connecting-ip'] || req.ip || req.socket.remoteAddress);
}
// Primary lookup: VPN / proxy / fraud score + country
async function lookupIpqs(ip) {
  if (!process.env.IPQS_API_KEY) {
    console.error('checkVpn: IPQS_API_KEY is not set');
    return null;
  }
  try {
    const { data } = await axios.get(
      `https://ipqualityscore.com/api/json/ip/${process.env.IPQS_API_KEY}/${ip}`,
      { params: { strictness: 1, allow_public_access_points: true }, timeout: 4000 }
    );
    // IPQS answers HTTP 200 even for a bad key or exceeded quota: success=false
    if (!data || data.success === false) {
      console.error('checkVpn: IPQS rejected the request:', data && data.message);
      return null;
    }
    return {
      isVpn: !!data.vpn,
      isProxy: !!data.proxy,
      isTor: !!data.tor,
      fraudScore: data.fraud_score ?? 0,
      country: data.country_code || null,
      region: data.region || null,
      city: data.city || null,
    };
  } catch (err) {
    console.error('checkVpn: IPQS lookup failed', err.message);
    return null;
  }
}

// Fallback: country only, free, no key
async function lookupCountryFallback(ip) {
  try {
    const { data } = await axios.get(`https://ipwho.is/${ip}`, { timeout: 4000 });
    if (data && data.success && data.country_code) return data.country_code;
    console.error('checkVpn: fallback geo lookup returned no country:', data && data.message);
  } catch (err) {
    console.error('checkVpn: fallback geo lookup failed', err.message);
  }
  return null;
}

async function getIpReputation(ip) {
  const cached = ipCache.get(ip);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  let result = await lookupIpqs(ip);
  let source = 'ipqs';

  if (!result || !result.country) {
    const country = await lookupCountryFallback(ip);
    source = result ? 'ipqs+fallback' : 'fallback';
    result = { ...(result || EMPTY), country };
  }

  console.log('checkVpn lookup', { ip, country: result.country, source });
  if (result.country) ipCache.set(ip, { ts: Date.now(), data: result }); // never cache a failed lookup
  return result;
}

async function checkVpn(req, res, next) {
    const ip = getClientIp(req);
  const rep = await getIpReputation(ip);

  if (!rep.country) {
    console.warn('checkVpn: no country for request', { ip, xff: req.headers['x-forwarded-for'] });
  }

  let action = 'allow';
  if (rep.fraudScore >= VPN_BLOCK_THRESHOLD) action = 'block';
  else if (rep.fraudScore >= VPN_REVIEW_THRESHOLD || rep.isVpn || rep.isProxy || rep.isTor) action = 'review';

  req.vpnCheck = { ...rep, ip, action };
  next();
}

module.exports = checkVpn;
