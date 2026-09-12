const axios = require('axios');
const { VPN_BLOCK_THRESHOLD, VPN_REVIEW_THRESHOLD } = require('../config/constants');

const ipCache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;

async function getIpReputation(ip) {
  const cached = ipCache.get(ip);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  try {
    const { data } = await axios.get(
      `https://ipqualityscore.com/api/json/ip/${process.env.IPQS_API_KEY}/${ip}`,
      { params: { strictness: 1, allow_public_access_points: true }, timeout: 4000 }
    );

    const result = {
      isVpn: !!data.vpn,
      isProxy: !!data.proxy,
      isTor: !!data.tor,
      fraudScore: data.fraud_score ?? 0,
      country: data.country_code || null,
      region: data.region || null,
      city: data.city || null,
    };

    ipCache.set(ip, { ts: Date.now(), data: result });
    return result;
  } catch (err) {
    console.error('checkVpn: IPQS lookup failed', err.message);
    return { isVpn: false, isProxy: false, isTor: false, fraudScore: 0, country: null, region: null, city: null };
  }
}

async function checkVpn(req, res, next) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  const rep = await getIpReputation(ip);

  let action = 'allow';
  if (rep.fraudScore >= VPN_BLOCK_THRESHOLD) action = 'block';
  else if (rep.fraudScore >= VPN_REVIEW_THRESHOLD || rep.isVpn || rep.isProxy || rep.isTor) action = 'review';

  req.vpnCheck = { ...rep, ip, action };
  next();
}

module.exports = checkVpn;
