import { useEffect, useState } from 'react';
import { readerViewportStep } from '@/components/mushaf/readerConfig';

/**
 * The step a sheet of type grows by, kept live rather than read once at render.
 *
 * The reader typesets from a value that answers to the viewport, so a value captured
 * when the screen mounted stays right for as long as the viewport does not move — and
 * a tablet rotated from portrait to landscape is a different viewport entirely. One
 * animation-frame-coalesced listener turns the sheet again; nothing else in the app
 * needs to know that the size moved under it.
 */
export function useViewportStep(): number {
  const [step, setStep] = useState(readerViewportStep);

  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setStep(readerViewportStep()));
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return step;
}
