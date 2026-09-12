const { createWorker } = require('tesseract.js');

// Parses raw OCR text against the known "Stats for Nerds" layout, e.g.:
//   "Video ID: DQDHW-N317Y [vod]"
//   "11:02 / 11:48"
function parseStatsForNerds(text) {
  const videoIdMatch = text.match(/Video ID:\s*([a-zA-Z0-9_-]{6,})/i);
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

// Attaches req.ocrResult = { videoId, elapsedSeconds, totalSeconds, rawText }
async function ocrStatsForNerds(req, res, next) {
  if (!req.file) {
    return res.status(400).json({ error: 'No screenshot uploaded' });
  }

  const worker = await createWorker('eng');
  try {
    const { data } = await worker.recognize(req.file.buffer);
    const parsed = parseStatsForNerds(data.text);
    req.ocrResult = { ...parsed, rawText: data.text };
  } catch (err) {
    console.error('OCR failed', err.message);
    req.ocrResult = { videoId: null, elapsedSeconds: null, totalSeconds: null, rawText: '', error: true };
  } finally {
    await worker.terminate();
  }

  next();
}

module.exports = ocrStatsForNerds;
