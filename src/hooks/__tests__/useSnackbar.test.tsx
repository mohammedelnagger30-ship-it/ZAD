/**
 * The bar is the whole undo feature: if it disappears before the button can
 * be reached, or if the button does not run what it promises, then the
 * deletion has no way back and the screen is no better off than with a
 * confirmation dialog.
 *
 * So what is pinned here is the timing — the bar with a button outlives the
 * one without it — and the moment of the undo itself: the callback runs, and
 * the bar it belongs to is already gone when it does, so the re-render it
 * usually triggers never races a message that is still on screen.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';
import { jest } from '@jest/globals';

import { useSnackbar, type SnackbarOptions } from '@/hooks/useSnackbar';

let showSnackbar: ((options: SnackbarOptions) => void) | null = null;

/** The smallest screen that can host the hook: it only has to render it. */
function Harness() {
  const { show, snackbar } = useSnackbar();
  showSnackbar = show;
  return <div>{snackbar}</div>;
}

describe('useSnackbar', () => {
  let container: HTMLDivElement;
  let root: Root;
  let onAction: jest.Mock;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    jest.useFakeTimers();
    showSnackbar = null;
    onAction = jest.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    jest.useRealTimers();
  });

  /** Renders the harness, then shows a bar and returns the message it carries. */
  async function showAndRender(options: Partial<SnackbarOptions> = {}): Promise<string> {
    await act(async () => {
      root.render(<Harness /> as ReactElement);
    });
    const message = options.message ?? 'حُذفت العلامة.';
    await act(async () => {
      showSnackbar!({ ...options, message });
    });
    return message;
  }

  const buttonWith = (label: string) =>
    [...container.querySelectorAll('button')].find((button) => button.textContent?.trim() === label);

  const barIsShowing = () =>
    container.querySelector('[role="status"]') !== null;

  it('reports what happened and offers a way back', async () => {
    const message = await showAndRender({ action: { label: 'تراجع', onAction } });

    expect(container.textContent).toContain(message);
    expect(barIsShowing()).toBe(true);
    expect(buttonWith('تراجع')).toBeDefined();
  });

  it('runs the undo and takes the bar with it', async () => {
    await showAndRender({ action: { label: 'تراجع', onAction } });

    await act(async () => {
      buttonWith('تراجع')!.click();
    });

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(barIsShowing()).toBe(false);
  });

  /**
   * The two defaults exist so a bar with a button cannot vanish at the same
   * pace as one that has nothing to press — six seconds against three and a
   * half. Lose the ternary and undo silently stops being reachable, which no
   * rendering assertion would catch.
   */
  it('stays long enough to reach the undo button', async () => {
    await showAndRender({ action: { label: 'تراجع', onAction } });

    act(() => {
      jest.advanceTimersByTime(5900);
    });
    expect(barIsShowing()).toBe(true);

    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(barIsShowing()).toBe(false);
  });

  it('goes away on its own when there is no button to reach', async () => {
    await showAndRender();

    act(() => {
      jest.advanceTimersByTime(3400);
    });
    expect(barIsShowing()).toBe(true);

    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(barIsShowing()).toBe(false);
  });

  it('replaces what is on screen and starts the timing again', async () => {
    const first = await showAndRender({ message: 'الأول', action: { label: 'تراجع', onAction } });

    await act(async () => {
      showSnackbar!({ message: 'الثاني' });
    });
    expect(container.textContent).toContain('الثاني');
    expect(container.textContent).not.toContain(first);

    // The new bar got its full three and a half seconds, not what was left
    // of the first one's.
    act(() => {
      jest.advanceTimersByTime(3400);
    });
    expect(barIsShowing()).toBe(true);
    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(barIsShowing()).toBe(false);
  });
});
