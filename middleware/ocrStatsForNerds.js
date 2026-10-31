const sharp = require('sharp');

// keep sharp light on the 512MB free instance
sharp.cache(false);
sharp.concurrency(1);

const OCR_URL = 'https://api.ocr.space/parse/image';
const OCR_TIMEOUT_MS = 15000;
const TOTAL_BUDGET_MS = 25000; // do not start a new pass after this
const MAX_BYTES = 900 * 1024;  // OCR.space free API limit is 1MB

function toSeconds(t) {
  return t.split(':').map(Number).reduce((acc, n) => acc * 60 + n, 0); // m:ss or h:mm:ss
}

function parseStatsForNerds(text) {
  // OCR often puts spaces inside the id ("hj EY3BhB1 rE"), so take the whole line and strip them
  const idMatch = text.match(/V[il1|]deo\s*[Il1|]D\s*[:;.,]?\s*([^\[\]\n]{6,40})/i);
  const id = idMatch ? idMatch[1].replace(/[^A-Za-z0-9_-]/g, '') : '';
  const timeMatch = text.match(/(\d{1,2}(?::\d{2}){1,2})\s*[\/|]\s*(\d{1,2}(?::\d{2}){1,2})/);
  return {
    videoId: id.length >= 9 ? id : null, // real ids are 11 chars; shorter means characters were lost
    elapsedSeconds: timeMatch ? toSeconds(timeMatch[1]) : null,
    totalSeconds: timeMatch ? toSeconds(timeMatch[2]) : null,
  };
}

// crop: video area only, 2x, gray + contrast. thresh: same but pure black text on white.
// full: the whole screenshot, only used when the crop could not read it.
async function buildImage(buffer, mode, w, h) {
  let quality = 80;
  let out;
  do {
    let p = sharp(buffer);
    if (mode === 'full') {
      p = p.rotate().resize({ width: 1000, withoutEnlargement: true });
    } else {
      if (h > w) p = p.extract({ left: 0, top: 0, width: w, height: Math.min(h, Math.round(w * 0.72)) });
      p = p.resize({ width: Math.min(w * 2, 1500) }).grayscale();
      p = mode === 'thresh' ? p.threshold(200).negate() : p.normalise();
    }
    out = await p.jpeg({ quality }).toBuffer();
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
  const found = { videoId: null, elapsedSeconds: null, totalSeconds: null };
  const texts = [];
  const passLog = [];
  let anyError = false;

  try {
    const { width: w, height: h } = await sharp(req.file.buffer).metadata();
    const modes = h > w ? ['crop', 'thresh', 'full'] : ['crop', 'thresh'];

    for (const mode of modes) {
      if (Date.now() - t0 > TOTAL_BUDGET_MS) break;
      const t1 = Date.now();
      try {
        const jpeg = await buildImage(req.file.buffer, mode, w, h);
        const text = await callOcrSpace(jpeg);
        texts.push(text);
        const p = parseStatsForNerds(text);
        // keep the first good value of each field across passes
        found.videoId = found.videoId || p.videoId;
        if (found.elapsedSeconds == null && p.elapsedSeconds != null) {
          found.elapsedSeconds = p.elapsedSeconds;
          found.totalSeconds = p.totalSeconds;
        }
        passLog.push({ mode, ms: Date.now() - t1, kb: Math.round(jpeg.length / 1024) });
      } catch (err) {
        anyError = true;
        console.error('OCR pass failed', mode, err.message);
        passLog.push({ mode, ms: Date.now() - t1, failed: true });
      }
      if (found.videoId && found.elapsedSeconds != null) break; // got everything
    }
  } catch (err) {
    anyError = true;
    console.error('OCR failed', err.message);
  }

  const complete = found.videoId && found.elapsedSeconds != null;
  req.ocrResult = { ...found, rawText: texts.join('\n---\n') };
  // if our own failure (timeout, API down) could be why it is incomplete, send to manual review
  if (!complete && anyError) req.ocrResult.error = true;

  console.log('[ocr timing]', {
    passes: passLog,
    totalMs: Date.now() - t0,
    rssMB: Math.round(process.memoryUsage().rss / 1048576),
  });
  next();
}

module.exports = ocrStatsForNerds;
module.exports.parseStatsForNerds = parseStatsForNerds;
