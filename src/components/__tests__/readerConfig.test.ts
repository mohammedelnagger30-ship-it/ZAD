import {
  loadPrefs,
  PREFS_KEY,
  isDarkPaper,
  isMushafPaper,
  mushafTextColumnWidth,
} from '@/components/mushaf/readerConfig';

describe('readerConfig paper migration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('mushafTextColumnWidth', () => {
    it('matches the available printed column at phone and tablet widths', () => {
      expect(mushafTextColumnWidth(390)).toBeCloseTo(296.4);
      expect(mushafTextColumnWidth(600)).toBeCloseTo(480.8);
      expect(mushafTextColumnWidth(768)).toBeCloseTo(622.4);
      expect(mushafTextColumnWidth(1200)).toBeCloseTo(742.4);
    });
  });

  it('defaults to the white paper when nothing is saved', () => {
    expect(loadPrefs().paper).toBe('white');
  });

  it('migrates a legacy night mode to the black paper', () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ mode: 'night' }));
    expect(loadPrefs().paper).toBe('black');
  });

  it('migrates a legacy day mode to the white paper', () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ mode: 'day' }));
    expect(loadPrefs().paper).toBe('white');
  });

  it('preserves an explicit paper preference over a legacy mode', () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ mode: 'night', paper: 'warm' }));
    expect(loadPrefs().paper).toBe('warm');
  });

  it('falls back to white for an unknown mode', () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ mode: 'purple' }));
    expect(loadPrefs().paper).toBe('white');
  });

  it('ignores corrupt JSON', () => {
    localStorage.setItem(PREFS_KEY, '{not json');
    expect(loadPrefs().paper).toBe('white');
  });

  it('classifies dark papers correctly', () => {
    expect(isDarkPaper('navy')).toBe(true);
    expect(isDarkPaper('black')).toBe(true);
    expect(isDarkPaper('white')).toBe(false);
    expect(isDarkPaper('warm')).toBe(false);
  });

  it('guards the paper union', () => {
    expect(isMushafPaper('white')).toBe(true);
    expect(isMushafPaper('night')).toBe(false);
    expect(isMushafPaper(42)).toBe(false);
  });
});
