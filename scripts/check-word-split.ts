// Checks whether the mushaf's word splitter and the meanings service's word splitter
// ever disagree — a disagreement silently shifts every word index after it, so a tap
// would resolve to the wrong gloss.
import fullText from '../src/data/quran-full.json';
import { splitBasmala } from '../src/utils/basmala';

const RAW = fullText as Record<string, string[]>;

const pageSplit = (t: string) => t.split(' ');
const svcSplit = (t: string) => t.split(/\s+/).filter(Boolean);

let ayahs = 0;
let disagree = 0;
let withDoubleSpace = 0;
let withEdgeSpace = 0;
const samples: string[] = [];

for (const surahKey of Object.keys(RAW)) {
  const list = RAW[surahKey]!;
  for (let i = 0; i < list.length; i++) {
    const text = list[i]!;
    ayahs++;

    if (/\s{2,}/.test(text)) withDoubleSpace++;
    if (text !== text.trim()) withEdgeSpace++;

    // The page lifts the basmala before rendering (MushafPage line 153), so compare on
    // the same string the reader actually splits.
    const shown = splitBasmala(text).rest || text;

    const a = pageSplit(shown);
    const b = svcSplit(shown);
    if (a.length !== b.length) {
      disagree++;
      if (samples.length < 8) {
        samples.push(
          `${surahKey}:${i + 1} page=${a.length} svc=${b.length} raw=[${JSON.stringify(text).slice(0, 90)}]`,
        );
      }
    }
  }
}

console.log(`ayahs=${ayahs}`);
console.log(`with double-space anywhere : ${withDoubleSpace}`);
console.log(`with leading/trailing space: ${withEdgeSpace}`);
console.log(`WORD COUNT DISAGREEMENTS    : ${disagree}`);
for (const s of samples) console.log('  ' + s);

// None of the three counts is cosmetic: a stray space or a splitter disagreement shifts
// every word index after it, so a tap resolves to the wrong gloss. The script used to
// print the numbers and exit 0 whatever they were — a gate `verify` chains but that could
// not fail. All three were zero when this was made fatal, so an honest tree stays green.
if (disagree > 0 || withDoubleSpace > 0 || withEdgeSpace > 0) {
  console.error('FAIL: the two splitters disagree — word indices would shift.');
  process.exit(1);
}
console.log('ok: the two splitters agree on every ayah');
