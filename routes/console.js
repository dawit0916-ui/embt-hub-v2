const express = require('express');
const router = express.Router();
const util = require('util');

const validateAdmin = require('../middleware/validateAdmin');
const { logAdminAction } = require('../utils/logAdminAction');

const sseClients = [];

// Patch server-side console once at startup to broadcast to connected panels
(function patchServerConsole() {
    ['log', 'warn', 'error'].forEach(level => {
        const orig = console[level].bind(console);
        console[level] = (...args) => {
            orig(...args);
            const line = args.map(a => typeof a === 'object' ? util.inspect(a) : String(a)).join(' ');
            const payload = JSON.stringify({ level, message: line, time: new Date().toISOString() });
            sseClients.forEach(client => {
                try { client.write(`data: ${payload}\n\n`); } catch (e) {}
            });
        };
    });
})();


router.get('/api/admin/console/stream', validateAdmin, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    sseClients.push(res);
    req.on('close', () => {
        const idx = sseClients.indexOf(res);
        if (idx !== -1) sseClients.splice(idx, 1);
    });
});

router.post('/api/admin/console/eval', validateAdmin, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'No code provided' });

  const logs = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  const capture = (tag) => (...args) => {
    logs.push(`[${tag}] ` + args.map(a => typeof a === 'object' ? util.inspect(a) : String(a)).join(' '));
  };

  console.log = capture('log');
  console.error = capture('error');
  console.warn = capture('warn');

  let result, error;
  try {
    const fn = new Function('require', 'module', 'exports', `
      return (async () => { ${code} })();
    `);
    result = await fn(require, module, exports);
  } catch (err) {
    error = err.stack || err.message;
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  }

  await logAdminAction(req.adminUser, 'console_eval', `Code: ${code.substring(0, 50)}...`);

  res.json({
    result: result !== undefined ? util.inspect(result) : undefined,
    logs,
    error
  });
});

module.exports = router;
