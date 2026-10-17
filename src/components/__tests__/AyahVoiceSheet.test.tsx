/**
 * التلاوة في ورقة الآية لا تُقطع عند أوّل ضربةٍ لساعة التشغيل.
 *
 * ظنَّ من صنع الوظيفة إنّ `handleVoiceTime` يُنادى بلا معامل، فجعل معامله
 * الأول `atEnd` يقول «انتهى المقطع». لكنّ React يرسل إلى كلّ معالج حدثَه
 * أوّلًا، فيصل إليها كائن الحدث — وهو حقيقةٌ لا كذب — فيقرأه المعالج
 * إيجابًا، ويظنّ كلّ تحديثٍ للتوقيت نهايةً للآية.
 *
 * وكانت العَرَضتان كلتاهما تنطبقان على ما شكا منه القارئ:
 *
 *   * بالنطاق «الآية» يتوقّف المقطع على أوّل تحديث — فلا تُسمع تلاوةٌ أصلًا.
 *   * وبالنطاق «السورة» يتقدّم آيةً في كلّ تحديث — فتقفز الصفحة قفزًا مبعثرًا.
 *
 * لذلك يَلزم أن يصل المعالج بلا معامل، وهذا ما يثبّته الاختبار: يُطلق حدث
 * `timeupdate` على عنصر الصوت المرسوم، ويَسأل إنّ المعالج لم يُنادَ بأيّ
 * معاملٍ بَعد — فإن دُعي بأحدها فقد أُعيد إليه الحدثُ نفسه.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement, RefObject } from 'react';

import { AyahVoiceSheet } from '@/components/mushaf/AyahVoiceSheet';

type Props = Parameters<typeof AyahVoiceSheet>[0];

/** The sheet's audio ref — plain, because `RefObject.current` is read-only in React 19. */
const REF: { current: HTMLAudioElement | null } = { current: null };

/** أقصر ورقةٍ تُظهر عنصر الصوت: لا يُشترى فيها تفعيلُ الأصوات، إذ ليس في الأمر صوت. */
function sheet(spy: (...args: unknown[]) => void, onEnded?: (...args: unknown[]) => void): ReactElement {
  const props: Props = {
    ayahChoice: { surahId: 1, ayahNumber: 1 },
    closeAyahChoice: () => {},
    ayahPanelRef: { current: null },
    setTafsirAyah: () => {},
    openVoice: () => {},
    voiceEngaged: true,
    voiceWholeFile: false,
    voiceHint: '',
    voiceScope: 'ayah',
    handleVoiceScope: () => {},
    reciterId: 'ar.alafasy',
    handleVoiceReciter: () => {},
    replayVoice: () => {},
    voicePhase: 'ready',
    voiceTime: { current: 0, duration: 0 },
    playbackRate: 1,
    repeatCount: 1,
    handleVoiceRate: () => {},
    handleRepeatCount: () => {},
    seekVoice: () => {},
    voicePrimaryDisabled: false,
    voicePrimaryLabel: 'استماع',
    voiceError: null,
    voiceAudioRef: REF as unknown as RefObject<HTMLAudioElement>,
    setVoicePlaying: () => {},
    handleVoiceTime: spy as Props['handleVoiceTime'],
    handleVoiceEnded: (onEnded ?? (() => {})) as Props['handleVoiceEnded'],
  };
  return <AyahVoiceSheet {...props} />;
}

describe('AyahVoiceSheet recitation transport', () => {
  let container: HTMLDivElement;
  let root: Root;
  let heard: unknown[][];

  const spy = (...args: unknown[]) => {
    heard.push(args);
  };

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    heard = [];
    REF.current = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(sheet(spy) as ReactElement);
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('sends the timeupdate to the handler with no argument, so «انتهى» stays false', async () => {
    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();

    await act(async () => {
      audio!.dispatchEvent(new Event('timeupdate'));
    });

    expect(heard.length).toBeGreaterThan(0);
    // The whole point: had the event been forwarded, `atEnd` would read it as
    // true and cut the recitation short on this very tick.
    expect(heard.every((args) => args.length === 0)).toBe(true);
  });

  it('proves React hands the event over — the mechanism the rule above guards', async () => {
    // `onEnded` is given bare, exactly as `onTimeUpdate` used to be, and it
    // receives the event. That is not a bug here only because `handleVoiceEnded`
    // takes no parameters and drops it; the identical wiring on the time handler
    // was the bug, since that one *reads* its first parameter.
    const endedHeard: unknown[][] = [];
    await act(async () => {
      root.render(
        sheet(spy, (...args) => endedHeard.push(args)) as ReactElement,
      );
    });

    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();

    await act(async () => {
      audio!.dispatchEvent(new Event('ended'));
    });

    expect(endedHeard).toHaveLength(1);
    expect(endedHeard[0]).toHaveLength(1);
    expect((endedHeard[0][0] as Event).type).toBe('ended');
  });
});
