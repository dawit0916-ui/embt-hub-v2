const sharp = require('sharp');

// keep sharp light on the 512MB free instance
sharp.cache(false);
sharp.concurrency(1);

const OCR_URL = 'https://api.ocr.space/parse/image';
const OCR_TIMEOUT_MS = 15000;
const MAX_BYTES = 900 * 1024; // OCR.space free API limit is 1MB

function parseStatsForNerds(text) {
  const videoIdMatch = text.match(/V[il1|]deo\s*[Il1|]D\s*[:;.,]?\s*([a-zA-Z0-9_-]{6,})/i);
  const timeMatch = text.match(/(\d{1,2}:\d{2})\s*\/\s*(\d{1,2}:\d{2})/);

  function toSeconds(mmss) {
    const [m, s] = mmss.split(':').map(Number);
    return m * 60 + s;
  }

  return {
    videoId: videoIdMatch ? videoIdMatch[1] : null,
    elapsedSeconds: timeMatch ? toSeconds(timeMatch[1]) : null,
    totalSeconds: timeMatch ? toSeconds(timeMatch[2]) : null,
  };
}

// shrink to a small JPEG, never upscale, stay under the 1MB limit
async function prepare(buffer) {
  let quality = 75;
  let out;
  do {
    out = await sharp(buffer)
      .rotate()
      .resize({ width: 1000, withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer();
    quality -= 15;
  } while (out.length > MAX_BYTES && quality >= 30);
  return out;
}

async function callOcrSpace(jpeg) {
  const key = process.env.OCR_SPACE_KEY;
  if (!key) throw new Error('OCR_SPACE_KEY is not set');

  const form = new FormData();
  form.append('apikey', key);
  form.append('language', 'eng');
  form.append('OCREngine', '2');
  form.append('file', new Blob([jpeg], { type: 'image/jpeg' }), 'proof.jpg');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OCR_TIMEOUT_MS);
  try {
    const r = await fetch(OCR_URL, { method: 'POST', body: form, signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (j.IsErroredOnProcessing) {
      throw new Error('OCR.space: ' + String(j.ErrorMessage || 'processing error'));
    }
    return (j.ParsedResults || []).map((p) => p.ParsedText || '').join('\n');
  } finally {
    clearTimeout(timer);
  }
}

async function ocrStatsForNerds(req, res, next) {
  if (!req.file) return res.status(400).json({ error: 'No screenshot uploaded' });
  const t0 = Date.now();
  try {
    const jpeg = await prepare(req.file.buffer);
    const t1 = Date.now();
    const text = await callOcrSpace(jpeg);
    req.ocrResult = { ...parseStatsForNerds(text), rawText: text };
    console.log('[ocr timing]', {
      prepMs: t1 - t0,
      apiMs: Date.now() - t1,
      kb: Math.round(jpeg.length / 1024),
      rssMB: Math.round(process.memoryUsage().rss / 1048576),
    });
  } catch (err) {
    // error => the route sends this submission to manual review, not rejection
    console.error('OCR failed', err.message);
    req.ocrResult = { videoId: null, elapsedSeconds: null, totalSeconds: null, rawText: '', error: true };
  }
  next();
}

module.exports = ocrStatsForNerds;
