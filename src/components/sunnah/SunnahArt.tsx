import type { CSSProperties } from 'react';

/**
 * Drawn artwork for the «سنن عن النبي» screen.
 *
 * The screen asks for motion, but the app ships as an offline PWA behind a CSP whose
 * `img-src` allows only `'self' data:` and whose `media-src` lists audio hosts and no
 * video host — so a remote photo or clip would be blocked before it arrived. These are
 * the answer instead: real pictures, drawn here, that actually move, with no network.
 *
 * Every animated child carries an `animate-*` class rather than an inline `animation`,
 * so the `prefers-reduced-motion: reduce` block in index.css reaches them and stops them.
 * The one exception is `animate-draw`: it is given `backwards` fill, so the delay holds
 * the stroke hidden, the run draws it, and once the animation ends the element falls back
 * to its inline `stroke-dashoffset: 0` — which is also what reduced motion renders.
 */

export type SunnahArtId =
  | 'daily'
  | 'sleep'
  | 'clothing'
  | 'eating'
  | 'speech'
  | 'prayer'
  | 'hygiene'
  | 'companions'
  | 'family'
  | 'travel'
  | 'mosque'
  | 'character';

/** Rotation inside an SVG needs its own origin: the viewBox centre, not the element box. */
const spinOrigin: CSSProperties = { transformBox: 'view-box', transformOrigin: 'center' };

interface ArtProps {
  art: SunnahArtId;
  /** Namespaces gradient ids so several drawings on one page never collide. */
  uid?: string;
  className?: string;
}

/** A stroked path that draws itself in when it enters. */
function Draw({
  d,
  dash = 300,
  delay = 0,
  width = 2,
}: {
  d: string;
  dash?: number;
  delay?: number;
  width?: number;
}) {
  return (
    <path
      d={d}
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="animate-draw"
      style={{ ['--dash' as string]: dash, strokeDasharray: dash, strokeDashoffset: 0, animationDelay: `${delay}s` }}
    />
  );
}

