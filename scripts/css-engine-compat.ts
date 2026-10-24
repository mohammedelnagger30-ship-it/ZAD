/**
 * CSS output normalisation for the engines this app actually ships to.
 *
 * Tailwind v4 is written for evergreen browsers and emits constructs that older engines
 * reject wholesale — not partially, but as invalid declarations or invalid media rules,
 * so everything hanging off them silently disappears:
 *
 *   - `@media (width >= 48rem)` — range syntax, Chrome 104+. Every responsive rung stops
 *     applying, so a tablet renders the phone layout at every size.
 *   - `color-mix(in oklab, …)` — Chrome 111+. Every alpha utility (`bg-white/90`,
 *     `border-primary-100/80`, …) computes to nothing and the element goes transparent.
 *   - `oklch(…)` — the default Tailwind palette is authored in oklch, Chrome 111+. A red
 *     badge and an invisible badge are the same declaration to an older engine.
 *   - `translate: x y` — the property form, Chrome 104+, so `-translate-x-1/2` no longer
 *     centres anything and the bottom nav drifts off the edge of the screen.
 *   - `linear-gradient(… in oklab, …)` — Chrome 111+, and not just the interpolation:
 *     the whole `background-image` is dropped, so the hero card and the icon tiles paint
 *     nothing at all. Tailwind guards its newer `bg-linear-*` spelling against this but
 *     emits the older `bg-gradient-to-*` one bare.
 *   - `90dvh` — Chrome 108+, so a dialog written with a dynamic viewport height has no
 *     height at all.
 *
 * The build target is a Capacitor WebView, where the engine is whatever device carries it
 * — the reference device here runs Chrome 101. Rather than abandon those readers, this
 * plugin rewrites the emitted stylesheet into equivalent declarations the older engine
 * does understand. Each rewrite is also understood by modern engines, so the design is
 * unchanged where the modern form was working already.
 *
 * It runs on the bundle's CSS assets only, after Tailwind has generated them. The theme's
 * source stylesheet is read alongside them, for the names of the tokens it defines — see
 * lowerPaletteTokens.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* ------------------------------------------------------------------ *
 * colour parsing
 * ------------------------------------------------------------------ */

/** `#rgb` / `#rrggbb` → [r, g, b] in 0-255, or null for anything else. */
function hexToRgb(hex: string): [number, number, number] | null {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (short) return [parseInt(short[1] + short[1], 16), parseInt(short[2] + short[2], 16), parseInt(short[3] + short[3], 16)];
  if (long) return [parseInt(long[1], 16), parseInt(long[2], 16), parseInt(long[3], 16)];
  return null;
}

/** Cone response (LMS) to the 0-255 sRGB the engine has always understood. */
function lmsToSrgb(l_: number, m_: number, s_: number): [number, number, number] {
  const linear = [
    +4.0767416621 * l_ ** 3 - 3.3077115913 * m_ ** 3 + 0.2309699292 * s_ ** 3,
    -1.2684380046 * l_ ** 3 + 2.6097574011 * m_ ** 3 - 0.3413193965 * s_ ** 3,
    -0.0041960863 * l_ ** 3 - 0.7034186147 * m_ ** 3 + 1.707614701 * s_ ** 3,
  ];

  const srgb = linear.map((channel) => {
    const clipped = Math.min(1, Math.max(0, channel));
    const gamma = clipped <= 0.0031308 ? 12.92 * clipped : 1.055 * clipped ** (1 / 2.4) - 0.055;
    return Math.round(gamma * 255);
  });

  return [srgb[0], srgb[1], srgb[2]];
}

/**
 * `oklab(L a b)` → sRGB, clipped into gamut.
 *
 * A colour authored near the gamut edge can shift by a hair; that is a far smaller wrong
 * than the engine dropping the declaration and painting nothing at all.
 */
export function oklabToRgb(lightness: number, a: number, b: number): [number, number, number] {
  const l_ = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = lightness - 0.0894841775 * a - 1.291485548 * b;

  return lmsToSrgb(l_, m_, s_);
}

export function oklchToRgb(lightness: number, chroma: number, hueDeg: number): [number, number, number] {
  const h = (hueDeg * Math.PI) / 180;
  return oklabToRgb(lightness, chroma * Math.cos(h), chroma * Math.sin(h));
}

const OKLCH_RE = /oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)/gi;

/**
 * Every oklch literal becomes its sRGB equivalent, in place.
 *
 * The values this app uses all sit inside the sRGB gamut, so a modern engine paints the
 * same colour from either form; rewriting rather than overriding means there is one value
 * in the stylesheet and no engine has to be singled out.
 */
