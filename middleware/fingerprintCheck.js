const crypto = require('crypto');
const sharp = require('sharp');
const { bmvbhash } = require('blockhash-core');
const { ScreenshotFingerprint } = require('../models');

const HAMMING_THRESHOLD = Number(process.env.PHASH_THRESHOLD) || 6;

function hammingDistance(hashA, hashB) {
  let dist = 0;
  for (let i = 0; i < hashA.length; i++) {
    if (hashA[i] !== hashB[i]) dist++;
  }
  return dist;
}

async function computeHashes(buffer) {
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const { data, info } = await sharp(buffer)
    .raw()
    .ensureAlpha()
    .resize(256, 256, { fit: 'fill' })
    .toBuffer({ resolveWithObject: true });
  const pHash = bmvbhash({ data, width: info.width, height: info.height }, 16);
  return { sha256, pHash };
}

// Attaches req.fingerprintCheck = { sha256, pHash, isDuplicate, matchType?, error? }
async function fingerprintCheck(req, res, next) {
  if (!req.file) return res.status(400).json({ error: 'No screenshot uploaded' });

  try {
    const { sha256, pHash } = await computeHashes(req.file.buffer);

    // 1. exact match — ANY user, including the same one
    const exactMatch = await ScreenshotFingerprint.findOne({ sha256 });
    if (exactMatch) {
      req.fingerprintCheck = { sha256, pHash, isDuplicate: true, matchType: 'exact' };
      return next();
    }

    // 2. perceptual match — ANY user
    const recent = await ScreenshotFingerprint.find({})
      .sort({ submittedAt: -1 })
      .limit(5000)
      .select('pHash');

    for (const record of recent) {
      if (record.pHash.length !== pHash.length) continue;
      const dist = hammingDistance(record.pHash, pHash);
      if (dist <= HAMMING_THRESHOLD) {
        req.fingerprintCheck = { sha256, pHash, isDuplicate: true, matchType: 'perceptual', distance: dist };
        return next();
      }
    }

    req.fingerprintCheck = { sha256, pHash, isDuplicate: false };
    next();
  } catch (err) {
    console.error('fingerprintCheck failed', err.message);
    // fail CLOSED: don't let unverifiable screenshots through
    return res.status(503).json({ error: 'Verification temporarily unavailable. Try again shortly.' });
  }
}

module.exports = fingerprintCheck;
