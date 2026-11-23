import {
  oklchToRgb,
  oklabToRgb,
  replaceOklchLiterals,
  replaceOklabLiterals,
  rewriteRangeMediaQueries,
  addTranslateFallbacks,
  flattenColorMix,
  openColorMixSupports,
  processCss,
  cssEngineCompat,
} from '../css-engine-compat';

describe('css engine compat', () => {
  describe('oklch → sRGB', () => {
    it('converts the pure-white end of the lightness axis', () => {
      expect(oklchToRgb(1, 0, 0)).toEqual([255, 255, 255]);
    });

    it('converts the black end', () => {
      expect(oklchToRgb(0, 0, 0)).toEqual([0, 0, 0]);
    });

    it('keeps a mid-grey neutral', () => {
      const [r, g, b] = oklchToRgb(0.55, 0, 0);
      expect(r).toBe(g);
      expect(g).toBe(b);
      // Oklab L 0.55 is a true mid grey, not a light one.
      expect(r).toBeGreaterThan(90);
      expect(r).toBeLessThan(140);
    });

    it('clips an out-of-gamut colour into range rather than overflowing', () => {
      const [r, g, b] = oklchToRgb(0.7, 0.4, 30);
      for (const channel of [r, g, b]) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
    });

    it('rewrites every oklch literal in a stylesheet', () => {
      const css = ':root{--color-red-500:oklch(63.7% .237 25.331)}';
      const out = replaceOklchLiterals(css);
      expect(out).not.toContain('oklch');
      expect(out).toMatch(/rgb\(\d+ \d+ \d+\)/);
    });

    it('leaves a stylesheet without oklch untouched', () => {
      const css = ':root{--color-gold-400:#f0c83a}';
      expect(replaceOklchLiterals(css)).toBe(css);
    });
  });

  describe('oklab → sRGB', () => {
    it('converts the pure-white end of the lightness axis', () => {
      expect(oklabToRgb(1, 0, 0)).toEqual([255, 255, 255]);
    });

    it('converts a colour to the hex it was authored from', () => {
      // #16a34a, as Tailwind writes it out for the accent scale.
      expect(oklabToRgb(0.627052, -0.145969, 0.0869672)).toEqual([22, 163, 74]);
    });

    it('rewrites a literal the theme emits for an alpha utility', () => {
      const out = replaceOklabLiterals('.a{background-color:oklab(62.7052% -.145969 .0869672/.25)}');
      expect(out).toBe('.a{background-color:rgb(22 163 74 / 0.25)}');
    });

    it('reads a percentage alpha as a fraction', () => {
      expect(replaceOklabLiterals('.a{color:oklab(50% .1 -.1/90%)}')).toBe('.a{color:rgb(129 69 154 / 0.9)}');
    });

    it('leaves a component it cannot express alone', () => {
      const css = '.a{color:oklab(50% 1e999 0)}';
      expect(replaceOklabLiterals(css)).toBe(css);
    });

    it('leaves a stylesheet without oklab untouched', () => {
      const css = ':root{--color-gold-400:#f0c83a}';
      expect(replaceOklabLiterals(css)).toBe(css);
    });
  });

  describe('range media queries → classic', () => {
    it('turns a lower bound into min-width', () => {
      expect(rewriteRangeMediaQueries('@media (width>=48rem){a{x:1}}')).toBe('@media (min-width:48rem){a{x:1}}');
    });

    it('turns an upper bound into a max-width just under the breakpoint', () => {
      const out = rewriteRangeMediaQueries('@media (width<48rem){a{x:1}}');
      expect(out).toBe('@media (max-width:47.98rem){a{x:1}}');
    });

    it('steps a px upper bound just under the breakpoint', () => {
      expect(rewriteRangeMediaQueries('@media (width<768px){a{x:1}}')).toBe('@media (max-width:767.98px){a{x:1}}');
    });

    it('rewrites every range rule in one pass', () => {
      const out = rewriteRangeMediaQueries('@media (width>=40rem){a{b:1}}@media (width>=64rem){c{d:1}}');
      expect(out).not.toContain('width>=');
      expect(out).toContain('@media (min-width:40rem)');
      expect(out).toContain('@media (min-width:64rem)');
    });

    it('leaves a classic min-width rule alone', () => {
      const css = '@media (min-width:768px){a{x:1}}';
      expect(rewriteRangeMediaQueries(css)).toBe(css);
    });
  });

  describe('translate fallback', () => {
    it('spells the movement out as a transform, outside the rule it belongs to', () => {
      const out = addTranslateFallbacks('.-translate-x-1\\/2{--tw-translate-x:-50%;translate:var(--tw-translate-x) var(--tw-translate-y)}');
      expect(out).toBe(
        '.-translate-x-1\\/2{--tw-translate-x:-50%;translate:var(--tw-translate-x) var(--tw-translate-y)}' +
          '@supports not (translate:1px){.-translate-x-1\\/2{transform:translate(-50%,0px)}}'
      );
    });

    it('does not put both forms in one rule, where they would compound', () => {
      // translate and transform compose; together they would move the element twice.
      const out = addTranslateFallbacks('.a{translate:var(--tw-translate-x) var(--tw-translate-y)}');
      expect(out.slice(out.indexOf('{') + 1, out.indexOf('}'))).not.toContain('transform');
      expect(out).toContain('@supports not (translate:1px)');
    });

    it('reads the axes from the rule when only one of them is declared', () => {
      const out = addTranslateFallbacks('.a{--tw-translate-x:calc(var(--spacing) * -1);translate:var(--tw-translate-x) var(--tw-translate-y)}');
      expect(out).toContain('@supports not (translate:1px){.a{transform:translate(calc(var(--spacing) * -1),0px)}}');
    });

    it('takes a literal two-axis value as written', () => {
      const out = addTranslateFallbacks('.a{translate:1rem 2rem}');
      expect(out).toBe('.a{translate:1rem 2rem}@supports not (translate:1px){.a{transform:translate(1rem,2rem)}}');
      expect((out.match(/\{/g) ?? []).length).toBe((out.match(/\}/g) ?? []).length);
    });

    it('leaves the closing brace where it was', () => {
      // Trading it for a semicolon would open the rule onto every rule after it and take
      // the rest of the stylesheet down with it.
      const out = addTranslateFallbacks('.a{translate:1rem 2rem}.b{color:red}');
      expect(out).toContain('}.b{color:red}');
    });

    it('keeps an authored transform instead of overwriting it', () => {
      const css = '.a{transform:rotate(45deg);translate:1rem 0}';
      expect(addTranslateFallbacks(css)).toBe(css);
    });

    it('does not touch a background-position or any other declaration', () => {
      const css = '.a{background-position:translate:0}';
      expect(addTranslateFallbacks(css)).toBe(css);
    });

    it('is not fooled by an escaped apostrophe in a selector', () => {
      // Tailwind escapes the brackets and quotes in class names like `font-['Amiri_Quran',serif]`;
      // an engine reads a class name, and so must the scanner.
      const css = ".font-\\[Amiri_Quran\\'\\,_serif\\]{font-family:Amiri Quran,serif}.after{translate:1rem 0}";
      const out = addTranslateFallbacks(css);
      expect(out).toContain('@supports not (translate:1px){.after{transform:translate(1rem,0px)}}');
      expect((out.match(/\{/g) ?? []).length).toBe((out.match(/\}/g) ?? []).length);
    });
  });

  describe('color-mix flattening', () => {
    it('turns a literal colour at an alpha into an equivalent rgb', () => {
      expect(flattenColorMix('.a{background-color:color-mix(in oklab, #fff 90%, transparent)}')).toBe(
        '.a{background-color:rgb(255 255 255 / 0.9)}'
      );
    });

    it('keeps the token when the colour is a custom property', () => {
      const css = ':root{--color-gold-400:#f0c83a}.a{background-color:color-mix(in oklab, var(--color-gold-400) 15%, transparent)}';
      expect(flattenColorMix(css)).toContain('rgb(240 200 58 / 0.15)');
    });

    it('keeps the channel variable when the palette token resolves through one', () => {
      const css =
        ':root{--color-primary-900:rgb(var(--primary-900));--primary-900:20 59 43}' +
        '.a{background-color:color-mix(in oklab, var(--color-primary-900) 30%, transparent)}';
      // The swatch is redefined at runtime, so the channels have to stay a variable.
      expect(flattenColorMix(css)).toContain('rgb(var(--primary-900) / 0.3)');
    });

    it('keeps the channel variable when the mix names it directly', () => {
      const css = '.a{background-color:color-mix(in oklab, rgb(var(--primary-800)) 45%, transparent)}';
      expect(flattenColorMix(css)).toBe('.a{background-color:rgb(var(--primary-800) / 0.45)}');
    });

    it('leaves a mix it cannot resolve rather than guessing wrong', () => {
      const css = '.a{background:color-mix(in oklab, currentcolor 50%, transparent)}';
      expect(flattenColorMix(css)).toBe(css);
    });

    it('rewrites every resolvable mix in one pass', () => {
      const out = flattenColorMix('.a{x:color-mix(in oklab, #fff 90%, transparent)}.b{y:color-mix(in oklab, #000 10%, transparent)}');
      expect(out).not.toContain('color-mix');
    });
  });

  describe('color-mix feature test', () => {
    it('opens the guard Tailwind puts around each mix', () => {
      const css = '@supports (color:color-mix(in lab, red, red)){.a{background-color:rgb(1 2 3 / .3)}}';
      expect(openColorMixSupports(css)).toBe('@supports (color:red){.a{background-color:rgb(1 2 3 / .3)}}');
    });

    it('opens every guard in the stylesheet', () => {
      const out = openColorMixSupports('@supports (color:color-mix(in lab, red, red)){}@supports (color:color-mix(in lab, red, red)){}');
      expect(out).not.toContain('color-mix');
      expect(out).toContain('@supports (color:red){}@supports (color:red){}');
    });

    it('leaves unrelated feature tests alone', () => {
      const css = '@supports (backdrop-filter:blur(2px)){.a{backdrop-filter:blur(2px)}}';
      expect(openColorMixSupports(css)).toBe(css);
    });
  });

  describe('processCss', () => {
    it('leaves a stylesheet that uses none of these constructs unchanged', () => {
      const css = '.a{color:red}@media (min-width:768px){.b{padding:1rem}}';
      expect(processCss(css)).toBe(css);
    });

    it('removes every construct the older engine rejects in one pass', () => {
      const css =
        ':root{--color-red-500:oklch(63.7% .237 25.331);--color-gold-400:#f0c83a}' +
        '@media (width>=48rem){.rail{display:flex}}' +
        '.pill{--tw-translate-x:-50%;translate:var(--tw-translate-x) var(--tw-translate-y);' +
        'background-color:color-mix(in oklab, var(--color-gold-400) 15%, transparent)}' +
        '@supports (color:color-mix(in lab, red, red)){' +
        '.card{background-color:color-mix(in oklab, var(--color-gold-400) 30%, transparent)}}';
      const out = processCss(css);
      expect(out).not.toContain('oklch');
      expect(out).not.toContain('width>=');
      expect(out).not.toContain('color-mix');
      expect(out).toContain('@media (min-width:48rem)');
      expect(out).toContain('@supports not (translate:1px){.pill{transform:translate(-50%,0px)}}');
      expect(out).toContain('@supports (color:red)');
      expect(out).toContain('rgb(240 200 58 / 0.3)');
      // The one invariant every rewrite has to hold: the stylesheet still closes what it opens.
      expect((out.match(/\{/g) ?? []).length).toBe((out.match(/\}/g) ?? []).length);
    });
  });

  describe('cssEngineCompat plugin', () => {
    type Bundle = Record<string, { type: string; fileName: string; source?: string }>;
    const plugin = cssEngineCompat() as unknown as {
      generateBundle: (options: unknown, bundle: Bundle) => void;
    };

    it('rewrites the stylesheet without moving its name', () => {
      const bundle: Bundle = {
        'assets/index-abc.css': {
          type: 'asset',
          fileName: 'assets/index-abc.css',
          source: ':root{--c:oklch(63.7% .237 25.331)}',
        },
      };

      plugin.generateBundle({}, bundle);

      expect(bundle['assets/index-abc.css'].source).not.toContain('oklch');
      // The name has to stay put: the page, the chunks and the precache all point at it,
      // and this rewrite runs after they were written.
      expect(bundle['assets/index-abc.css'].fileName).toBe('assets/index-abc.css');
    });

    it('leaves non-stylesheet assets alone', () => {
      const bundle: Bundle = {
        'main.js': { type: 'asset', fileName: 'main.js', source: 'export default 1' },
      };
      plugin.generateBundle({}, bundle);
      expect(bundle['main.js'].source).toBe('export default 1');
    });
  });
});
