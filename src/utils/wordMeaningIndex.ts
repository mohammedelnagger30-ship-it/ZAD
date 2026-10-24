/**
 * Which words of the Quran carry a gloss: `${surahId}:${ayahNumber}` → word indexes.
 */
export type WordMeaningIndex = Record<string, number[]>;

/**
 * The bundled copy of that index, fetched from `public/word-meaning-index.json`.
 *
 * It ships with the app precisely so that marking a word is a property of the mushaf
 * rather than a download the reader has to remember to make: the pins are lit from the
 * first launch, offline, before anything has been written to IndexedDB. What still has
 * to be fetched is the *gloss* — the sheet has to read a meaning out of a book — so this
 * answers only "which words are worth marking", and where the dump is installed its own
 * markers are folded in over the top of it, so a dump newer than this build's index
 * still gets every word it knows about.
 *
 * Remembered once per session: turning a page looks the answer up, it does not go
 * asking for it again. The reader screen asks for the same answer as the mushaf page
 * does, and a reader who opens both gets one request, not two.
 */
let cachedBundledIndex: WordMeaningIndex | null = null;
let bundledIndexRequest: Promise<WordMeaningIndex> | null = null;

export function loadBundledMeaningIndex(): Promise<WordMeaningIndex> {
  if (cachedBundledIndex) return Promise.resolve(cachedBundledIndex);
  if (!bundledIndexRequest) {
    bundledIndexRequest = fetch(`${import.meta.env.BASE_URL}word-meaning-index.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<WordMeaningIndex>;
      })
      .then((index) => {
        cachedBundledIndex = index;
        return index;
      })
      .catch((cause: unknown) => {
        // The file is precached with the rest of the shell, so a failure here means this
        // install is broken rather than the connection. Remember the empty answer
        // instead of asking every page in turn, and leave the word sheet to say that
        // meanings are not on the device.
        console.error('Unable to load the bundled word-meaning index:', cause);
        const empty: WordMeaningIndex = {};
        cachedBundledIndex = empty;
        return empty;
      });
  }
  return bundledIndexRequest;
}

/** The marked word indexes of one ayah, or an empty set when nothing is marked. */
export function markedWordIndexes(
  index: WordMeaningIndex | null,
  surahId: number,
  ayahNumber: number,
): ReadonlySet<number> {
  const hits = index?.[`${surahId}:${ayahNumber}`];
  return hits && hits.length > 0 ? new Set(hits) : EMPTY_SET;
}

const EMPTY_SET: ReadonlySet<number> = new Set();