export function replaceOklchLiterals(css: string): string {
  return css.replace(OKLCH_RE, (_whole, l: string, c: string, h: string) => {
    const [r, g, b] = oklchToRgb(parseFloat(l) / 100, parseFloat(c), parseFloat(h));
    return `rgb(${r} ${g} ${b})`;
  });
}

/** The alpha as authored: `oklab(…/.9)`, `oklab(…/90%)`, `oklab(…)`. */
function alphaSuffix(value: string | undefined, percent: string | undefined): string {
  if (value === undefined) return '';
  const alpha = parseFloat(value);
  return ` / ${percent ? alpha / 100 : alpha}`;
}

const OKLAB_RE = /oklab\(\s*([\d.]+)(%?)\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)\s*(?:\/\s*([\d.]+)(%?)\s*)?\)/gi;

/**
 * Every `oklab()` literal becomes its sRGB equivalent, in place.
 *
 * Tailwind reaches for this function whenever it can work a colour out at build time: an
 * alpha utility over one of the *fixed* theme colours (`bg-white/90`, the amber and rose
 * accents) is emitted as a single `oklab(…)` declaration, with no color-mix and no
 * fallback beside it. To an engine without oklab that declaration is invalid, so the
 * element is painted nothing at all — a card with no surface, a highlight with no tint.
 * The same colour written in sRGB is understood by every engine, and modern engines paint
 * the identical value from it.
 */
export function replaceOklabLiterals(css: string): string {
  return css.replace(OKLAB_RE, (whole, l: string, lPct: string, a: string, b: string, alpha?: string, alphaPct?: string) => {
    const lightness = parseFloat(l) / (lPct ? 100 : 1);
    const [r, g, bl] = oklabToRgb(lightness, parseFloat(a), parseFloat(b));
    // An out-of-range component means this was not a colour we can express; leave it be.
    if (![r, g, bl].every((channel) => Number.isFinite(channel))) return whole;
    return `rgb(${r} ${g} ${bl}${alphaSuffix(alpha, alphaPct)})`;
  });
}

/* ------------------------------------------------------------------ *
 * media queries
 * ------------------------------------------------------------------ */

/** Step a size just under its own value, so a strict upper bound does not bite twice. */
function justUnder(value: string): string {
  const rem = /^([\d.]+)rem$/.exec(value);
  if (rem) return `${parseFloat((parseFloat(rem[1]) - 0.02).toFixed(2))}rem`;
  const px = /^([\d.]+)px$/.exec(value);
  if (px) return `${parseFloat((parseFloat(px[1]) - 0.02).toFixed(2))}px`;
  return value;
}

/**
 * `@media (width >= 48rem)` → `@media (min-width: 48rem)`.
 *
 * This is the one construct where rejection costs far more than a style: the media rule
 * itself is discarded, so every responsive rung in the app — the tablet rail, the
 * multi-column grids, the larger type sizes — stops existing on that engine at once. The
 * classic form has been understood for as long as anyone has written media queries.
 */
export function rewriteRangeMediaQueries(css: string): string {
  return css.replace(/@media\s*\(\s*width\s*(>=|>|<=|<)\s*([^)]+)\)/g, (_whole, op: string, value: string) => {
    const size = value.trim();
    switch (op) {
      case '>=':
      case '>':
        return `@media (min-width:${size})`;
      case '<=':
        return `@media (max-width:${size})`;
      default:
        return `@media (max-width:${justUnder(size)})`;
    }
  });
}

/* ------------------------------------------------------------------ *
 * translate
 * ------------------------------------------------------------------ */

/**
 * `translate: x y` is also written as `transform: translate(x, y)`.
 *
 * Tailwind reaches for the two variables it sets up for this purpose, and those are what
 * the fallback names too — an engine that understands neither the property form nor the
 * variables gets nothing, and an engine that understands both applies the same movement
 * twice in the same direction, which is the same movement once. The `0px` defaults are
 * for the case where only one of the two axes is being set.
 *
 * The two properties are not alternatives: a browser that understands both applies them
 * one after the other, so writing the fallback beside the modern declaration moves the
 * element twice as far as it was meant to go. Guarding the fallback with a feature test
 * hands each engine exactly one of the two.
 *
 * The companion rule is spliced in immediately after the rule it belongs to, so it lands
 * inside the same media and supports context, and it reads the axis values out of that
 * rule rather than the variables Tailwind reaches for — an engine old enough to miss
 * `translate` may also miss `@property`, and an unset variable would invalidate the whole
 * declaration there.
 */
