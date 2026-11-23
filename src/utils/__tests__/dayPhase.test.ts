import { dayPhaseOf } from '@/utils/dayPhase';

describe('dayPhaseOf', () => {
  const at = (hour: number, minute = 0) =>
    new Date(2026, 9, 30, hour, minute);

  it('is morning between 04:00 and 11:59', () => {
    expect(dayPhaseOf(at(4))).toBe('morning');
    expect(dayPhaseOf(at(11, 59))).toBe('morning');
  });

  it('is midday between 12:00 and 17:59', () => {
    expect(dayPhaseOf(at(12))).toBe('midday');
    expect(dayPhaseOf(at(17, 59))).toBe('midday');
  });

  it('is evening between 18:00 and 03:59', () => {
    expect(dayPhaseOf(at(18))).toBe('evening');
    expect(dayPhaseOf(at(23, 59))).toBe('evening');
    expect(dayPhaseOf(at(0))).toBe('evening');
    expect(dayPhaseOf(at(3, 59))).toBe('evening');
  });

  it('treats the boundaries as inclusive on the lower side', () => {
    expect(dayPhaseOf(at(4))).toBe('morning');
    expect(dayPhaseOf(at(12))).toBe('midday');
    expect(dayPhaseOf(at(18))).toBe('evening');
  });
});
