import { toArabicNumber } from '@/data/surahs';

/**
 * Sharing an ayah as a picture, not as a string of text.
 *
 * A copied ayah arrives in a chat as three plain lines that nobody looks at
 * twice; the same ayah as a card is a thing worth keeping. This module owns
 * the whole path — laying the words out on a canvas, drawing them, and handing
 * the result to the system share sheet — plus every honest fallback when that
 * path is closed: the platform that shares files but not this one, the browser
 * with no share sheet at all, and the person who simply cancels, who must not
 * be told that something failed.
 *
 * Three things are worth knowing before changing any of it:
 *
 *   * **The card is drawn at a fixed size and a fixed palette.** It leaves the
 *     app, so it must not follow the reader's colour scheme or the width of
 *     their phone — a card that looks different on every device that sent it
 *     is not a card.
 *
 *   * **Wrapping is greedy and measured, never estimated.** Arabic with
 *     harakat is wide and its shaping is decided by the font, so the only
 *     honest width is one measured with the same font the words will be drawn
 *     in. `wrapLines` takes the measuring function as an argument so that this
 *     is testable without a canvas.
 *
 *   * **`navigator.share` must be reached while the tap is still fresh.** The
 *     platform only honours it inside a short activation window, so the
 *     rendering happens first and quickly, and anything that can lose that
 *     window (a long await, a dialog, a second screen) does not belong on this
 *     path.
 */

/** 4:5 — the proportion messaging apps give the most room. */
const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1350;

/** The default palette, deliberately: the card leaves the app and outlives the theme. */
const DEEP_GREEN = '#143b2b';
const DEEPER_GREEN = '#0a2118';
const GOLD = '#d4a017';
const GOLD_LIGHT = '#f0c83a';
const PARCHMENT = '#fefce8';
const PARCHMENT_DIM = '#fdf8c4';

const FRAME_INSET = 56;
const FRAME_INSET_INNER = 74;

const QURAN_FONT = '"Amiri Quran", "Amiri", serif';
const UI_FONT = '"Cairo", "Tajawal", system-ui, sans-serif';

/** Where the ayah itself may live; the reference and the name sit below it. */
const AYAH_BOX = { left: 150, right: 930, top: 200, bottom: 1010 };
const DIVIDER_Y = 1078;
const REFERENCE_BASELINE = 1168;
const APP_NAME_BASELINE = 1262;

/**
 * The largest face the ayah may take, and the floor it may shrink to.
 *
 * The maximum is deliberately several times the reference's: on a 1080-wide
 * card, seventy-odd pixels gave a one-line ayah a face barely larger than the
 * caption beneath it, and the whole point of a card is that the verse is the
 * thing on it. Long ayahs do not need a smaller maximum — `fitAyah` finds
 * whatever size lets the words fit the box, which for Ayat al-Kursi is well
 * under this.
 */
const MAX_AYAH_FONT = 150;
const MIN_AYAH_FONT = 34;
const FONT_STEP = 4;
const LINE_HEIGHT_RATIO = 1.9;

export interface AyahShareInput {
  /** Kept for the file name: what lands in a gallery should say which ayah it is. */
  surahId: number;
  ayahText: string;
  surahName: string;
  ayahNumber: number;
}

export type ShareOutcome =
  /** The share sheet opened and the person sent it. */
  | 'shared'
  /** No share sheet here; the text is on the clipboard instead. */
  | 'copied'
  /** They opened the sheet and closed it. Not a failure, and not worth a notice. */
  | 'cancelled'
  /** Neither the sheet nor the clipboard would take it. */
  | 'failed';

/**
 * The text half of a share.
 *
 * Identical to what the app already puts on the clipboard for an ayah, on
 * purpose: whoever receives the picture often receives the words alongside it,
 * and two different formats for the same verse would be two things to explain.
 */
export function composeSharePayload(input: AyahShareInput): string {
  const reference = `${input.surahName} — الآية ${toArabicNumber(input.ayahNumber)}`;
  return `﴿${input.ayahText}﴾\n${reference}`;
}

/**
 * Greedy line breaking: fill a line, then break when the next word will not fit.
 *
 * The measuring function is passed in rather than read from a canvas because
 * this is the part that decides whether the card is legible, and a canvas is
 * the one thing a test cannot make. Anything longer than `maxWidth` gets its
 * own line rather than being cut — a word sliced in half is a word that has
 * been changed, which is not a thing to do to an ayah.
 */
