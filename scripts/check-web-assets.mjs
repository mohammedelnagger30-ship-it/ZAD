// Build integrity: does the shipped web payload contain everything it references?
//
// Found on a real device: the app crashed into its error boundary with
// "Failed to fetch dynamically imported module: .../PrayerScreen-DyQt4WH1.js" (a 404), while
// the precache still held a differently-hashed PrayerScreen chunk. So check the payload that
// actually ships: every chunk referenced must exist, and every precached entry must exist.
//
//   node scripts/check-web-assets.mjs <dir containing assets/ and sw.js>
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2];
if (!root) {
  console.error('usage: check-web-assets.mjs <dir>');
  process.exit(2);
}

// Always forward slashes: the references inside a bundle use them, and Windows paths do not.
const present = new Set(
  readdirSync(join(root, 'assets'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => `assets/${f}`)
);

const missing = new Map();
const referenced = new Set();

for (const rel of present) {
  const text = readFileSync(join(root, rel), 'utf8');
  for (const m of text.matchAll(/assets\/[\w.-]+\.js/g)) {
    referenced.add(m[0]);
    if (!present.has(m[0])) {
      if (!missing.has(m[0])) missing.set(m[0], []);
      missing.get(m[0]).push(rel);
    }
  }
}

// index.html points at the entry chunks too.
let html = '';
try {
  html = readFileSync(join(root, 'index.html'), 'utf8');
} catch {
  /* the precache check still stands without it */
}
const htmlMissing = [];
for (const m of html.matchAll(/assets\/[\w.-]+\.js/g)) {
  referenced.add(m[0]);
  if (!present.has(m[0])) htmlMissing.push(m[0]);
}

// Precache manifest: workbox emits either {url:"..."} entries or a separate manifest, and the
// formatting differs between versions, so accept both spacings and fall back to scanning.
const precacheUrls = new Set();
try {
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  for (const m of sw.matchAll(/["']?url["']?\s*:\s*["']([^"']+)["']/g)) precacheUrls.add(m[1]);
  if (precacheUrls.size === 0) {
    for (const m of sw.matchAll(/assets\/[\w.-]+\.[a-z0-9]+/g)) precacheUrls.add(m[0]);
  }
} catch (error) {
  precacheUrls.add(`sw.js unreadable: ${error}`);
}

const precacheMissing = [...precacheUrls]
  .map((u) => u.split('?')[0].replace(/^\.?\//, ''))
  .filter((u) => u.startsWith('assets/') && u.endsWith('.js') && !present.has(u));

const orphans = [...present].filter((f) => !referenced.has(f)).sort();

const report = {
  root,
  chunkCount: present.size,
  referencedChunkCount: referenced.size,
  missingFromChunks: [...missing].map(([file, from]) => ({ file, referencedBy: from.slice(0, 4) })),
  missingFromHtml: [...new Set(htmlMissing)],
  precacheEntries: precacheUrls.size,
  precacheMissing: [...new Set(precacheMissing)],
  orphanChunks: orphans,
};

report.ok = report.missingFromChunks.length === 0 && report.missingFromHtml.length === 0 && report.precacheMissing.length === 0;

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;