export function addTranslateFallbacks(css: string): string {
  const edits: Array<{ at: number; text: string }> = [];

  for (const rule of scanRules(css)) {
    // A keyframe step is not an element: `0%{translate:…}` moves nothing on its own.
    if (rule.atRules.some((at) => /keyframes/.test(at))) continue;

    // A declaration, not a property named in a value.
    const declared = /(?:^|;)\s*translate\s*:\s*([^;}]+)/.exec(rule.body);
    if (!declared) continue;

    // An authored transform would be replaced by ours rather than joined to it; better to
    // leave that rule as it is than to drop what it was doing.
    if (/(^|[;{])transform\s*:/.test(rule.body)) continue;

    const x = /--tw-translate-x\s*:\s*([^;}]+)/.exec(rule.body)?.[1]?.trim();
    const y = /--tw-translate-y\s*:\s*([^;}]+)/.exec(rule.body)?.[1]?.trim();
    const literal = x || y ? [x ?? '0px', y ?? '0px'] : (() => {
      // A bare `0` is a valid length, but the fallbacks are written with units everywhere
      // else, so the zero axis is spelled `0px` here too.
      const axis = (value?: string) =>
        value !== undefined && /^-?0(\.0+)?$/.test(value) ? '0px' : value ?? '0px';
      const parts = declared[1].split(/\s+/);
      return [axis(parts[0]), axis(parts[1])];
    })();

    edits.push({
      at: rule.closeAt + 1,
      text: `@supports not (translate:1px){${rule.selector}{transform:translate(${literal[0]},${literal[1]})}}`,
    });
  }

  // Splice from the end so earlier insertions do not move the positions still to come.
  let out = css;
  for (const edit of edits.sort((a, b) => b.at - a.at)) {
    out = out.slice(0, edit.at) + edit.text + out.slice(edit.at);
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * reading the stylesheet as a stylesheet
 * ------------------------------------------------------------------ */

type ScannedRule = {
  selector: string;
  body: string;
  openAt: number;
  closeAt: number;
  /** The at-rules this rule sits inside, outermost first. */
  atRules: string[];
};

/**
 * Every style rule in the stylesheet, with the at-rule context it sits in.
 *
 * Several of the rewrites below need to know more than a value: which selector a
 * declaration belongs to, and whether that rule is already inside a feature test. A regex
 * cannot answer either without being fooled by the next rule along, so the stylesheet is
 * walked once, brace by brace, the way an engine reads it.
 */
function scanRules(css: string): ScannedRule[] {
  type Frame = { selector: string; isAtRule: boolean; openAt: number; outerAtRules: string[] };

  const stack: Frame[] = [];
  const closed: ScannedRule[] = [];
  let lastBoundary = 0;

  for (let i = 0; i < css.length; i++) {
    const c = css[i];

    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      if (end === -1) break;
      i = end + 1;
      continue;
    }

    // A backslash escapes whatever follows it, and selectors are full of them:
    // `font-\[Amiri_Quran\'\,_serif\]` is a class name, not a quoted string, and reading
    // its apostrophe as the start of one would swallow the rest of the stylesheet.
    if (c === '\\') {
      i++;
      continue;
    }

    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < css.length && css[i] !== quote) {
        if (css[i] === '\\') i++;
        i++;
      }
      continue;
    }

    if (c === '{') {
      const selector = css.slice(lastBoundary, i).trim();
      const parent = stack[stack.length - 1];
      stack.push({
        selector,
        isAtRule: selector.startsWith('@'),
        openAt: i,
        outerAtRules: parent ? [...parent.outerAtRules, ...(parent.isAtRule ? [parent.selector] : [])] : [],
      });
      lastBoundary = i + 1;
      continue;
    }

    if (c === '}') {
      const frame = stack.pop();
      lastBoundary = i + 1;
      if (frame && !frame.isAtRule) {
        closed.push({
          selector: frame.selector,
          body: css.slice(frame.openAt + 1, i),
          openAt: frame.openAt,
          closeAt: i,
          atRules: frame.outerAtRules,
        });
      }
      continue;
    }
  }

  return closed;
}

/** Split on a separator that is not inside parentheses. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }

  parts.push(text.slice(start));
  return parts;
}

/** The custom properties a rule declares, the last value of a name winning. */
function customProperties(body: string): Map<string, string> {
  const out = new Map<string, string>();

  for (const chunk of splitTopLevel(body, ';')) {
    const colon = chunk.indexOf(':');
    if (colon <= 0) continue;
    const name = chunk.slice(0, colon).trim();
    if (!name.startsWith('--')) continue;
    out.set(name, chunk.slice(colon + 1).trim());
  }

  return out;
}

