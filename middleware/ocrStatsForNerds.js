const { createWorker } = require('tesseract.js');

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

// One shared worker, jobs run one at a time
let workerPromise = null;
let queue = Promise.resolve();

function getWorker() {
  if (!workerPromise) workerPromise = createWorker('eng');
  return workerPromise;
}

function recognize(buffer) {
  const run = queue.then(async () => {
    try {
      const worker = await getWorker();
      const { data } = await worker.recognize(buffer);
      return data.text;
    } catch (err) {
      try { (await workerPromise).terminate(); } catch (_) {}
      workerPromise = null; // recreate on next job
      throw err;
    }
  });
  queue = run.catch(() => {});
  return run;
}

async function ocrStatsForNerds(req, res, next) {
  if (!req.file) return res.status(400).json({ error: 'No screenshot uploaded' });
  try {
    const text = await recognize(req.file.buffer);
    req.ocrResult = { ...parseStatsForNerds(text), rawText: text };
  } catch (err) {
    console.error('OCR failed', err.message);
    req.ocrResult = { videoId: null, elapsedSeconds: null, totalSeconds: null, rawText: '', error: true };
  }
  next();
}

module.exports = ocrStatsForNerds;
