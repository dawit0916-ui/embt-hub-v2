// Usage: node scripts/hash-files.js base.apk split_config.arm64_v8a.apk ...
// Prints sha256 and size for each file, ready to paste into POST /admin/versions.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

if (process.argv.length < 3) {
  console.error('Usage: node scripts/hash-files.js <file> [file...]');
  process.exit(1);
}
const out = [];
for (const f of process.argv.slice(2)) {
  const h = crypto.createHash('sha256');
  await new Promise((ok, fail) =>
    fs.createReadStream(f).on('data', (d) => h.update(d)).on('end', ok).on('error', fail)
  );
  out.push({ file: path.basename(f), sha256: h.digest('hex'), size: fs.statSync(f).size });
}
console.log(JSON.stringify(out, null, 2));
