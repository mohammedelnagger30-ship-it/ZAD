/**
 * Measures every Quran word in the real mushaf font, using the browser's own text
 * shaper.
 *
 * Why a browser: Arabic width is not the sum of letter widths. Shaping in context
 * (ligatures, mark positions) is what decides the width, and only the platform shaper
 * knows it. Any Node-side approximation (sum of `hmtx` advances, or "characters ×
 * average") is wrong by enough to move line breaks — and a mushaf page *is* its line
 * breaks.
 *
 * Node cannot shape text without a native text stack, so the measurement runs in
 * headless Chromium and the widths come back as numbers. The font is inlined as a data
 * URL so nothing depends on a server or the network.
 *
 * Run with: node scripts/measure-word-widths.mjs   (writes build/word-widths.json)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(
  'C:\\Users\\ALMASRIA STORES\\.vscode\\extensions\\danielsanmedium.dscodegpt-3.24.76\\standalone\\node_modules\\patchright',
);

const ROOT = process.cwd();
const FONT_PATH = join(ROOT, 'public', 'fonts', 'AmiriQuran-Regular.ttf');
const QURAN_PATH = join(ROOT, 'src', 'data', 'quran-full.json');
const OUT_DIR = join(ROOT, 'build');
const OUT_PATH = join(OUT_DIR, 'word-widths.json');

/**
 * Reference size. Not arbitrary: `measureText` returns px for the size on the context,
 * so 100 makes every width a per-100px value that any other size is a scale of.
 */
const REF_PX = 100;
const FAMILY = 'AmiriQuran';

function fail(message) {
  console.error(`\n  ERROR  ${message}\n`);
  process.exit(1);
}

async function main() {
  if (!existsSync(FONT_PATH)) fail(`font missing: ${FONT_PATH}`);
  if (!existsSync(QURAN_PATH)) fail(`quran text missing: ${QURAN_PATH}`);

  const fontBase64 = readFileSync(FONT_PATH).toString('base64');
  const quranText = readFileSync(QURAN_PATH, 'utf8');
  console.log(`font   ${(fontBase64.length / 1024).toFixed(0)} KiB base64`);
  console.log(`text   ${(quranText.length / 1024).toFixed(0)} KiB`);

  const browser = await chromium.launch({
    headless: true,
    channel: 'chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
  });

  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => fail(`page error: ${e.message}`));

    await page.setContent('<!doctype html><html><body></body></html>');

    const result = await page.evaluate(
      async ({ fontUrl, text, refPx, family }) => {
        const face = new FontFace(family, `url(${fontUrl})`);
        await face.load();
        document.fonts.add(face);
        await document.fonts.ready;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.font = `${refPx}px "${family}"`;

        // A sanity check beats a silently wrong number: measure a known string at two
        // sizes and confirm it scales linearly, or the whole table is unusable.
        const probe = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ';
        const probeA = ctx.measureText(probe).width;
        ctx.font = `${refPx * 2}px "${family}"`;
        const probeB = ctx.measureText(probe).width / 2;
        const linear = Math.abs(probeA - probeB) / Math.max(probeA, 1);

        ctx.font = `${refPx}px "${family}"`;
        const spaceWidth = ctx.measureText(' ').width;

        const surahs = JSON.parse(text);
        const widths = Object.create(null);
        let wordCount = 0;

        for (const key of Object.keys(surahs).sort((a, b) => Number(a) - Number(b))) {
          for (const ayah of surahs[key]) {
            for (const word of ayah.split(' ')) {
              if (!word) continue;
              wordCount++;
              if (widths[word] === undefined) {
                // Rounded to 0.01px at the 100px reference: finer than that is under a
                // thousandth of a page and cannot move a line break.
                widths[word] = Math.round(ctx.measureText(word).width * 100) / 100;
              }
            }
          }
        }

        return {
          spaceWidth: Math.round(spaceWidth * 100) / 100,
          linear,
          probeWidth: probeA,
          wordCount,
          uniqueWords: Object.keys(widths).length,
          widths,
        };
      },
      {
        fontUrl: `data:font/ttf;base64,${fontBase64}`,
        text: quranText,
        refPx: REF_PX,
        family: FAMILY,
      },
    );

    console.log(`\n  sanity: linear scaling |a-b|/a = ${result.linear.toFixed(6)}`);
    console.log(`  probe basmala = ${result.probeWidth.toFixed(2)}px @ ${REF_PX}px`);
    console.log(`  space = ${result.spaceWidth}px @ ${REF_PX}px`);
    console.log(`  words = ${result.wordCount.toLocaleString('en-US')} (${result.uniqueWords.toLocaleString('en-US')} unique)`);

    if (result.linear > 0.01) fail(`measureText is not linear (${result.linear}) — results would not scale`);
    if (result.probeWidth === 0) fail('the font measured as zero width — it did not load');

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(
      OUT_PATH,
      JSON.stringify({
        note: 'Word advance widths in px at the 100px reference, shaped by Chromium.',
        refPx: REF_PX,
        family: FAMILY,
        spaceWidth: result.spaceWidth,
        wordCount: result.wordCount,
        uniqueWords: result.uniqueWords,
        widths: result.widths,
      }),
    );
    console.log(`\n  wrote ${OUT_PATH}`);
  } finally {
    await browser.close();
  }
}

void main();