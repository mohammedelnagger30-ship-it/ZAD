import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * The switch that holds the app's type scale steady against the device's.
 *
 * Two levers, because the problem is two-layered. On Android the WebView multiplies every
 * font by the system font scale — the one «الوضع البسيط» and the system font-size slider
 * move — and that multiplication happens natively, after CSS, so no stylesheet can undo
 * it; only `textZoom` can, and only from native code. On the web the same breakage comes
 * from the root font size itself, which `rem` resolves against and which the reader's
 * browser is free to raise; pinning the root at 16px undoes that.
 *
 * The two are applied together under one switch so the reader has one thing to turn on.
 */
interface DisplayScalePlugin {
  setIgnoreSystemFontScale(options: { ignore: boolean }): Promise<void>;
  getSystemFontScale(): Promise<{ scale: number }>;
}

const DisplayScale = registerPlugin<DisplayScalePlugin>('DisplayScale');

/** The attribute `index.css` keys its `html { font-size: 16px }` pin off. */
const PIN_ATTRIBUTE = 'data-system-font';

/** Whether the native side can be reached — Android only; the web lever is CSS. */
export function isDisplayScaleNativeAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('DisplayScale');
}

/**
 * Applies the pin everywhere it can be applied, and reports what it could not.
 *
 * Resolves false only when the native half was expected and refused — a call that lands
 * before the bridge's WebView exists. The web half always lands, so the app still renders
 * at its own scale in a browser.
 */
export async function applySystemFontScale(ignore: boolean): Promise<boolean> {
  if (ignore) {
    document.documentElement.setAttribute(PIN_ATTRIBUTE, 'pinned');
  } else {
    document.documentElement.removeAttribute(PIN_ATTRIBUTE);
  }

  if (!isDisplayScaleNativeAvailable()) return true;

  try {
    await DisplayScale.setIgnoreSystemFontScale({ ignore });
    return true;
  } catch (error) {
    console.warn('Could not pin the WebView text scale:', error);
    return false;
  }
}

/**
 * The system's own font scale, so Settings can say whether the switch is doing anything.
 * 1.0 means the device is already at its default, and the pin is a no-op there.
 * Null where it cannot be read — the web, or a bridge that is not up yet.
 */
export async function readSystemFontScale(): Promise<number | null> {
  if (!isDisplayScaleNativeAvailable()) return null;
  try {
    const { scale } = await DisplayScale.getSystemFontScale();
    return typeof scale === 'number' && Number.isFinite(scale) ? scale : null;
  } catch {
    return null;
  }
}