/** Every `name(…)` in the stylesheet, parentheses balanced, as written. */
function findFunctionValues(css: string, name: string): string[] {
  const out: string[] = [];
  const needle = `${name}(`;
  let i = css.indexOf(needle);

  while (i !== -1) {
    let depth = 0;
    let j = i + name.length;
    for (; j < css.length; j++) {
      if (css[j] === '(') depth++;
      else if (css[j] === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    if (j >= css.length) break;
    out.push(css.slice(i, j + 1));
    i = css.indexOf(needle, j + 1);
  }

  return out;
}

const normalise = (value: string) => value.replace(/\s+/g, ' ').trim();

/** `#rrggbb` or `rgb(r g b)` as channels — a colour that does not depend on anything. */
function staticChannels(value: string): [number, number, number] | null {
  const hex = hexToRgb(value.trim());
  if (hex) return hex;

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*\)$/.exec(value.trim());
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

/** `19 108 53` — the channels a palette token carries for `rgb(var(--primary-700))`. */
function channelsOf(value: string): [number, number, number] | null {
  const m = /^(\d+)\s+(\d+)\s+(\d+)$/.exec(value.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/* ------------------------------------------------------------------ *
 * palette-derived colours
 * ------------------------------------------------------------------ */

/**
 * `color-mix(in srgb, A p%, B q%)` split into its parts.
 *
 * Only the sRGB space is understood: mixing in oklab is a different sum, and an engine
 * old enough to lack color-mix has no way to be told which one it is looking at — so a
 * mix authored in oklab is left alone rather than guessed at.
 */
function parseMix(formula: string): { space: string; a: { color: string; pct: number }; b: { color: string; pct: number } } | null {
  const open = formula.indexOf('(');
  if (open === -1 || !formula.endsWith(')')) return null;

  const args = splitTopLevel(formula.slice(open + 1, -1), ',').map((part) => part.trim());
  if (args.length !== 3) return null;

  const space = /^in\s+([\w-]+)$/.exec(args[0])?.[1];
  if (!space) return null;

  const operand = (part: string): { color: string; pct: number | null } | null => {
    const m = /^([\s\S]*?)\s+([\d.]+)%$/.exec(part);
    return m ? { color: m[1].trim(), pct: parseFloat(m[2]) } : part ? { color: part, pct: null } : null;
  };

  const aOperand = operand(args[1]);
  const bOperand = operand(args[2]);
  if (!aOperand || !bOperand) return null;

  // A percentage given to one side is taken off the other; both sides even if neither is.
  const aPct = aOperand.pct ?? (bOperand.pct === null ? 50 : 100 - bOperand.pct);
  const bPct = bOperand.pct ?? 100 - aPct;

  return { space, a: { color: aOperand.color, pct: aPct }, b: { color: bOperand.color, pct: bPct } };
}

/** A colour expression that does not depend on the palette, as channels. */
function resolveChannels(value: string, env: Map<string, string>, depth = 0): [number, number, number] | null {
  if (depth > 4) return null;
  const name = value.trim();

  const literal = staticChannels(name);
  if (literal) return literal;

  const asNumbers = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[/,]\s*([\d.]+%?))?\s*\)$/.exec(name);
  if (asNumbers) {
    // A translucent colour is a wash over whatever is behind it, and mixing that here
    // would flatten it into something else entirely.
    const alpha = asNumbers[4];
    if (alpha !== undefined && !/^(1|100%)$/.test(alpha)) return null;
    return [Number(asNumbers[1]), Number(asNumbers[2]), Number(asNumbers[3])];
  }

  const channelToken = /^rgb\(\s*var\(\s*(--[\w-]+)\s*\)\s*\)$/.exec(name);
  if (channelToken) {
    const declared = env.get(channelToken[1]);
    if (declared === undefined) return null;
    return channelsOf(declared) ?? resolveChannels(declared, env, depth + 1);
  }

  const varToken = /^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+?))?\s*\)$/.exec(name);
  if (varToken) {
    const declared = env.get(varToken[1]);
    if (declared !== undefined) {
      const resolved = resolveChannels(declared, env, depth + 1);
      if (resolved) return resolved;
    }
    return varToken[2] === undefined ? null : resolveChannels(varToken[2], env, depth + 1);
  }

  return null;
}

/** The colour a mix paints, once every token in it is known for this palette. */
function evaluateMix(formula: string, env: Map<string, string>): [number, number, number] | null {
  const mix = parseMix(formula);
  if (!mix || mix.space !== 'srgb') return null;

  const a = resolveChannels(mix.a.color, env);
  const b = resolveChannels(mix.b.color, env);
  if (!a || !b) return null;

  const total = mix.a.pct + mix.b.pct;
  if (total <= 0) return null;

  return [0, 1, 2].map((i) => Math.round((a[i] * mix.a.pct + b[i] * mix.b.pct) / total)) as [number, number, number];
}

/** The dark-mode selector that matches the same element as this palette selector. */
function darkSelectorOf(selector: string): string {
  return selector === ':root' ? 'html.dark' : selector.replace(/^:root/, 'html.dark');
}