export function SunnahArt({ art, uid, className = '' }: ArtProps) {
  const g = uid ?? art;
  const svg = (children: React.ReactNode) => (
    <svg viewBox="0 0 100 100" className={`block h-full w-full ${className}`} aria-hidden="true">
      {children}
    </svg>
  );

  switch (art) {
    /* Sunrise: a disc that breathes behind rays that turn. */
    case 'daily':
      return svg(
        <>
          <circle cx="50" cy="50" r="26" className="animate-pulse-soft" fill={`url(#${g}-a)`} />
          <g className="animate-slow-spin" style={spinOrigin}>
            {Array.from({ length: 12 }, (_, i) => (
              <line
                key={i}
                x1="50"
                y1="8"
                x2="50"
                y2="17"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                transform={`rotate(${i * 30} 50 50)`}
              />
            ))}
          </g>
          <circle cx="50" cy="50" r="34" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.4" className="animate-ping-soft" />
          <circle cx="50" cy="50" r="17" fill={`url(#${g}-b)`} />
          <defs>
            <linearGradient id={`${g}-a`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.45" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0.08" />
            </linearGradient>
            <radialGradient id={`${g}-b`}>
              <stop offset="0%" stopColor="#fff8ec" />
              <stop offset="100%" stopColor="currentColor" />
            </radialGradient>
          </defs>
        </>,
      );

    /* Crescent at rest with stars that come and go. */
    case 'sleep':
      return svg(
        <>
          <g className="animate-float-slow" style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
            <path
              d="M64 22a30 30 0 1 0 0 56 24 24 0 0 1 0-56z"
              fill={`url(#${g}-a)`}
              stroke="currentColor"
              strokeWidth="1.6"
            />
          </g>
          {[
            { cx: 76, cy: 26, d: 0 },
            { cx: 84, cy: 52, d: 0.7 },
            { cx: 72, cy: 74, d: 1.4 },
          ].map((s) => (
            <path
              key={s.cx}
              className="animate-twinkle"
              style={{ animationDelay: `${s.d}s`, transformBox: 'fill-box', transformOrigin: 'center' }}
              d={`M${s.cx} ${s.cy - 5} l1.4 3.6 3.6 1.4 -3.6 1.4 -1.4 3.6 -1.4 -3.6 -3.6 -1.4 3.6 -1.4z`}
              fill="currentColor"
            />
          ))}
          <defs>
            <linearGradient id={`${g}-a`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0.55" />
            </linearGradient>
          </defs>
        </>,
      );

    /* A garment whose outline stitches itself, buttons dropping in behind it. */
    case 'clothing':
      return svg(
        <>
          <Draw d="M32 26 L44 20 L56 20 L68 26 L74 40 L66 44 L66 80 L34 80 L34 44 L26 40 Z" dash={260} />
          <Draw d="M44 20 L50 32 L56 20" dash={60} delay={0.35} width={1.6} />
          {[44, 54, 64].map((cy, i) => (
            <circle
              key={cy}
              cx="50"
              cy={cy}
              r="2.6"
              fill="currentColor"
              className="animate-scale-in"
              style={{ animationDelay: `${0.6 + i * 0.14}s`, animationFillMode: 'backwards' }}
            />
          ))}
        </>,
      );

    /* A bowl with steam leaving it in three uneven wisps. */
    case 'eating':
      return svg(
        <>
          {[0, 0.5, 1].map((d, i) => (
            <path
              key={i}
              className="animate-steam"
              style={{ animationDelay: `${d}s`, transformBox: 'fill-box', transformOrigin: 'bottom' }}
              d={`M${43 + i * 7} 46 q4 -6 0 -11`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              opacity="0.75"
            />
          ))}
          <path d="M22 54 h56 a28 28 0 0 1 -56 0z" fill={`url(#${g}-a)`} stroke="currentColor" strokeWidth="2" />
          <path d="M20 54 h60" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <path
            d="M40 84 h20"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            className="animate-draw"
            style={{ ['--dash' as string]: 40, strokeDasharray: 40, strokeDashoffset: 0, animationDelay: '0.5s' }}
          />
          <defs>
            <linearGradient id={`${g}-a`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.3" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0.06" />
            </linearGradient>
          </defs>
        </>,
      );

    /* A bubble whose three dots take turns speaking. */
    case 'speech':
      return svg(
        <>
          <path
            d="M18 34a10 10 0 0 1 10-10h44a10 10 0 0 1 10 10v22a10 10 0 0 1-10 10H46L32 78V66H28a10 10 0 0 1-10-10z"
            fill={`url(#${g}-a)`}
            stroke="currentColor"
            strokeWidth="2"
          />
          {[38, 50, 62].map((cx, i) => (
            <circle
              key={cx}
              cx={cx}
              cy="45"
              r="4.4"
              fill="currentColor"
              className="animate-bounce"
              style={{ animationDelay: `${i * 0.18}s`, animationDuration: '1.1s' }}
            />
          ))}
          <defs>
            <linearGradient id={`${g}-a`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.32" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0.07" />
            </linearGradient>
          </defs>
        </>,
      );

    /* Cupped hands with a light rising out of them. */
    case 'prayer':
      return svg(
        <>
          {Array.from({ length: 7 }, (_, i) => (
            <line
              key={i}
              x1="50"
              y1="40"
              x2="50"
              y2="16"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              opacity="0.45"
              className="animate-twinkle"
              style={{ animationDelay: `${i * 0.22}s`, transformBox: 'view-box', transformOrigin: '50px 40px' }}
              transform={`rotate(${-45 + i * 15} 50 40)`}
            />
          ))}
          <Draw d="M24 52 q6 22 26 22 q20 0 26-22" dash={120} />
          <Draw d="M30 52 q4 -8 8 0 q4 -8 8 0 q4 -8 8 0 q4 -8 8 0 q4 -8 8 0" dash={110} delay={0.4} width={1.6} />
          <circle cx="50" cy="44" r="4.5" fill="currentColor" className="animate-pulse-soft" />
        </>,
      );

    /* A drop about to land, with the ring it makes already spreading. */
    case 'hygiene':
      return svg(
        <>
          {[0, 1.1, 2.2].map((d) => (
            <ellipse
              key={d}
              cx="50"
              cy="70"
              rx="16"
              ry="5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className="animate-ripple"
              style={{ animationDelay: `${d}s`, transformBox: 'fill-box', transformOrigin: 'center' }}
            />
          ))}
          <g className="animate-float" style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
            <path d="M50 16 C64 36 68 44 68 52 a18 18 0 0 1 -36 0 c0-8 4-16 18-36z" fill={`url(#${g}-a)`} stroke="currentColor" strokeWidth="2" />
            <circle cx="43" cy="52" r="3.5" fill="#fff" opacity="0.85" />
          </g>
          <defs>
            <linearGradient id={`${g}-a`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0.5" />
            </linearGradient>
          </defs>
        </>,
      );

    /* Three figures held by a ring that turns around them. */
    case 'companions':
      return svg(
        <>
          <g className="animate-slow-spin-rev" style={spinOrigin}>
            <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="4 9" opacity="0.6" />
          </g>
          {[
            { cx: 34, r: 9, y: 46 },
            { cx: 50, r: 11, y: 42 },
            { cx: 66, r: 9, y: 46 },
          ].map((p, i) => (
            <g key={p.cx} className="animate-float" style={{ animationDelay: `${i * 0.35}s`, transformBox: 'fill-box', transformOrigin: 'center' }}>
              <circle cx={p.cx} cy={p.y} r={p.r} fill={`url(#${g}-a)`} stroke="currentColor" strokeWidth="1.8" />
              <path
                d={`M${p.cx - p.r - 5} 74 q0 -${p.r + 4} ${p.r + 5} -${p.r + 4} q${p.r + 5} 0 ${p.r + 5} ${p.r + 4}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </g>
          ))}
          <defs>
            <linearGradient id={`${g}-a`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.4" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0.08" />
            </linearGradient>
          </defs>
        </>,
      );

    /* A large heart with a smaller one circling it. */
    case 'family':
      return svg(
        <>
          <path
            className="animate-pulse-soft"
            style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
            d="M50 78 C24 60 16 46 16 36 a17 17 0 0 1 34-6 a17 17 0 0 1 34 6 c0 10 -8 24 -34 42z"
            fill={`url(#${g}-a)`}
            stroke="currentColor"
            strokeWidth="2.4"
          />
          <g className="animate-orbit" style={{ transformBox: 'view-box', transformOrigin: '50px 50px' }}>
            <path
              d="M50 12 C45 8 38 9 38 14 a6 6 0 0 0 12 4 a6 6 0 0 0 12 -4 c0 -5 -7 -6 -12 -2z"
              fill="currentColor"
              opacity="0.85"
              transform="translate(0 26) scale(0.7) translate(21 6)"
            />
          </g>
          <defs>
            <linearGradient id={`${g}-a`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.5" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0.12" />
            </linearGradient>
          </defs>
        </>,
      );

    /* A paper plane flying a dashed arc that redraws itself. */
    case 'travel':
      return svg(
        <>
          <path
            d="M12 76 C30 40 58 26 88 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="6 8"
            strokeLinecap="round"
            opacity="0.65"
            className="animate-draw"
            style={{ ['--dash' as string]: 130, strokeDasharray: 6, strokeDashoffset: 0, animationDuration: '2.4s' }}
          />
          <g className="animate-float-slow" style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
            <path d="M78 30 L92 20 L86 36 L80 34 L74 44 L76 32z" fill={`url(#${g}-a)`} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          </g>
          {[
            { cx: 24, cy: 34, d: 0 },
            { cx: 44, cy: 20, d: 0.9 },
          ].map((s) => (
            <circle
              key={s.cx}
              cx={s.cx}
              cy={s.cy}
              r="2.4"
              fill="currentColor"
              className="animate-twinkle"
              style={{ animationDelay: `${s.d}s` }}
            />
          ))}
          <defs>
            <linearGradient id={`${g}-a`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#fff" stopOpacity="0.95" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0.55" />
            </linearGradient>
          </defs>
        </>,
      );

    /* A mosque whose dome lights up, under a crescent that turns. */
    case 'mosque':
      return svg(
        <>
          <circle cx="50" cy="46" r="30" fill={`url(#${g}-a)`} className="animate-pulse-soft" />
          <Draw d="M14 84 h72" dash={80} />
          <Draw d="M22 84 V60 a10 10 0 0 1 10 -10 h6 v34" dash={150} delay={0.15} width={1.8} />
          <Draw d="M62 84 V50 h6 a10 10 0 0 1 10 10 v24" dash={150} delay={0.15} width={1.8} />
          <Draw d="M36 84 V58 a14 14 0 0 1 28 0 v26" dash={130} delay={0.45} width={2.2} />
          <Draw d="M50 44 v-8" dash={20} delay={0.75} width={1.6} />
          <g className="animate-slow-spin" style={{ transformBox: 'view-box', transformOrigin: '50px 32px' }}>
            <path d="M56 26 a8 8 0 1 1 -6 -7 a6.4 6.4 0 1 0 6 7z" fill="currentColor" />
          </g>
          <defs>
            <radialGradient id={`${g}-a`}>
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.32" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </radialGradient>
          </defs>
        </>,
      );

    /* A heart throwing two rings outward, like a heartbeat on a monitor. */
    case 'character':
      return svg(
        <>
          {[0, 1.5].map((d) => (
            <circle
              key={d}
              cx="50"
              cy="50"
              r="22"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="animate-ripple"
              style={{ animationDelay: `${d}s`, transformBox: 'fill-box', transformOrigin: 'center' }}
            />
          ))}
          <path
            className="animate-flame"
            style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
            d="M50 74 C30 60 24 50 24 42 a13 13 0 0 1 26 -5 a13 13 0 0 1 26 5 c0 8 -6 18 -26 32z"
            fill={`url(#${g}-a)`}
            stroke="currentColor"
            strokeWidth="2.4"
          />
          <defs>
            <linearGradient id={`${g}-a`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.55" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0.1" />
            </linearGradient>
          </defs>
        </>,
      );
  }
}

/**
 * The banner rosette: three rings turning at three paces around a star that breathes.
 * It is decoration only, so it carries `aria-hidden` and never intercepts a tap.
 */
export function SunnahMandala({ uid = 'sunnah-mandala', className = '' }: { uid?: string; className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`${uid}-petal`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.85" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.1" />
        </linearGradient>
      </defs>

      <circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.35" />

      <g className="animate-slow-spin" style={spinOrigin}>
        {Array.from({ length: 16 }, (_, i) => (
          <ellipse
            key={i}
            cx="60"
            cy="16"
            rx="4"
            ry="13"
            fill="none"
            stroke={`url(#${uid}-petal)`}
            strokeWidth="1.2"
            transform={`rotate(${i * 22.5} 60 60)`}
          />
        ))}
      </g>

      <g className="animate-slow-spin-rev" style={spinOrigin}>
        {Array.from({ length: 8 }, (_, i) => (
          <path
            key={i}
            d="M60 34 l5 12 12 5 -12 5 -5 12 -5 -12 -12 -5 12 -5z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            opacity="0.5"
            transform={`rotate(${i * 45} 60 60)`}
          />
        ))}
      </g>

      <g className="animate-orbit" style={spinOrigin}>
        <circle cx="60" cy="60" r="27" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="3 7" opacity="0.7" />
        <circle cx="60" cy="33" r="2.6" fill="currentColor" />
      </g>

      <g className="animate-pulse-soft" style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
        <path d="M60 42 l7 11 13 3 -9 10 1 13 -12 -6 -12 6 1 -13 -9 -10 13 -3z" fill="currentColor" opacity="0.9" />
      </g>
    </svg>
  );
}
