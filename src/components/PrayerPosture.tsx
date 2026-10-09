import type { PrayerPostureId } from '@/data/prayerGuide';

/**
 * Filled pictograms for the prayer guide's movement cards.
 *
 * Local inline SVG only (the app ships no remote images), drawn on a 140×140 grid with
 * a shared floor rule and a soft ground shadow so the seven postures read as one sheet
 * of illustrations. The figure is a filled silhouette seen from the side — torso depth
 * rather than shoulder width, a small nose fused into the skull to show the facing
 * direction (left, toward the prayer), and the far arm/leg drawn behind at reduced
 * opacity so both limbs stay legible. Every shape takes `currentColor`, so the card's
 * day/night text colour drives the drawing; the single accent element per posture (the
 * rising marker of الرفع and the index finger of التشهد) can be tinted separately so
 * night can wear its one gold at full strength.
 */

interface PrayerPostureProps {
  posture: PrayerPostureId;
  className?: string;
  accentClassName?: string;
}

/** Shared floor rule + soft shadow under the figure, identical in all seven cards. */
function Ground() {
  return (
    <>
      <ellipse cx="70" cy="122.5" rx="44" ry="3.2" fill="currentColor" stroke="none" opacity={0.07} />
      <path d="M16 121 H124" strokeOpacity={0.3} strokeWidth={4} />
    </>
  );
}

/**
 * Profile head: a circle with a small nose wedge pointing in the facing direction, so
 * the side view communicates which way the figure faces without any facial detail.
 * `facing: 'left'` for upright figures, `'downleft'` for the bowed and prostrate ones.
 */
function Head({ cx, cy, r, facing }: { cx: number; cy: number; r: number; facing: 'left' | 'downleft' }) {
  const nose =
    facing === 'left'
      ? `M${cx - r + 1} ${cy - 3.2} L${cx - r - 4.6} ${cy + 1.2} L${cx - r + 1.6} ${cy + 5.4} Z`
      : `M${cx - r * 0.95} ${cy + r * 0.28} L${cx - r * 0.92} ${cy + r * 0.86} L${cx - r * 0.32} ${cy + r * 0.97} Z`;
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />
      <path d={nose} fill="currentColor" stroke="none" />
    </g>
  );
}

