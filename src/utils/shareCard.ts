import { toArabicNumber } from '@/data/surahs';
import { Capacitor } from '@capacitor/core';
import { COLOR_PALETTES, type ColorPalette } from '@/utils/colorThemes';

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
const GOLD = '#d4a017';
const GOLD_LIGHT = '#f0c83a';
const PARCHMENT = '#fefce8';
const PARCHMENT_DIM = '#fdf8c4';

const FRAME_INSET = 56;
const FRAME_INSET_INNER = 74;

const QURAN_FONT = '"Amiri Quran", "Amiri", serif';
const UI_FONT = '"Cairo", "Tajawal", system-ui, sans-serif';

/** Where the ayah itself may live; the reference and the name sit below it. */
const AYAH_BOX = { left: 150, right: 930, top: 285, bottom: 1010 };
const CATEGORY_BADGE_BASELINE = 190;
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
  palette?: ColorPalette;
}

export function getAyahFontCeiling(text: string): number {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount <= 4) return 94;
  if (wordCount <= 8) return 118;
  return MAX_AYAH_FONT;
}

export interface PreparedAyahShare {
  blob: Blob;
  nativeUri?: string;
}

export interface ContentShareInput {
  type: 'hadith' | 'dhikr';
  text: string;
  reference: string;
  title?: string;
  palette?: ColorPalette;
}

interface ContentCardLayout {
  lines: string[];
  fontSize: number;
  height: number;
}

export interface ShareCardColors {
  dark: string;
  mid: string;
  deeper: string;
  glow: string;
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

export function composeContentSharePayload(input: ContentShareInput): string {
  return `${input.text}\n\n${input.reference}\nمن تطبيق قُرّة`;
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

  drawCardSurface(context, CARD_HEIGHT, input.palette);
  drawHeader(context, 'آية اليوم');
  drawMihrab(context);
  drawAyah(context, input.ayahText, input.ayahNumber);
  drawReference(context, input.surahName, input.ayahNumber);

  return new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    } catch {
      resolve(null);
    }
  });
}

export async function renderContentCard(input: ContentShareInput): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) return null;

  await ensureQuranFont(context);
  const layout = fitContentText(context, input.text);
  canvas.height = layout.height;
  drawCardSurface(context, layout.height, input.palette);
  drawHeader(context, input.type === 'hadith' ? 'حديث نبوي' : 'ذكر مبارك');
  drawMihrab(context);
  drawContentText(context, layout);
  drawDivider(context, CARD_WIDTH / 2, layout.height - 272);
  drawContentReference(context, input.reference, layout.height - 182, layout.height - 88);

  return new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    } catch {
      resolve(null);
    }
  });
}

export async function prepareAyahShare(input: AyahShareInput): Promise<PreparedAyahShare | null> {
  try {
    const blob = await renderAyahCard(input);
    if (!blob) return null;
    if (!Capacitor.isNativePlatform()) return { blob };

    try {
      const { Directory, Filesystem } = await import('@capacitor/filesystem');
      const data = await blobToBase64(blob);
      const { uri } = await Filesystem.writeFile({
        path: 'daily-quran-message.png',
        data,
        directory: Directory.Cache,
      });
      return { blob, nativeUri: uri };
    } catch (error) {
      console.warn('Could not prepare the Quran message image for native sharing:', error);
      return { blob };
    }
  } catch {
    return null;
  }
}

