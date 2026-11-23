import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BottomNav } from '@/components/BottomNav';

describe('BottomNav', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it.each(['nawafil', 'sunnah'] as const)(
    'keeps the more tab active on the %s screen',
    async (current) => {
      await act(async () => {
        root.render(<BottomNav current={current} onNavigate={() => undefined} />);
      });

      const activeTabs = container.querySelectorAll('[aria-current="page"]');
      expect(activeTabs).toHaveLength(2);
      expect(Array.from(activeTabs).every((tab) => tab.textContent?.includes('المزيد'))).toBe(true);
    },
  );
});