/**
 * Work out every palette-dependent mix now, and give each swatch the value it earned.
 *
 * The theme paints its neutrals by mixing a fixed paper tone with the *current* palette
 * (`gray-500` is 90% warm grey and 10% of whatever green is being used), and it paints its
 * panels the same way. color-mix is the only way to say that in one declaration, and the
 * engines this app ships to do not have it — for them the panels, the sidebars and the
 * whole grey ramp resolve to nothing at all.
 *
 * The value, though, is fully determined at build time: the palettes are a fixed list, and
 * each one's channels are printed in this very stylesheet. So every such formula is worked
 * out once per palette and written out as channels on that palette's own selector —
 * `--qran-<name>` — and the formula becomes `rgb(var(--qran-<name>))`. A modern engine
 * paints exactly the colour it painted before, a legacy engine paints the same one instead
 * of nothing, and the palette switcher still works, because the value it reads is the
 * palette's.
 */
export function lowerPaletteTokens(css: string, sourceCss = ''): string {
  const rules = scanRules(css);

  // The theme's fixed colours (`--color-white: #fffdf9`), and the palette tokens, which
  // each root scope redefines.
  const globals = new Map<string, string>();
  const palettes = new Map<string, Map<string, string>>();

  for (const rule of rules) {
    const props = customProperties(rule.body);
    const isRoot = /(^|,)\s*:root\b/.test(rule.selector);

    for (const [name, value] of props) {
      if (!globals.has(name) && (staticChannels(value) ?? channelsOf(value))) globals.set(name, value);
    }

    if (!isRoot) continue;
    if (![...props.keys()].some((name) => /^--primary-\d+$/.test(name))) continue;

    const env = palettes.get(rule.selector) ?? new Map(globals);
    for (const [name, value] of props) env.set(name, value);
    palettes.set(rule.selector, env);
  }

  if (palettes.size === 0) return css;

  // Tokens the theme defines twice, once for each colour scheme: the pair has to stay a
  // pair, or the dark value would be the one every engine read.
  const lightDefinition = new Map<string, string>();
  const darkDefinition = new Map<string, string>();
  for (const rule of rules) {
    const isDark = rule.selector.startsWith('html.dark');
    if (!isDark && rule.selector !== ':root') continue;
    for (const [name, value] of customProperties(rule.body)) {
      if (!value.includes('color-mix(')) continue;
      (isDark ? darkDefinition : lightDefinition).set(name, value);
    }
  }

  // A readable name for each formula, so the generated tokens can be found in devtools.
  const namesByFormula = new Map<string, string>();
  for (const m of sourceCss.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)) {
    if (!m[2].includes('color-mix(')) continue;
    if (!namesByFormula.has(normalise(m[2]))) namesByFormula.set(normalise(m[2]), m[1].replace(/^--/, ''));
  }

  type Generated = { name: string; light: Map<string, [number, number, number]>; dark: Map<string, [number, number, number]> };
  const generated: Generated[] = [];
  let out = css;
  let counter = 0;

  for (const formula of [...new Set(findFunctionValues(css, 'color-mix'))]) {
    const mix = parseMix(formula);
    if (!mix) continue;
    // A formula that is the dark-mode counterpart of an already-paired token must
    // not be processed on its own: it would otherwise overwrite the light token
    // with its dark value (see darkDefinition pairing above).
    if ([...darkDefinition.values()].some((value) => normalise(value) === normalise(formula))) continue;
    // The alpha form is the flattening pass's job, not this one.
    if (mix.a.color === 'transparent' || mix.b.color === 'transparent') continue;

    const light = new Map<string, [number, number, number]>();
    for (const [selector, env] of palettes) {
      const value = evaluateMix(formula, env);
      if (!value) break;
      light.set(selector, value);
    }
    if (light.size !== palettes.size) continue;

    const tokenName = [...lightDefinition.entries()].find(([, value]) => normalise(value) === normalise(formula))?.[0];
    const darkFormula = tokenName ? darkDefinition.get(tokenName) : undefined;
    const dark = new Map<string, [number, number, number]>();
    if (darkFormula) {
      for (const [selector, env] of palettes) {
        const value = evaluateMix(darkFormula, env);
        if (!value) break;
        dark.set(selector, value);
      }
      if (dark.size !== palettes.size) dark.clear();
    }

    const distinct = new Set([...light.values()].map((value) => value.join(' ')));
    const name = namesByFormula.get(normalise(formula)) ?? tokenName?.replace(/^--/, '') ?? `mix-${++counter}`;

    // One colour for every swatch needs no variable at all — unless the scheme changes it.
    if (distinct.size === 1 && dark.size === 0) {
      out = out.split(formula).join(`rgb(${[...distinct][0]})`);
      continue;
    }

    const reference = `rgb(var(--qran-${name}))`;
    out = out.split(formula).join(reference);
    if (darkFormula) out = out.split(darkFormula).join(reference);
    generated.push({ name, light, dark });
  }

  if (generated.length === 0) return out;

  const lightBlocks: string[] = [];
  const darkBlocks: string[] = [];
  for (const selector of palettes.keys()) {
    const light = generated
      .filter((token) => token.light.has(selector))
      .map((token) => `--qran-${token.name}:${token.light.get(selector)!.join(' ')}`);
    if (light.length) lightBlocks.push(`${selector}{${light.join(';')}}`);

    const dark = generated
      .filter((token) => token.dark.has(selector))
      .map((token) => `--qran-${token.name}:${token.dark.get(selector)!.join(' ')}`);
    if (dark.length) darkBlocks.push(`${darkSelectorOf(selector)}{${dark.join(';')}}`);
  }

  return out + lightBlocks.join('') + darkBlocks.join('');
}