export function PrayerPosture({ posture, className = '', accentClassName = '' }: PrayerPostureProps) {
  return (
    <svg
      viewBox="0 0 140 140"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <Ground />

      {posture === 'takbir' && (
        <>
          {/* far arm lifted beside the head, behind it */}
          <g opacity={0.32}>
            <path d="M78 51 L86 43 L88.5 29" strokeWidth={7.5} />
            <circle cx="88.5" cy="28" r={4.4} fill="currentColor" stroke="none" />
          </g>
          <Head cx={72} cy={30} r={11.5} facing="left" />
          <path d="M68 39 H76.5 L77 48 H67.5 Z" fill="currentColor" stroke="none" />
          {/* profile torso, chest depth ~16 */}
          <path
            d="M65 50 C63.5 56 65 64 65.5 70 L66 83 C66 86 68 87.5 71 87.5 L74.5 87.5 C78 87.5 80 85.5 80 82.5 L80.5 66 L79.5 48 C79 44 76 42.5 73 42.5 L69.5 42.5 C67 42.5 65.5 46 65 50 Z"
            fill="currentColor"
            stroke="none"
          />
          {/* near arm raised, hand level with the ear */}
          <path d="M66 51 L58 43 L55 28" strokeWidth={7.5} />
          <circle cx="55" cy="27" r={4.4} fill="currentColor" stroke="none" />
          {/* legs */}
          <g opacity={0.32}>
            <path d="M76 85 L75.5 102 L75.5 117" strokeWidth={9} />
            <path d="M75.5 118 L68 120" strokeWidth={7} />
          </g>
          <path d="M70 85 L68.5 102 L67.5 117" strokeWidth={9} />
          <path d="M67.5 118 L60 120" strokeWidth={7} />
        </>
      )}

      {posture === 'qiyam' && (
        <>
          {/* far arm folded low across the chest */}
          <g opacity={0.32}>
            <path d="M77 52 L73 68 L63.5 61.5" strokeWidth={7.5} />
            <circle cx="63" cy="61.5" r={4.2} fill="currentColor" stroke="none" />
          </g>
          <Head cx={72} cy={30} r={11.5} facing="left" />
          <path d="M68 39 H76.5 L77 48 H67.5 Z" fill="currentColor" stroke="none" />
          <path
            d="M65 50 C63.5 56 65 64 65.5 70 L66 83 C66 86 68 87.5 71 87.5 L74.5 87.5 C78 87.5 80 85.5 80 82.5 L80.5 66 L79.5 48 C79 44 76 42.5 73 42.5 L69.5 42.5 C67 42.5 65.5 46 65 50 Z"
            fill="currentColor"
            stroke="none"
          />
          {/* near (right) hand rests over the far one on the chest */}
          <path d="M66 52 L60 66 L64.5 57" strokeWidth={7.5} />
          <circle cx="64.5" cy="57" r={4.4} fill="currentColor" stroke="none" />
          <g opacity={0.32}>
            <path d="M76 85 L75.5 102 L75.5 117" strokeWidth={9} />
            <path d="M75.5 118 L68 120" strokeWidth={7} />
          </g>
          <path d="M70 85 L68.5 102 L67.5 117" strokeWidth={9} />
          <path d="M67.5 118 L60 120" strokeWidth={7} />
        </>
      )}

      {posture === 'ruku' && (
        <>
          {/* legs stay vertical under the hips */}
          <g opacity={0.32}>
            <path d="M85 79 L85.5 98 L85 117" strokeWidth={9} />
            <path d="M85 118 L77.5 120" strokeWidth={7} />
            <path d="M61 84.5 L70 92 L83.5 96.5" strokeWidth={7.5} />
            <ellipse cx="84" cy="96.5" rx={4.4} ry={3.5} fill="currentColor" stroke="none" />
          </g>
          <path d="M79.5 79 L78.5 98 L78 117" strokeWidth={9} />
          <path d="M78 118 L70.5 120" strokeWidth={7} />
          {/* flat back, inclined forward */}
          <path d="M84 72 L58 85" strokeWidth={14.5} />
          <path d="M56 85.5 L48.5 89" strokeWidth={8.5} />
          {/* head in line with the back: neither raised nor dropped */}
          <Head cx={41} cy={93} r={10.5} facing="downleft" />
          {/* near hand flat on the near knee */}
          <path d="M57.5 87 L66 94.5 L78 97.5" strokeWidth={7.5} />
          <ellipse cx="78.5" cy="97.5" rx={4.8} ry={3.8} fill="currentColor" stroke="none" />
        </>
      )}

      {posture === 'raf' && (
        <>
          <g opacity={0.32}>
            <path d="M78.5 52 L82 67 L80.5 81" strokeWidth={7.5} />
            <circle cx="80.5" cy="82.5" r={4.2} fill="currentColor" stroke="none" />
          </g>
          <Head cx={72} cy={30} r={11.5} facing="left" />
          <path d="M68 39 H76.5 L77 48 H67.5 Z" fill="currentColor" stroke="none" />
          <path
            d="M65 50 C63.5 56 65 64 65.5 70 L66 83 C66 86 68 87.5 71 87.5 L74.5 87.5 C78 87.5 80 85.5 80 82.5 L80.5 66 L79.5 48 C79 44 76 42.5 73 42.5 L69.5 42.5 C67 42.5 65.5 46 65 50 Z"
            fill="currentColor"
            stroke="none"
          />
          {/* arms settled at the sides: the standing is complete and steady */}
          <path d="M65 53 L61 67 L63 81" strokeWidth={7.5} />
          <circle cx="63" cy="82.5" r={4.2} fill="currentColor" stroke="none" />
          <g opacity={0.32}>
            <path d="M76 85 L75.5 102 L75.5 117" strokeWidth={9} />
            <path d="M75.5 118 L68 120" strokeWidth={7} />
          </g>
          <path d="M70 85 L68.5 102 L67.5 117" strokeWidth={9} />
          <path d="M67.5 118 L60 120" strokeWidth={7} />
          <g className={accentClassName}>
            {/* rising marker: he came up from the bow into a full stand */}
            <path d="M62 13 L72 6 L82 13" strokeWidth={5.5} />
          </g>
        </>
      )}

      {posture === 'sujud' && (
        <>
          {/* far knee, shin along the floor, toes tucked */}
          <g opacity={0.32}>
            <path d="M93 96 L84 114" strokeWidth={9.5} />
            <path d="M84.5 115.5 L99 112" strokeWidth={8.5} />
            <path d="M99 111 L103 116" strokeWidth={7} />
            {/* far hand on the floor behind the head */}
            <path d="M63.5 104.5 L57 113 L54 117" strokeWidth={7.5} />
            <circle cx="53.5" cy="117.5" r={4.2} fill="currentColor" stroke="none" />
          </g>
          <path d="M89 95 L79 113" strokeWidth={9.5} />
          <path d="M79.5 115.5 L96 112.5" strokeWidth={8.5} />
          <path d="M96 111.5 L100 116.5" strokeWidth={7} />
          {/* back sloping down to the shoulders */}
          <path d="M89.5 94 L61 105" strokeWidth={13} />
          {/* forehead resting on the floor, nose down */}
          <Head cx={46} cy={109.5} r={10} facing="downleft" />
          {/* near hand on the floor in front of the face: the head lies between the hands */}
          <path d="M60.5 105.5 L48.5 113.5 L36.5 116" strokeWidth={7.5} />
          <circle cx="36" cy={116.5} r={4.2} fill="currentColor" stroke="none" />
        </>
      )}

      {posture === 'jalsa' && (
        <>
          {/* far leg folded under, upright foot behind */}
          <g opacity={0.32}>
            <path d="M82 102 L58 114.5" strokeWidth={10} />
            <path d="M58.5 116 L82 114" strokeWidth={9} />
            <path d="M80.5 116.5 L86 104" strokeWidth={8} />
            <path d="M79 69.5 L74.5 88 L63.5 102" strokeWidth={7.5} />
            <circle cx="63" cy={102.5} r={4.1} fill="currentColor" stroke="none" />
          </g>
          {/* upright torso, sitting on the laid-flat foot */}
          <path d="M79.5 103 L76 67" strokeWidth={14} />
          <Head cx={73.5} cy={52} r={10.5} facing="left" />
          {/* near leg: knee on the floor, shin along it, upright foot under the body */}
          <path d="M78.5 102.5 L49.5 114" strokeWidth={10} />
          <path d="M50 116 L78.5 114.5" strokeWidth={9} />
          <path d="M77 117 L83.5 104.5" strokeWidth={8} />
          {/* hands resting on the thighs */}
          <path d="M76.5 70 L71 88 L60.5 103.5" strokeWidth={7.5} />
          <ellipse cx="59.5" cy={104} rx={4.6} ry={3.8} fill="currentColor" stroke="none" />
        </>
      )}

      {posture === 'tashahhud' && (
        <>
          <g opacity={0.32}>
            <path d="M82 102 L58 114.5" strokeWidth={10} />
            <path d="M58.5 116 L82 114" strokeWidth={9} />
            <path d="M80.5 116.5 L86 104" strokeWidth={8} />
            <path d="M79 69.5 L74.5 88 L63.5 102" strokeWidth={7.5} />
            <circle cx="63" cy={102.5} r={4.1} fill="currentColor" stroke="none" />
          </g>
          <path d="M79.5 103 L76 67" strokeWidth={14} />
          <Head cx={73.5} cy={52} r={10.5} facing="left" />
          <path d="M78.5 102.5 L49.5 114" strokeWidth={10} />
          <path d="M50 116 L78.5 114.5" strokeWidth={9} />
          <path d="M77 117 L83.5 104.5" strokeWidth={8} />
          <path d="M76.5 70 L71 88 L60.5 103.5" strokeWidth={7.5} />
          <ellipse cx="59.5" cy={104} rx={4.6} ry={3.8} fill="currentColor" stroke="none" />
          <g className={accentClassName}>
            {/* the raised index finger of the testimony */}
            <path d="M60.5 100.5 L54.5 86.5" strokeWidth={4.5} />
          </g>
        </>
      )}
    </svg>
  );
}