export async function prepareContentShare(input: ContentShareInput): Promise<PreparedAyahShare | null> {
  try {
    const blob = await renderContentCard(input);
    if (!blob) return null;
    if (!Capacitor.isNativePlatform()) return { blob };

    try {
      const { Directory, Filesystem } = await import('@capacitor/filesystem');
      const data = await blobToBase64(blob);
      const { uri } = await Filesystem.writeFile({
        path: `share-${input.type}-${Date.now()}.png`,
        data,
        directory: Directory.Cache,
      });
      return { blob, nativeUri: uri };
    } catch (error) {
      console.warn('Could not prepare the content share image for native sharing:', error);
      return { blob };
    }
  } catch {
    return null;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Image could not be encoded for sharing.'));
        return;
      }
      const separator = reader.result.indexOf(',');
      if (separator < 0) {
        reject(new Error('Image data is not a valid data URL.'));
        return;
      }
      resolve(reader.result.slice(separator + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Image could not be read for sharing.'));
    reader.readAsDataURL(blob);
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
    await document.fonts.load(`700 32px ${UI_FONT}`);
  } catch {
    // The fallback faces are already in the font strings; drawing continues with them.
  }
}

function drawBackdrop(
  context: CanvasRenderingContext2D,
  glowColor: string,
  cardHeight = CARD_HEIGHT,
): void {
  const centerY = cardHeight / 2;
  const glow = context.createRadialGradient(540, centerY, 100, 540, centerY, 800);
  glow.addColorStop(0, glowColor);
  glow.addColorStop(0.72, 'rgba(0, 0, 0, 0.08)');
  glow.addColorStop(1, 'rgba(0, 0, 0, 0.42)');
  context.fillStyle = glow;
  context.fillRect(0, 0, CARD_WIDTH, cardHeight);

  context.save();
  context.strokeStyle = GOLD_LIGHT;
  context.lineWidth = 2;
  const ornaments = [
    [120, 245, 58], [960, 245, 58],
    [120, 675, 46], [960, 675, 46],
    [120, 1095, 58], [960, 1095, 58],
  ] as const;
  for (const [x, y, radius] of ornaments) {
    context.globalAlpha = 0.13;
    drawEightPointStar(context, x, y, radius, radius * 0.58);
    context.globalAlpha = 0.11;
    context.beginPath();
    context.arc(x, y, radius * 1.28, 0, Math.PI * 2);
    context.stroke();
  }
  context.restore();
}

function drawEightPointStar(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  outerRadius: number,
  innerRadius: number,
): void {
  context.beginPath();
  for (let point = 0; point < 16; point += 1) {
    const angle = -Math.PI / 2 + (point * Math.PI) / 8;
    const radius = point % 2 === 0 ? outerRadius : innerRadius;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (point === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  }
  context.closePath();
  context.stroke();
}

/** Fine double frame with corner rosettes and a restrained manuscript finish. */
function drawFrame(context: CanvasRenderingContext2D, cardHeight = CARD_HEIGHT): void {
  context.save();
  context.strokeStyle = GOLD;
  context.lineWidth = 2;
  context.strokeRect(FRAME_INSET, FRAME_INSET, CARD_WIDTH - FRAME_INSET * 2, cardHeight - FRAME_INSET * 2);

  context.strokeStyle = GOLD_LIGHT;
  context.globalAlpha = 0.55;
  context.lineWidth = 1;
  context.strokeRect(
    FRAME_INSET_INNER,
    FRAME_INSET_INNER,
    CARD_WIDTH - FRAME_INSET_INNER * 2,
    cardHeight - FRAME_INSET_INNER * 2,
  );
  context.globalAlpha = 0.75;
  context.strokeStyle = GOLD_LIGHT;
  context.lineWidth = 2;
  const corners = [
    [FRAME_INSET_INNER, FRAME_INSET_INNER, 1, 1],
    [CARD_WIDTH - FRAME_INSET_INNER, FRAME_INSET_INNER, -1, 1],
    [FRAME_INSET_INNER, cardHeight - FRAME_INSET_INNER, 1, -1],
    [CARD_WIDTH - FRAME_INSET_INNER, cardHeight - FRAME_INSET_INNER, -1, -1],
  ] as const;
  for (const [x, y, horizontal, vertical] of corners) {
    context.beginPath();
    context.moveTo(x, y + vertical * 52);
    context.lineTo(x, y);
    context.lineTo(x + horizontal * 52, y);
    context.moveTo(x + horizontal * 12, y + vertical * 12);
    context.lineTo(x + horizontal * 30, y + vertical * 30);
    context.stroke();
    context.beginPath();
    context.arc(x + horizontal * 42, y + vertical * 42, 4, 0, Math.PI * 2);
    context.fillStyle = GOLD_LIGHT;
    context.fill();
  }
  context.restore();
}

function drawCardSurface(
  context: CanvasRenderingContext2D,
  cardHeight = CARD_HEIGHT,
  paletteId?: ColorPalette,
): void {
  const colors = getShareCardColors(paletteId);
  const background = context.createLinearGradient(0, 0, CARD_WIDTH, cardHeight);
  background.addColorStop(0, colors.dark);
  background.addColorStop(0.52, colors.mid);
  background.addColorStop(1, colors.deeper);
  context.fillStyle = background;
  context.fillRect(0, 0, CARD_WIDTH, cardHeight);
  drawBackdrop(context, colors.glow, cardHeight);
  drawFrame(context, cardHeight);
}

export function getShareCardColors(paletteId?: ColorPalette): ShareCardColors {
  const palette = COLOR_PALETTES.find(({ id }) => id === (paletteId ?? getSelectedPalette())) ??
    COLOR_PALETTES[0];
  return {
    dark: darkenColor(palette.color, 0.24),
    mid: darkenColor(palette.color, 0.38),
    deeper: darkenColor(palette.color, 0.15),
    glow: toRgba(palette.color, 0.18),
  };
}

function getSelectedPalette(): ColorPalette {
  const paletteId = typeof document === 'undefined'
    ? undefined
    : document.documentElement.dataset.palette;
  return COLOR_PALETTES.find(({ id }) => id === paletteId)?.id ?? COLOR_PALETTES[0].id;
}

function darkenColor(hexColor: string, factor: number): string {
  const channels = hexColor.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (!channels) return '#143b2b';
  const rgb = [0, 2, 4].map((offset) => Math.round(parseInt(channels.slice(offset, offset + 2), 16) * factor));
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function toRgba(hexColor: string, alpha: number): string {
  const channels = hexColor.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (!channels) return `rgba(57, 111, 77, ${alpha})`;
  const rgb = [0, 2, 4].map((offset) => parseInt(channels.slice(offset, offset + 2), 16));
  return `rgba(${rgb.join(', ')}, ${alpha})`;
}

function drawHeader(context: CanvasRenderingContext2D, badgeLabel: string): void {
  const centerX = CARD_WIDTH / 2;
  context.save();
  context.direction = 'rtl';
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';

  const badgeWidth = 184;
  const badgeHeight = 42;
  const badgeX = centerX - badgeWidth / 2;
  const badgeY = CATEGORY_BADGE_BASELINE - 32;
  context.fillStyle = 'rgba(212, 160, 23, 0.14)';
  context.strokeStyle = 'rgba(240, 200, 58, 0.75)';
  context.lineWidth = 1.5;
  roundedRect(context, badgeX, badgeY, badgeWidth, badgeHeight, 21);
  context.fill();
  context.stroke();
  context.fillStyle = GOLD_LIGHT;
  context.font = `700 24px ${UI_FONT}`;
  context.fillText(badgeLabel, centerX, CATEGORY_BADGE_BASELINE - 4);
  context.restore();
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function drawMihrab(context: CanvasRenderingContext2D): void {
  context.save();
  context.strokeStyle = GOLD_LIGHT;
  context.lineWidth = 2;
  context.globalAlpha = 0.12;
  for (const inset of [0, 24]) {
    const left = 156 + inset;
    const right = 924 - inset;
    const spring = 620 + inset;
    const peak = 276 + inset;
    context.beginPath();
    context.moveTo(left, 1014);
    context.lineTo(left, spring);
    context.quadraticCurveTo(left, peak + 34, CARD_WIDTH / 2, peak);
    context.quadraticCurveTo(right, peak + 34, right, spring);
    context.lineTo(right, 1014);
    context.stroke();
  }
  context.restore();
}

function fitContentText(context: CanvasRenderingContext2D, text: string): ContentCardLayout {
  const left = 150;
  const right = 930;
  const top = 300;
  const boxWidth = right - left;
  const defaultBoxHeight = CARD_HEIGHT - 272 - 70 - top;
  let fontSize = 82;
  let lines: string[] = [];

  for (; fontSize >= 26; fontSize -= 2) {
    context.font = `${fontSize}px ${QURAN_FONT}`;
    lines = wrapLines(text, boxWidth, (line) => context.measureText(line).width);
    if (
      lines.length * fontSize * 1.65 <= defaultBoxHeight &&
      lines.every((line) => context.measureText(line).width <= boxWidth)
    ) return { lines, fontSize, height: CARD_HEIGHT };
  }

  fontSize = 26;
  context.font = `${fontSize}px ${QURAN_FONT}`;
  lines = wrapLines(text, boxWidth, (line) => context.measureText(line).width);
  return {
    lines,
    fontSize,
    height: Math.max(CARD_HEIGHT, Math.ceil(top + lines.length * fontSize * 1.65 + 70 + 272)),
  };
}

function drawContentText(context: CanvasRenderingContext2D, layout: ContentCardLayout): void {
  const top = 300;
  const bottom = layout.height - 272 - 70;
  const centerX = CARD_WIDTH / 2;
  const { fontSize, lines } = layout;
  const lineHeight = fontSize * 1.65;
  const blockHeight = lines.length * lineHeight;
  const firstBaseline = (top + bottom - blockHeight) / 2 + lineHeight * 0.72;
  context.save();
  context.direction = 'rtl';
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  context.fillStyle = PARCHMENT;
  context.font = `${fontSize}px ${QURAN_FONT}`;
  lines.forEach((line, index) => context.fillText(line, centerX, firstBaseline + index * lineHeight));
  context.restore();
}

function drawAyah(context: CanvasRenderingContext2D, text: string, ayahNumber: number): void {
  const boxWidth = AYAH_BOX.right - AYAH_BOX.left;
  const boxHeight = AYAH_BOX.bottom - AYAH_BOX.top;
  const centerX = (AYAH_BOX.left + AYAH_BOX.right) / 2;

  const ayahMarker = `۝${toArabicNumber(ayahNumber)}`;
  const fit = fitAyah(context, text, boxWidth, boxHeight, ayahMarker);

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
    const bracketed =
      `${index === 0 ? '﴿' : ''}${line}` +
      `${index === fit.lines.length - 1 ? `${ayahMarker}﴾` : ''}`;
    context.fillText(bracketed, centerX, firstBaseline + index * lineHeight);
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
  ayahMarker: string,
): { lines: string[]; fontSize: number } {
  const maxFontSize = getAyahFontCeiling(text);
  for (let fontSize = maxFontSize; fontSize >= MIN_AYAH_FONT; fontSize -= FONT_STEP) {
    context.font = `${fontSize}px ${QURAN_FONT}`;
    const lines = fitBracketedLines(context, text, boxWidth, ayahMarker);
    if (
      lines.length * fontSize * LINE_HEIGHT_RATIO <= boxHeight &&
      bracketedLinesFit(context, lines, boxWidth, ayahMarker)
    ) {
      return { lines, fontSize };
    }
  }

  context.font = `${MIN_AYAH_FONT}px ${QURAN_FONT}`;
  return {
    lines: fitBracketedLines(context, text, boxWidth, ayahMarker),
    fontSize: MIN_AYAH_FONT,
  };
}

function fitBracketedLines(
  context: CanvasRenderingContext2D,
  text: string,
  boxWidth: number,
  ayahMarker: string,
): string[] {
  const measure = (line: string) => context.measureText(line).width;
  const openingWidth = measure('﴿');
  const ending = `${ayahMarker}﴾`;
  const endingWidth = measure(ending);
  const lines = wrapLines(text, boxWidth - Math.max(openingWidth, endingWidth), measure);
  if (lines.length !== 1 || measure(`﴿${lines[0]}${ending}`) <= boxWidth) return lines;
  return wrapLines(text, boxWidth - openingWidth - endingWidth, measure);
}

function bracketedLinesFit(
  context: CanvasRenderingContext2D,
  lines: string[],
  boxWidth: number,
  ayahMarker: string,
): boolean {
  if (lines.length === 0) return true;
  const measure = (line: string) => context.measureText(line).width;
  return (
    measure(`﴿${lines[0]}`) <= boxWidth &&
    measure(`${lines[lines.length - 1]}${ayahMarker}﴾`) <= boxWidth
  );
}

/** A gold line with a diamond where the verse ends. */
function drawDivider(context: CanvasRenderingContext2D, centerX: number, dividerY = DIVIDER_Y): void {
  context.save();
  context.strokeStyle = GOLD;
  context.globalAlpha = 0.7;
  context.lineWidth = 2;

  const half = 150;
  const gap = 34;
  context.beginPath();
  context.moveTo(centerX - half, dividerY);
  context.lineTo(centerX - gap, dividerY);
  context.moveTo(centerX + gap, dividerY);
  context.lineTo(centerX + half, dividerY);
  context.stroke();

  context.fillStyle = GOLD_LIGHT;
  context.beginPath();
  context.moveTo(centerX, dividerY - 11);
  context.lineTo(centerX + 11, dividerY);
  context.lineTo(centerX, dividerY + 11);
  context.lineTo(centerX - 11, dividerY);
  context.closePath();
  context.fill();
  context.restore();
}

function drawReference(
  context: CanvasRenderingContext2D,
  surahName: string,
  ayahNumber: number,
): void {
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
  context.fillText('قُرّة · رفيق وردك اليومي', centerX, APP_NAME_BASELINE);
  context.restore();
}

function drawContentReference(
  context: CanvasRenderingContext2D,
  reference: string,
  referenceBaseline: number,
  appNameBaseline: number,
): void {
  const centerX = CARD_WIDTH / 2;
  context.save();
  context.direction = 'rtl';
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  context.fillStyle = GOLD_LIGHT;
  context.font = `700 34px ${UI_FONT}`;
  const lines = wrapLines(reference, 820, (line) => context.measureText(line).width);
  lines.slice(0, 2).forEach((line, index) => {
    context.fillText(line, centerX, referenceBaseline + index * 42);
  });
  context.fillStyle = PARCHMENT_DIM;
  context.globalAlpha = 0.75;
  context.font = `600 30px ${UI_FONT}`;
  context.fillText('قُرّة · رفيق وردك اليومي', centerX, appNameBaseline);
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
export async function shareAyahCard(
  input: AyahShareInput,
  preparedShare?: PreparedAyahShare | null,
): Promise<ShareOutcome> {
  if (typeof navigator === 'undefined' || !navigator.share) {
    if (Capacitor.isNativePlatform() && preparedShare?.nativeUri) {
      try {
        const { Share } = await import('@capacitor/share');
        await Share.share({
          files: [preparedShare.nativeUri],
          text: composeSharePayload(input),
          title: 'رسالة اليوم من القرآن',
          dialogTitle: 'مشاركة آية اليوم',
        });
        return 'shared';
      } catch (error) {
        console.warn('Could not share the Quran message image natively:', error);
        try {
          const { Share } = await import('@capacitor/share');
          await Share.share({ text: composeSharePayload(input), title: 'رسالة اليوم من القرآن' });
          return 'shared';
        } catch (textShareError) {
          console.warn('Could not share the Quran message text natively:', textShareError);
          return copyToClipboard(composeSharePayload(input));
        }
      }
    }
    return copyToClipboard(composeSharePayload(input));
  }

  const payload = composeSharePayload(input);
  const prepared = preparedShare === undefined
    ? await prepareAyahShare(input)
    : preparedShare;
  if (Capacitor.isNativePlatform() && prepared?.nativeUri) {
    try {
      const { Share } = await import('@capacitor/share');
      await Share.share({
        files: [prepared.nativeUri],
        text: payload,
        title: 'رسالة اليوم من القرآن',
        dialogTitle: 'مشاركة آية اليوم',
      });
      return 'shared';
    } catch (error) {
      console.warn('Could not share the Quran message image natively:', error);
    }
  }
  const file = prepared ? toPngFile(prepared.blob, input) : null;

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

export async function shareContentCard(
  input: ContentShareInput,
  preparedShare?: PreparedAyahShare | null,
): Promise<ShareOutcome> {
  const payload = composeContentSharePayload(input);
  const prepared = preparedShare === undefined
    ? await prepareContentShare(input)
    : preparedShare;
  const title = input.title ?? (input.type === 'hadith' ? 'مشاركة حديث نبوي' : 'مشاركة ذكر');

  if (Capacitor.isNativePlatform() && prepared?.nativeUri) {
    try {
      const { Share } = await import('@capacitor/share');
      await Share.share({
        files: [prepared.nativeUri],
        text: payload,
        title,
        dialogTitle: title,
      });
      return 'shared';
    } catch (error) {
      console.warn('Could not share the content image natively:', error);
    }
  }

  if (prepared && typeof navigator !== 'undefined' && navigator.share) {
    try {
      const file = new File([prepared.blob], `${input.type}-share.png`, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: payload, title });
        return 'shared';
      }
    } catch (error) {
      if (isAbortError(error)) return 'cancelled';
    }
  }

  return shareTextOrCopy(payload);
}