/* ------------------------------------------------------------------ *
 * gradient interpolation and viewport units
 * ------------------------------------------------------------------ */

/**
 * `linear-gradient(to bottom right in oklab, …)` → the same gradient in sRGB, with the
 * oklab form kept behind the feature test that understands it.
 *
 * Tailwind writes that guard itself for the `bg-linear-*` spelling, but the older
 * `bg-gradient-to-*` name — still the one this app uses — is emitted bare. An engine that
 * cannot parse the interpolation hint does not lose the hint, it loses the whole
 * background-image: the hero card, the quick-action tile and the icon badge paint nothing
 * at all, which is what a white page and an invisible white icon look like.
 */
export function preserveGradientInterpolation(css: string): string {
  let out = css;

  for (const rule of [...scanRules(css)].sort((a, b) => b.openAt - a.openAt)) {
    // Tailwind's own guarded form is already correct: the plain value sits outside the
    // feature test and the oklab value inside it.
    if (rule.atRules.some((at) => at.includes('linear-gradient(in lab'))) continue;

    const position = /--tw-gradient-position\s*:\s*([^;}]+?)\s+in\s+oklab\b/.exec(rule.body);
    if (!position) continue;

    const plain = position[1].trim();
    const body = rule.body.replace(position[0], `--tw-gradient-position:${plain}`);
    const companion = `@supports (background-image:linear-gradient(in lab, red, red)){${rule.selector}{--tw-gradient-position:${plain} in oklab}}`;

    out = out.slice(0, rule.openAt + 1) + body + out.slice(rule.closeAt) + companion;
  }

  return out;
}

const VIEWPORT_UNITS = /\b\d*\.?\d+(?:dvh|svh|lvh)\b/g;

/**
 * `max-height:90dvh` → `max-height:90vh;max-height:90dvh`.
 *
 * The dynamic viewport units are Chrome 108+, and where they are unknown the declaration
 * is dropped — a dialog with no maximum height can then grow past the bottom of the
 * screen. A plain declaration in front is all that is needed here, because unlike a
 * custom property the engine that cannot parse the second value simply keeps the first.
 */
