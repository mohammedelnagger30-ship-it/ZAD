// Hadith entry point for the app.
//
// The 32 hadiths this file used to hold were typed in by hand. That is exactly what its
// old header comment warned against ("NEVER generate or write hadith text from memory"),
// and once the real collections became available there was no reason to keep them: they
// duplicated texts the sources publish verbatim, and they were the one place in the
// codebase where religious text could drift with no check catching it.
//
// Everything now comes from the downloaded collections, read by `utils/hadithService`.
// This module stays as the name the screens import from, so call sites keep their shape.

export type { HadithRecord, HadithCollection } from '@/utils/hadithService';

export { HADITH_OF_DAY_BOOK } from '@/data/contentCatalog';

export {
  getHadithCollection,
  installedCollections,
  searchInstalledHadiths,
  hadithOfDay,
} from '@/utils/hadithService';

export { GRADE_INFO } from '@/data/hadithCollections';