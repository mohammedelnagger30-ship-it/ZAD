// Tafsir entry point for the app.
//
// This used to ship a `getTafsir()` that returned a paragraph of placeholder text
// explaining that no tafsir was available. That is gone: eight real Arabic tafsirs are now
// downloadable through `utils/tafsirService`, covering all 114 surahs.
//
// Two tabs the tafsir sheet used to show — word meanings (معاني الكلمات / غريب القرآن) and
// reasons for revelation (أسباب النزول) — were also empty placeholders and were dropped
// rather than kept as tabs that never have anything in them, because a tab that always
// says "not available" is worse than no tab at all. Reasons for revelation still has no
// source this project can verify, and inventing entries for religious content is not
// acceptable. Word meanings now do have one (quranpedia.net — see data/SOURCES.md §2) and
// were restored inside the word analysis sheet, not as a tab here: they are downloaded from
// the content library, aligned against the Uthmani text before display, and any phrase that
// does not align is never shown.

export {
  TAFSIR_EDITIONS,
  DEFAULT_TAFSIR_ID,
  getTafsirEdition,
  formatBytes,
  type TafsirEdition,
} from '@/data/contentCatalog';

export { getAyahTafsir, ensureSurahTafsir } from '@/utils/tafsirService';
