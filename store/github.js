import { cfg } from './config.js';
import { AppError } from './util.js';

/**
 * Asks GitHub for the short-lived download URL of a private release asset.
 * The token stays on the server; the app only ever receives the resulting URL.
 */
export async function assetUrl(assetId) {
  const { token, owner, repo } = cfg.github;
  if (!token || !owner || !repo) throw new AppError(503, 'storage_not_configured');
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/assets/${assetId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/octet-stream',
      'User-Agent': 'apk-store-server',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(10000),
  });
  const loc = r.headers.get('location');
  if (r.status === 302 && loc) return loc;
  throw new AppError(502, 'storage_error', `Storage returned ${r.status}`);
}
