/**
 * The figure-8 wizard behind the qibla compass's «معايرة البوصلة».
 *
 * A magnetometer cannot be corrected from a web page — the operating system
 * does that, and it does it by watching the sensor move through the field.
 * What a page *can* do is make that motion actually happen and then confirm
 * that it did, instead of printing a line of advice and hoping.
 *
 * So the bar is two criteria, both of which must be met, because neither one
 * on its own proves a figure-8 happened:
 *
 *   · Turning alone is not enough — a slow rock back and forth inside a narrow
 *     arc racks up hundreds of degrees while the phone never points anywhere
 *     new, which is a hand that cannot decide, not a sensor being swept.
 *   · Pointing alone is not enough — one slow half-turn walks a wide arc of
 *     directions in a single pass, without the repeated motion a magnetometer
 *     actually needs to see the field from both sides.
 *
 * A figure-8 does both at once, which is why every compass in the world asks
 * for one; and it does neither of the two shortcuts.
 */

/** Degrees of heading change counted as one bin — coarse enough that jitter is not coverage. */
export const HEADING_BIN_DEG = 30;

/** Turned this far — about a turn and a half of the wrist. */
export const CALIBRATION_TARGET_ROTATION_DEG = 450;

/** Pointed through this many distinct bins — six of them, 180° of directions. */
export const CALIBRATION_TARGET_BINS = 6;

export interface CalibrationTally {
  /** Summed magnitudes of heading change, not a net turn: back-and-forth counts. */
  sweptDeg: number;
  /** The bins the phone has pointed through. */
  bins: ReadonlySet<number>;
}

export function emptyTally(): CalibrationTally {
  return { sweptDeg: 0, bins: new Set() };
}

/** Folds one reading in: turned a little further, and pointed one way more. */
export function tallyHeading(
  tally: CalibrationTally,
  stepDeg: number,
  heading: number,
): CalibrationTally {
  const bins = new Set(tally.bins);
  // Wrapped first so a heading of 360 lands back in bin 0 and a negative one
  // lands in the last bin — the dial may be handed either.
  const wrapped = ((heading % 360) + 360) % 360;
  bins.add(Math.floor(wrapped / HEADING_BIN_DEG));
  return { sweptDeg: tally.sweptDeg + stepDeg, bins };
}

/** How far between the two bars the wizard currently sits, 0–1. */
export function calibrationProgress(tally: CalibrationTally): number {
  return Math.min(
    1,
    (Math.min(1, tally.sweptDeg / CALIBRATION_TARGET_ROTATION_DEG) +
      Math.min(1, tally.bins.size / CALIBRATION_TARGET_BINS)) /
      2,
  );
}

/** Both bars met — the wizard closes and the compass calls itself calibrated. */
export function isCalibrated(tally: CalibrationTally): boolean {
  return (
    tally.sweptDeg >= CALIBRATION_TARGET_ROTATION_DEG &&
    tally.bins.size >= CALIBRATION_TARGET_BINS
  );
}
