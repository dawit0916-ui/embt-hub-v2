const crypto = require('crypto');
const sharp = require('sharp');
const { bmvbhash } = require('blockhash-core');
const { ScreenshotFingerprint } = require('../models');

function hammingDistance(hashA, hashB) {
  let dist = 0;
  for (let i = 0; i < hashA.length; i++) {
    if (hashA[i] !== hashB[i]) dist++;
  }
  return dist;
}

async function computeHashes(buffer) {
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  // blockhash-core needs raw RGBA pixel data, not the compressed file
  const { data, info } = await sharp(buffer)
    .raw()
    .ensureAlpha()
    .resize(256, 256, { fit: 'fill' })
    .toBuffer({ resolveWithObject: true });

  const imageData = { data, width: info.width, height: info.height };
  const pHash = bmvbhash(imageData, 16); // 16-bit block hash, hex-ish binary string

  return { sha256, pHash };
}

// Attaches req.fingerprintCheck = { sha256, pHash, isDuplicate, duplicateOf }
async function fingerprintCheck(req, res, next) {
  if (!req.file) {
    return res.status(400).json({ error: 'No screenshot uploaded' });
  }

  try {
    const { sha256, pHash } = await computeHashes(req.file.buffer);

    // 1. exact match check (fast)
    const exactMatch = await ScreenshotFingerprint.findOne({ sha256 });
    if (exactMatch && exactMatch.userId !== req.tgUser.id) {
      req.fingerprintCheck = { sha256, pHash, isDuplicate: true, duplicateOf: exactMatch.userId, matchType: 'exact' };
      return next();
    }

    // 2. perceptual match check — scan recent hashes, compare Hamming distance
    const HAMMING_THRESHOLD = 6; // tune based on false-positive rate once live
    const recentHashes = await ScreenshotFingerprint.find({})
      .sort({ submittedAt: -1 })
      .limit(5000) // cap the scan — swap for a proper vector index if this becomes a bottleneck
      .select('pHash userId');

    for (const record of recentHashes) {
      if (record.pHash.length !== pHash.length) continue;
      const dist = hammingDistance(record.pHash, pHash);
      if (dist <= HAMMING_THRESHOLD && record.userId !== req.tgUser.id) {
        req.fingerprintCheck = { sha256, pHash, isDuplicate: true, duplicateOf: record.userId, matchType: 'perceptual', distance: dist };
        return next();
      }
    }

    req.fingerprintCheck = { sha256, pHash, isDuplicate: false };
    next();
  } catch (err) {
    console.error('fingerprintCheck failed', err.message);
    // fail-open on infra errors so a hashing bug doesn't block all submissions
    req.fingerprintCheck = { sha256: null, pHash: null, isDuplicate: false, error: true };
    next();
  }
}

module.exports = fingerprintCheck;
