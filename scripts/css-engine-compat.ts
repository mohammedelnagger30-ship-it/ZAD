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
 *
 * The build target is a Capacitor WebView, where the engine is whatever the device
 * carries — the reference device here runs Chrome 101. Rather than abandon those readers,
 * this plugin rewrites the emitted stylesheet into equivalent declarations the older
 * engine does understand. Each rewrite is also understood by modern engines, so the
 * design is unchanged where the modern form was working already.
 *
 * It runs on the bundle's CSS assets only, after Tailwind has generated them.
 */

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

/**
 * `oklch(L C H)` → sRGB, clipped into gamut.
 *
 * A colour authored near the gamut edge can shift by a hair; that is a far smaller wrong
 * than the engine dropping the declaration and painting nothing at all.
 */
export function oklchToRgb(lightness: number, chroma: number, hueDeg: number): [number, number, number] {
  const h = (hueDeg * Math.PI) / 180;
  const a = chroma * Math.cos(h);
  const b = chroma * Math.sin(h);

  const l_ = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = lightness - 0.0894841775 * a - 1.291485548 * b;

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
 */
/**
 * Give `translate: x y` an equivalent `transform: translate(x, y)` — but only where the
 * engine has no `translate` property of its own.
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
  type Ctx = {
    selector: string;
    isAtRule: boolean;
    isKeyframes: boolean;
    openAt: number;
    /** The `translate:` value if this rule declares one. */
    decl: string | null;
  };

  const stack: Ctx[] = [];
  const closed: Array<{ selector: string; openAt: number; closeAt: number; decl: string }> = [];
  let lastBoundary = 0;

  for (let i = 0; i < css.length; i++) {
    const c = css[i];

    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      if (end === -1) break;
      i = end + 1;
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
        isKeyframes: (parent?.isKeyframes ?? false) || /^@(-\w+-)?keyframes\b/.test(selector),
        openAt: i,
        decl: null,
      });
      lastBoundary = i + 1;
      continue;
    }

    if (c === '}') {
      const ctx = stack.pop();
      lastBoundary = i + 1;
      if (ctx && !ctx.isAtRule && ctx.decl !== null && !ctx.isKeyframes) {
        closed.push({ selector: ctx.selector, openAt: ctx.openAt, closeAt: i, decl: ctx.decl });
      }
      continue;
    }

    // A declaration, not a property named in a value: the token has to open the block or
    // follow a semicolon.
    if (c === 't' && css.startsWith('translate:', i) && (i === 0 || css[i - 1] === ';' || css[i - 1] === '{')) {
      const ctx = stack[stack.length - 1];
      if (ctx && !ctx.isAtRule && ctx.decl === null) {
        const semi = css.indexOf(';', i);
        const brace = css.indexOf('}', i);
        const end = Math.min(semi === -1 ? Infinity : semi, brace === -1 ? Infinity : brace);
        ctx.decl = css.slice(i + 'translate:'.length, end).trim();
      }
    }
  }

  if (closed.length === 0) return css;

  // Splice from the end so earlier insertions do not move the positions still to come.
  let out = css;
  for (const rule of closed.sort((a, b) => b.closeAt - a.closeAt)) {
    const body = css.slice(rule.openAt + 1, rule.closeAt);
    // An authored transform would be replaced by ours rather than joined to it; better to
    // leave that rule as it is than to drop what it was doing.
    if (/(^|[;{])transform\s*:/.test(body)) continue;

    const x = /--tw-translate-x\s*:\s*([^;}]+)/.exec(body)?.[1]?.trim();
    const y = /--tw-translate-y\s*:\s*([^;}]+)/.exec(body)?.[1]?.trim();
    const literal = (x || y) ? [x ?? '0px', y ?? '0px'] : (() => {
      const parts = rule.decl.split(/\s+/);
      return [parts[0] ?? '0px', parts[1] ?? '0px'];
    })();

    const companion =
      `@supports not (translate:1px){${rule.selector}{transform:translate(${literal[0]},${literal[1]})}}`;
    out = out.slice(0, rule.closeAt + 1) + companion + out.slice(rule.closeAt + 1);
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * color-mix
 * ------------------------------------------------------------------ */

/**
 * Express a colour at an alpha without color-mix.
 *
 * The point of keeping `var()` where one is in play is the palette switcher: the app
 * redefines `--primary-900` and friends at runtime, and resolving to a literal here
 * would paint every legacy device the swatch it had when the stylesheet was built. A
 * channel variable survives the switch; a hex does not.
 *
 * Returns null when the colour cannot be expressed, so the caller can leave the
 * original declaration alone rather than guess wrong.
 */
function withAlpha(css: string, color: string, alpha: number, depth = 0): string | null {
  if (depth > 4) return null;
  const name = color.trim();

  const literal = hexToRgb(name);
  if (literal) return `rgb(${literal[0]} ${literal[1]} ${literal[2]} / ${alpha})`;

  // `rgb(var(--primary-900))` — the app's own palette tokens carry their channels in a
  // variable, which is exactly what must keep working after a swatch change.
  const channelToken = /^rgb\(\s*var\((--[\w-]+)\)\s*\)$/.exec(name);
  if (channelToken) return `rgb(var(${channelToken[1]}) / ${alpha})`;

  const plain = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*\)$/.exec(name);
  if (plain) return `rgb(${plain[1]} ${plain[2]} ${plain[3]} / ${alpha})`;

  const varToken = /^var\((--[\w-]+)\)$/.exec(name);
  if (varToken) {
    const definition = new RegExp(`${varToken[1]}\\s*:\\s*([^;}]+)`).exec(css);
    if (definition) return withAlpha(css, definition[1], alpha, depth + 1);
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
 */
export function flattenColorMix(css: string): string {
  const MIX = /color-mix\(\s*in\s+(?:oklab|lab|srgb)\s*,\s*([^,]+?)\s+(\d+(?:\.\d+)?)%\s*,\s*transparent\s*\)/gi;
  return css.replace(MIX, (whole, color: string, pct: string) => {
    const rewritten = withAlpha(css, color, parseFloat(pct) / 100);
    return rewritten ?? whole;
  });
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

export function processCss(css: string): string {
  let out = css;
  out = replaceOklchLiterals(out);
  out = rewriteRangeMediaQueries(out);
  out = addTranslateFallbacks(out);
  out = flattenColorMix(out);
  out = openColorMixSupports(out);
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
export function cssEngineCompat() {
  return {
    name: 'qran:css-engine-compat',
    enforce: 'post' as const,
    generateBundle(
      _options: unknown,
      bundle: Record<string, { type: string; fileName: string; source?: string | Uint8Array }>
    ) {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'asset' || !file.fileName.endsWith('.css') || typeof file.source !== 'string') continue;

        const before = file.source;
        const after = processCss(before);

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