export function addViewportUnitFallbacks(css: string): string {
  return css.replace(
    /([;{]\s*)([a-z-]+)\s*:\s*([^;{}]*\b\d*\.?\d+(?:dvh|svh|lvh)\b[^;{}]*)/gi,
    (whole, boundary: string, property: string, value: string) => {
      if (property.startsWith('--')) return whole;

      const fallback = value.replace(VIEWPORT_UNITS, (unit) => unit.replace(/[dsl]vh$/, 'vh'));
      return fallback === value ? whole : `${boundary}${property}:${fallback};${property}:${value}`;
    }
  );
}

/* ------------------------------------------------------------------ *
 * color-mix
 * ------------------------------------------------------------------ */

/** Every definition of a custom property, in document order. */
function colourDefinitions(css: string, name: string): string[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const out: string[] = [];

  for (const match of css.matchAll(new RegExp(`${escaped}\\s*:\\s*([^;{}]+)`, 'g'))) {
    out.push(match[1].trim());
  }

  return out;
}

/**
 * Express a colour at an alpha without color-mix.
 *
 * The point of keeping `var()` where one is in play is the palette switcher: the app
 * redefines `--primary-900` and friends at runtime, and resolving to a literal here
 * would paint every legacy device the swatch it had when the stylesheet was built. A
 * channel variable survives the switch; a hex does not.
 *
 * Some of the theme's own tokens are hexes, though (`--brand-from` is one per palette),
 * and a hex cannot carry an alpha. Writing out a channel twin beside each definition —
 * `--brand-from-rgb: 31 115 78`, done in addChannelTwins — gives those the same reach.
 * The names that need one are collected here, because whether a token varies at all is
 * only knowable once its definitions have been compared.
 *
 * Returns null when the colour cannot be expressed, so the caller can leave the
 * original declaration alone rather than guess wrong.
 */
function withAlpha(css: string, color: string, alpha: number, depth = 0, twins?: Set<string>): string | null {
  if (depth > 4) return null;
  const name = color.trim();

  const literal = hexToRgb(name);
  if (literal) return `rgb(${literal[0]} ${literal[1]} ${literal[2]} / ${alpha})`;

  // `rgb(var(--primary-900))` — the app's own palette tokens carry their channels in a
  // variable, which is exactly what must keep working after a swatch change.
  const channelToken = /^rgb\(\s*var\(\s*(--[\w-]+)\s*\)\s*\)$/.exec(name);
  if (channelToken) return `rgb(var(${channelToken[1]}) / ${alpha})`;

  const plain = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*\)$/.exec(name);
  if (plain) return `rgb(${plain[1]} ${plain[2]} ${plain[3]} / ${alpha})`;

  const varToken = /^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+?))?\s*\)$/.exec(name);
  if (varToken) {
    const declared = colourDefinitions(css, varToken[1]);

    const channel = declared
      .map((value) => /^rgb\(\s*var\(\s*(--[\w-]+)\s*\)\s*\)$/.exec(value)?.[1])
      .find((value): value is string => value !== undefined);
    if (channel) return `rgb(var(${channel}) / ${alpha})`;

    const literals = declared.map(staticChannels);
    if (declared.length > 0 && literals.every((value): value is [number, number, number] => value !== null)) {
      const distinct = [...new Set(literals.map((value) => value.join(' ')))];
      if (distinct.length === 1) return `rgb(${distinct[0]} / ${alpha})`;

      // The swatches disagree, so the token itself has to survive; its channel twin,
      // emitted with the token's own fallback for engines that never read the definition,
      // carries the alpha.
      if (twins) {
        twins.add(varToken[1].replace(/^--/, ''));
        return `rgb(var(${varToken[1]}-rgb, ${literals[0].join(' ')}) / ${alpha})`;
      }
      return null;
    }

    if (varToken[2] !== undefined) return withAlpha(css, varToken[2], alpha, depth + 1, twins);
  }

  return null;
}

/**
 * `color-mix(in oklab, <color> <pct>%, transparent)` → `rgb(r g b / pct)`.
 *
 * Every alpha utility in the stylesheet is one of these, and the engines this app ships
 * to do not have color-mix at all — but Tailwind knows that, and already writes each one
 * twice: a fallback at full opacity, then the mix inside `@supports`. What the legacy
 * engine gets instead of a 30% wash is therefore a solid block of colour, which is worse
 * than the wash it never sees. Flattening the mix gives every engine the same value, and
 * the rewritten form is understood by the engines that support color-mix too, so no one
 * has to choose between the two.
 *
 * The mix Tailwind writes for `shadow-<colour>` is the same idea one step further: the
 * colour already carries the alpha, and `var(--tw-shadow-alpha)` only multiplies it by a
 * value that is 100% unless something else in the page has changed it — which nothing in
 * this app does. Dropping the multiplication leaves the colour, which every engine reads.
 */
export function flattenColorMix(css: string, twins?: Set<string>): string {
  let out = css;

  // The mix Tailwind writes for `shadow-<colour>`: the colour already carries the alpha,
  // and `var(--tw-shadow-alpha)` only multiplies it by a value that is 100% unless
  // something else in the page has changed it — which nothing in this app does. Dropping
  // the multiplication leaves the colour, which every engine reads; the nested form is
  // then a plain alpha wash, and the pass below takes care of it.
  for (const formula of new Set(findFunctionValues(out, 'color-mix'))) {
    const mix = parseMix(formula);
    if (!mix || mix.b.color !== 'transparent') continue;

    const colour = /^([\s\S]*?)\s+var\(--tw-shadow-alpha[^)]*\)$/.exec(mix.a.color)?.[1]?.trim();
    if (colour) out = out.split(formula).join(colour);
  }

  // Every remaining `… <colour> <pct>%, transparent` is a colour at an alpha.
  for (const formula of new Set(findFunctionValues(out, 'color-mix'))) {
    const mix = parseMix(formula);
    if (!mix) continue;
    if (mix.a.color === 'transparent' || mix.b.color !== 'transparent') continue;

    const rewritten = withAlpha(out, mix.a.color, mix.a.pct / 100, 0, twins);
    if (rewritten) out = out.split(formula).join(rewritten);
  }

  return out;
}

