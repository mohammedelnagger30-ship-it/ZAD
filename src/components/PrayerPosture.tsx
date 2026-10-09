import type { PrayerPostureId } from '@/data/prayerGuide';

/**
 * Line-art figures for the prayer guide's movement cards.
 *
 * Local inline SVG only (the app ships no remote images), drawn on a 140×140 grid with
 * a shared floor rule so the seven postures read as one sheet of illustrations. The
 * figure faces left — the direction of prayer in an RTL layout — and every stroke takes
 * `currentColor`, so the card's day/night text colour drives the drawing; the single
 * accent element (the rising marker and the tashahhud finger) can be tinted separately
 * so night can wear its one gold at full strength.
 */

interface PrayerPostureProps {
  posture: PrayerPostureId;
  className?: string;
  accentClassName?: string;
}

export function PrayerPosture({ posture, className = '', accentClassName = '' }: PrayerPostureProps) {
  const head = (cx: number, cy: number, r: number) => (
    <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />
  );

  return (
    <svg
      viewBox="0 0 140 140"
      fill="none"
      stroke="currentColor"
      strokeWidth={5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {/* shared floor rule */}
      <path d="M16 121 H124" strokeOpacity={0.3} strokeWidth={4} />

      {posture === 'takbir' && (
        <>
          {head(64, 42, 12)}
          <path d="M64 54 V88" />
          <path d="M59 57 L48 34" />
          <path d="M69 57 L80 34" />
          <path d="M64 88 L57 119" />
          <path d="M64 88 L71 119" />
        </>
      )}

      {posture === 'qiyam' && (
        <>
          {head(64, 42, 12)}
          <path d="M64 54 V88" />
          {/* arms folded one over the other in front of the chest */}
          <path d="M58 58 L61 78" />
          <path d="M70 58 L59 78" />
          <path d="M64 88 L57 119" />
          <path d="M64 88 L71 119" />
        </>
      )}

      {posture === 'ruku' && (
        <>
          {/* head level with the flat back: neither raised nor dropped */}
          {head(32, 66, 11)}
          <path d="M43 60 H88" />
          <path d="M88 61 L48 96" />
          <path d="M48 96 V119" />
          <path d="M45 63 L46 93" />
        </>
      )}

      {posture === 'raf' && (
        <>
          {head(64, 46, 12)}
          <path d="M64 58 V88" />
          <path d="M58 61 L53 85" />
          <path d="M70 61 L75 85" />
          <path d="M64 88 L57 119" />
          <path d="M64 88 L71 119" />
          <g className={accentClassName}>
            <path d="M57 30 L64 23 L71 30" />
          </g>
        </>
      )}

      {posture === 'sujud' && (
        <>
          {/* forehead on the floor between where the hands fall */}
          {head(38, 110, 10)}
          <path d="M47 105 L88 78" />
          <path d="M88 80 L73 117 L93 108 L98 117" />
        </>
      )}

      {posture === 'jalsa' && (
        <>
          {head(58, 46, 11)}
          <path d="M58 57 L63 92" />
          <path d="M63 92 L38 104" />
          <path d="M38 104 L37 118" />
          <path d="M63 94 L80 115" />
          <path d="M80 116 L96 117" />
          <path d="M57 66 L43 97" />
          <path d="M60 67 L49 96" />
        </>
      )}

      {posture === 'tashahhud' && (
        <>
          {head(58, 46, 11)}
          <path d="M58 57 L63 92" />
          <path d="M63 92 L38 104" />
          <path d="M38 104 L37 118" />
          <path d="M63 94 L80 115" />
          <path d="M80 116 L96 117" />
          <path d="M57 66 L44 96" />
          <g className={accentClassName}>
            {/* the raised index finger of the tashahhud */}
            <path d="M44 96 L41 81" />
          </g>
        </>
      )}
    </svg>
  );
}
