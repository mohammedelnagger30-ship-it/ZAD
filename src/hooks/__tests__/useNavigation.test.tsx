import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

import { useNavigation } from '@/hooks/useApp';

let navigation: ReturnType<typeof useNavigation>;

function Harness() {
  navigation = useNavigation();
  return <div>{navigation.screen}</div>;
}

describe('useNavigation', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.removeItem('zad:navigation-state');
    sessionStorage.removeItem('zad:navigation-state');
    Object.defineProperty(window, 'scrollTo', { value: () => undefined, configurable: true });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    localStorage.removeItem('zad:navigation-state');
  });

  async function renderNavigation() {
    await act(async () => {
      root.render(<Harness /> as ReactElement);
    });
  }

  it('restores the last screen, parameters, and back stack after a cold mount', async () => {
    await renderNavigation();
    expect(navigation.screen).toBe('home');

    act(() => {
      navigation.navigate('quran', { openPage: 18 });
      navigation.navigate('hadith', { query: 'حديث' });
      navigation.navigate('quran', { openPage: 22 });
    });

    expect(navigation.screen).toBe('quran');
    expect(navigation.history).toEqual(['home', 'quran']);
    expect(navigation.params).toEqual({ openPage: 22 });

    await act(async () => {
      root.unmount();
    });
    root = createRoot(container);
    await renderNavigation();

    expect(navigation.screen).toBe('quran');
    expect(navigation.history).toEqual(['home', 'quran']);
    expect(navigation.params).toEqual({ openPage: 22 });
  });

  it('returns to home from a restored single-screen route before allowing app exit', async () => {
    localStorage.setItem(
      'zad:navigation-state',
      JSON.stringify({ screen: 'quran', params: {}, history: ['quran'] }),
    );
    await renderNavigation();

    let wentBack: boolean | undefined;
    act(() => {
      wentBack = navigation.goBack();
    });

    expect(wentBack).toBe(true);
    expect(navigation.screen).toBe('home');
  });

  it('does not navigate back past the home screen', async () => {
    await renderNavigation();

    let wentBack: boolean | undefined;
    act(() => {
      wentBack = navigation.goBack();
    });

    expect(wentBack).toBe(false);
    expect(navigation.screen).toBe('home');
  });
});