/**
 * Give every token named above a channel twin, in each scope that paints it.
 *
 * `--brand-from: #15803d` cannot be written at 10% — an alpha needs channels — so beside
 * it goes `--brand-from-rgb: 21 128 61`, in every scope that defines the hex, and the
 * flattened declaration reads the twin. Because the twin is emitted where the hex is, a
 * swatch change moves both at once.
 */
export function addChannelTwins(css: string, names: Set<string>): string {
  if (names.size === 0) return css;

  let out = css;
  const edits: Array<{ at: number; text: string }> = [];

  for (const rule of scanRules(css)) {
    const props = customProperties(rule.body);
    const additions: string[] = [];

    for (const name of names) {
      const value = props.get(`--${name}`);
      if (!value || props.has(`--${name}-rgb`)) continue;
      const channels = staticChannels(value);
      if (channels) additions.push(`--${name}-rgb:${channels.join(' ')}`);
    }

    if (additions.length) edits.push({ at: rule.closeAt, text: `;${additions.join(';')}` });
  }

  // Splice from the end so earlier insertions do not move the positions still to come.
  for (const edit of edits.sort((a, b) => b.at - a.at)) {
    out = out.slice(0, edit.at) + edit.text + out.slice(edit.at);
  }

  return out;
}

/**
 * `@supports (color: color-mix(in lab, red, red))` → a condition every engine passes.
 *
 * Tailwind guards each mix with a feature test, which is the right thing to do until the
 * value inside has been flattened to plain rgb(). From there the test only has one effect
 * left: on an engine that fails it, the block is skipped and the full-opacity fallback
 * below takes over — precisely the wrong colour. Opening the condition hands the flattened
 * value to every engine, and any mix inside that could not be flattened stays invalid and
 * is dropped by the parser, falling back exactly as it did before.
 */
export function openColorMixSupports(css: string): string {
  return css.replace(/@supports\s*\(color:\s*color-mix\([^)]*\)\s*\)/g, '@supports (color:red)');
}

/* ------------------------------------------------------------------ *
 * entry points
 * ------------------------------------------------------------------ */

export function processCss(css: string, sourceCss = ''): string {
  let out = css;

  out = replaceOklchLiterals(out);
  out = replaceOklabLiterals(out);
  out = rewriteRangeMediaQueries(out);

  // The palette work comes first: flattening an alpha over a token only works once the
  // token is a plain colour rather than a mix of the palette.
  out = lowerPaletteTokens(out, sourceCss);

  const twins = new Set<string>();
  out = flattenColorMix(out, twins);
  out = addChannelTwins(out, twins);

  out = preserveGradientInterpolation(out);
  out = addViewportUnitFallbacks(out);
  out = openColorMixSupports(out);
  out = addTranslateFallbacks(out);

  return out;
}

/**
 * Vite plugin: rewrite the CSS assets in the bundle, leaving everything else alone.
 *
 * Nothing about the output is re-named: the stylesheet keeps the name the bundler gave
 * it, so every reference to it — the page, the chunks, the service worker manifest — stays
 * valid without anyone having to chase them. What keeps a changed stylesheet reaching a
 * device that already cached the old one is the precache revision on the service-worker
 * side (see vite.config.ts), which is computed from these final bytes.
 */
export function cssEngineCompat(options: { sourceCss?: string; sourceFile?: string } = {}) {
  let sourceCss = options.sourceCss ?? '';
  let root = '.';

  return {
    name: 'qran:css-engine-compat',
    enforce: 'post' as const,

    configResolved(config: { root: string }) {
      root = config.root;
    },

    buildStart() {
      if (sourceCss) return;
      try {
        sourceCss = readFileSync(resolve(root, options.sourceFile ?? 'src/index.css'), 'utf8');
      } catch {
        // Only the *names* of the theme's own tokens come from the source, so the tokens
        // generated from the palette can be read in devtools. Without the file they are
        // numbered instead of named, and nothing else about the output changes.
      }
    },

    generateBundle(
      _options: unknown,
      bundle: Record<string, { type: string; fileName: string; source?: string | Uint8Array }>
    ) {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'asset' || !file.fileName.endsWith('.css') || typeof file.source !== 'string') continue;

        const before = file.source;
        const after = processCss(before, sourceCss);

        // A rewrite that unbalances a block would nest the rest of the stylesheet inside
        // it and drop most of it in every engine — worse than no rewrite at all. The
        // rewrite adds balanced rules of its own, so what matters is the balance, not
        // the raw count. Fail the build rather than ship an imbalance.
        const balance = (text: string) =>
          (text.match(/\{/g) ?? []).length - (text.match(/\}/g) ?? []).length;
        if (balance(before) !== balance(after)) {
          throw new Error(
            `qran:css-engine-compat left an unbalanced block in ${file.fileName}; the stylesheet was not rewritten`
          );
        }

        file.source = after;
      }
    },
  };
}