export function wrapLines(
  text: string,
  maxWidth: number,
  measure: (line: string) => number,
): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = words[0];
  for (let index = 1; index < words.length; index += 1) {
    const candidate = `${current} ${words[index]}`;
    if (measure(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = words[index];
  }
  lines.push(current);
  return lines;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

async function copyToClipboard(payload: string): Promise<ShareOutcome> {
  try {
    await navigator.clipboard.writeText(payload);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/**
 * The text half of sharing, on its own: the sheet when there is one, the
 * clipboard when there is not.
 *
 * Every place that puts words out of the app comes through here so that "the
 * person closed the sheet" is handled once instead of in five try/catch
 * blocks — each of which would otherwise have to know that closing it is not
 * the same as it failing.
 */
export async function shareTextOrCopy(payload: string): Promise<ShareOutcome> {
  if (typeof navigator === 'undefined' || !navigator.share) {
    return copyToClipboard(payload);
  }
  try {
    await navigator.share({ text: payload });
    return 'shared';
  } catch (error) {
    if (isAbortError(error)) return 'cancelled';
    return copyToClipboard(payload);
  }
}

/**
 * Draws the ayah on a canvas and hands back the pixels.
 *
 * Returns null rather than throwing wherever the environment can refuse — no
 * canvas in a headless test, no canvas in a locked-down WebView — because the
 * caller has a text share to fall back on, and refusing to draw is not the
 * same as failing to share.
 */
export async function renderAyahCard(input: AyahShareInput): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) return null;

  await ensureQuranFont(context);

  const background = context.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
  background.addColorStop(0, DEEP_GREEN);
  background.addColorStop(1, DEEPER_GREEN);
  context.fillStyle = background;
  context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  drawFrame(context);
  drawAyah(context, input.ayahText);
  drawReference(context, input.surahName, input.ayahNumber);

  return new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    } catch {
      resolve(null);
    }
  });
}

/**
 * Waits for the Quran face to actually be usable before measuring against it.
 *
 * Measuring with a fallback face and drawing with the real one produces text
 * that overflows its box — the two faces have entirely different widths — and
 * a font that has not been requested yet is not in the document's font set
 * until something asks for it. `document.fonts.load` is that something, and a
 * failure means drawing in whatever face is available rather than not drawing.
 */
async function ensureQuranFont(context: CanvasRenderingContext2D): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  try {
    context.font = `400 ${MAX_AYAH_FONT}px ${QURAN_FONT}`;
    await document.fonts.load(context.font);
  } catch {
    // The fallback face is already in the font string; drawing continues with it.
  }
}

/** Two hairlines with air between them: the manuscript frame, not a picture border. */
function drawFrame(context: CanvasRenderingContext2D): void {
  context.save();
  context.strokeStyle = GOLD;
  context.lineWidth = 2;
  context.strokeRect(FRAME_INSET, FRAME_INSET, CARD_WIDTH - FRAME_INSET * 2, CARD_HEIGHT - FRAME_INSET * 2);

  context.strokeStyle = GOLD_LIGHT;
  context.globalAlpha = 0.55;
  context.lineWidth = 1;
  context.strokeRect(
    FRAME_INSET_INNER,
    FRAME_INSET_INNER,
    CARD_WIDTH - FRAME_INSET_INNER * 2,
    CARD_HEIGHT - FRAME_INSET_INNER * 2,
  );
  context.restore();
}

function drawAyah(context: CanvasRenderingContext2D, text: string): void {
  const boxWidth = AYAH_BOX.right - AYAH_BOX.left;
  const boxHeight = AYAH_BOX.bottom - AYAH_BOX.top;
  const centerX = (AYAH_BOX.left + AYAH_BOX.right) / 2;

  const fit = fitAyah(context, text, boxWidth, boxHeight);

  context.save();
  context.direction = 'rtl';
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  context.fillStyle = PARCHMENT;
  context.font = `${fit.fontSize}px ${QURAN_FONT}`;

  // Centred as a block, so a three-line ayah hangs around the same middle as
  // a one-line one and the card does not look emptier on some days.
  const lineHeight = fit.fontSize * LINE_HEIGHT_RATIO;
  const blockHeight = fit.lines.length * lineHeight;
  const firstBaseline = (AYAH_BOX.top + AYAH_BOX.bottom - blockHeight) / 2 + lineHeight * 0.72;

  fit.lines.forEach((line, index) => {
    context.fillText(line, centerX, firstBaseline + index * lineHeight);
  });
  context.restore();

  drawDivider(context, centerX);
}

