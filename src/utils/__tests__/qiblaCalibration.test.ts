import { describe, it, expect } from '@jest/globals';
import {
  CALIBRATION_TARGET_BINS,
  CALIBRATION_TARGET_ROTATION_DEG,
  HEADING_BIN_DEG,
  calibrationProgress,
  emptyTally,
  isCalibrated,
  tallyHeading,
  type CalibrationTally,
} from '@/utils/qiblaCalibration';

/**
 * What is checked here is the claim the compass makes on screen: that two
 * bars are required, and that each one on its own can be cleared without a
 * figure-8 having happened at all. The component's own reading filter (steps
 * under 1° are dropped) sits one layer up and is not modelled here — these
 * streams already move the way a phone in a real hand moves.
 */

/**
 * Folds a stream of headings into a tally, the way the orientation handler
 * does: each step is the distance travelled from the reading before it.
 */
function sweep(readings: readonly number[]): CalibrationTally {
  let tally = emptyTally();
  let previous: number | null = null;
  for (const heading of readings) {
    const step = previous === null ? 0 : Math.abs(heading - previous);
    tally = tallyHeading(tally, step, heading);
    previous = heading;
  }
  return tally;
}

/** A heading that rocks twice a second across a `width`° arc, centred on `centre`. */
function rock(center: number, width: number, samples: number): number[] {
  return Array.from({ length: samples }, (_, i) =>
    Math.max(0, center - width / 2 + (i % 2 === 0 ? 0 : width)),
  );
}

describe('qiblaCalibration', () => {
  it('has nothing counted before the wizard starts', () => {
    const tally = emptyTally();
    expect(tally.sweptDeg).toBe(0);
    expect(tally.bins.size).toBe(0);
    expect(isCalibrated(tally)).toBe(false);
    expect(calibrationProgress(tally)).toBe(0);
  });

  it('wraps the heading so 360 and a negative one land on real bins', () => {
    expect(tallyHeading(emptyTally(), 0, 360).bins.has(0)).toBe(true);
    expect(tallyHeading(emptyTally(), 0, -30).bins.has(11)).toBe(true);
    expect(tallyHeading(emptyTally(), 0, 299).bins.has(Math.floor(299 / HEADING_BIN_DEG))).toBe(
      true,
    );
  });

  /**
   * The first shortcut: a hand that cannot decide, rocking hard inside an arc
   * too narrow to ever point somewhere new. It clears the turn bar handily and
   * must still fail.
   */
  it('is not calibrated by turning a lot without ever pointing elsewhere', () => {
    const tally = sweep(rock(10, 8, 400));
    expect(tally.sweptDeg).toBeGreaterThanOrEqual(CALIBRATION_TARGET_ROTATION_DEG);
    expect(tally.bins.size).toBeLessThan(CALIBRATION_TARGET_BINS);
    expect(isCalibrated(tally)).toBe(false);
  });

  /**
   * The second shortcut: one slow half-turn. It points through a genuinely
   * wide arc of directions in a single pass and must still fail, because a
   * magnetometer needs the sweep repeated, not merely begun.
   */
  it('is not calibrated by pointing widely in one slow pass', () => {
    const readings = Array.from({ length: 61 }, (_, i) => i * 3); // 0° → 180°
    const tally = sweep(readings);
    expect(tally.bins.size).toBeGreaterThanOrEqual(CALIBRATION_TARGET_BINS);
    expect(tally.sweptDeg).toBeLessThan(CALIBRATION_TARGET_ROTATION_DEG);
    expect(isCalibrated(tally)).toBe(false);
  });

  it('is calibrated by a figure-8: swept through, and pointed everywhere', () => {
    // Three swings of ~200°, out and back — the gesture the screen asks for.
    const leg = Array.from({ length: 41 }, (_, i) => i * 5); // 0° → 200°
    const back = [...leg].reverse();
    const tally = sweep([...leg, ...back, ...leg, ...back, ...leg]);

    expect(tally.sweptDeg).toBeGreaterThanOrEqual(CALIBRATION_TARGET_ROTATION_DEG);
    expect(tally.bins.size).toBeGreaterThanOrEqual(CALIBRATION_TARGET_BINS);
    expect(isCalibrated(tally)).toBe(true);
    expect(calibrationProgress(tally)).toBe(1);
  });

  it('reports progress between the two ends and never past either', () => {
    const half = sweep(Array.from({ length: 31 }, (_, i) => i * 3)); // 0° → 90°
    const progress = calibrationProgress(half);
    expect(progress).toBeGreaterThan(0);
    expect(progress).toBeLessThan(1);

    // A tally far past both bars still reads as complete, not as 150%.
    const over = { sweptDeg: 5000, bins: new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) };
    expect(calibrationProgress(over)).toBe(1);
    expect(isCalibrated(over)).toBe(true);
  });

  it('counts each direction once, however often the phone swings back through it', () => {
    const leg = Array.from({ length: 41 }, (_, i) => i * 5); // 0° → 200°
    const back = [...leg].reverse();
    const once = sweep([...leg, ...back]);
    const many = sweep([...leg, ...back, ...leg, ...back, ...leg, ...back]);

    expect(many.sweptDeg).toBeGreaterThan(once.sweptDeg);
    expect(many.bins.size).toBe(once.bins.size);
  });
});