/**
 * Shrinks the face until the words fit the box, rather than shrinking the box.
 *
 * The alternative — clipping whatever runs past the bottom — would truncate an
 * ayah, and the length of an ayah is not a detail this card gets to choose.
 */
function fitAyah(
  context: CanvasRenderingContext2D,
  text: string,
  boxWidth: number,
  boxHeight: number,
): { lines: string[]; fontSize: number } {
  for (let fontSize = MAX_AYAH_FONT; fontSize >= MIN_AYAH_FONT; fontSize -= FONT_STEP) {
    context.font = `${fontSize}px ${QURAN_FONT}`;
    const measure = (line: string) => context.measureText(line).width;
    const lines = wrapLines(text, boxWidth, measure);
    if (lines.length * fontSize * LINE_HEIGHT_RATIO <= boxHeight) {
      return { lines, fontSize };
    }
  }

  context.font = `${MIN_AYAH_FONT}px ${QURAN_FONT}`;
  return {
    lines: wrapLines(text, boxWidth, (line) => context.measureText(line).width),
    fontSize: MIN_AYAH_FONT,
  };
}

/** A gold line with a diamond where the verse ends. */
function drawDivider(context: CanvasRenderingContext2D, centerX: number): void {
  context.save();
  context.strokeStyle = GOLD;
  context.globalAlpha = 0.7;
  context.lineWidth = 2;

  const half = 150;
  const gap = 34;
  context.beginPath();
  context.moveTo(centerX - half, DIVIDER_Y);
  context.lineTo(centerX - gap, DIVIDER_Y);
  context.moveTo(centerX + gap, DIVIDER_Y);
  context.lineTo(centerX + half, DIVIDER_Y);
  context.stroke();

  context.fillStyle = GOLD_LIGHT;
  context.beginPath();
  context.moveTo(centerX, DIVIDER_Y - 11);
  context.lineTo(centerX + 11, DIVIDER_Y);
  context.lineTo(centerX, DIVIDER_Y + 11);
  context.lineTo(centerX - 11, DIVIDER_Y);
  context.closePath();
  context.fill();
  context.restore();
}

function drawReference(context: CanvasRenderingContext2D, surahName: string, ayahNumber: number): void {
  const centerX = CARD_WIDTH / 2;

  context.save();
  context.direction = 'rtl';
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';

  context.fillStyle = GOLD_LIGHT;
  context.font = `700 42px ${UI_FONT}`;
  context.fillText(
    `سورة ${surahName} — الآية ${toArabicNumber(ayahNumber)}`,
    centerX,
    REFERENCE_BASELINE,
  );

  context.fillStyle = PARCHMENT_DIM;
  context.globalAlpha = 0.75;
  context.font = `600 30px ${UI_FONT}`;
  context.fillText('قُرّة', centerX, APP_NAME_BASELINE);
  context.restore();
}

/**
 * Shares the card, and degrades in the order that keeps the ayah moving.
 *
 * Picture, then the share sheet with text, then the clipboard. Each step is
 * reached only because the one before it was *closed*, not because it failed:
 * a platform that offers no share sheet is not broken, and neither is one that
 * shares text but not images. The single case that must not fall through is
 * the person cancelling — sending a second sheet after they closed the first
 * would be the app not listening.
 */
export async function shareAyahCard(input: AyahShareInput): Promise<ShareOutcome> {
  if (typeof navigator === 'undefined' || !navigator.share) {
    return copyToClipboard(composeSharePayload(input));
  }

  const payload = composeSharePayload(input);
  const blob = await renderAyahCard(input).catch(() => null);
  const file = blob ? toPngFile(blob, input) : null;

  if (file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: payload, title: 'آية اليوم' });
      return 'shared';
    } catch (error) {
      if (isAbortError(error)) return 'cancelled';
      // The sheet refused the file; the words below are still a real share.
    }
  }

  return shareTextOrCopy(payload);
}

/**
 * Names the file after the ayah, so what lands in the gallery says which one
 * it is. A share sheet that shows «image.png» forty times tells nobody
 * anything a week later.
 */
function toPngFile(blob: Blob, input: AyahShareInput): File | null {
  try {
    return new File([blob], `ayah-${input.surahId}-${input.ayahNumber}.png`, { type: 'image/png' });
  } catch {
    return null;
  }
}
