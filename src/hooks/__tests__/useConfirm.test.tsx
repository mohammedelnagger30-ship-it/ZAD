/**
 * `useConfirm` promises four things, and every one of them is about a handler
 * not hanging: an answer arrives when a button is pressed, "no" arrives when
 * the dialog goes away for any other reason, a second prompt does not leave
 * the first waiting forever, and a screen unmounting under an open dialog
 * still wakes whatever asked.
 *
 * Those are the failure modes that would show up as a button that stops
 * working rather than as a test failure, so they are pinned here.
 *
 * The harness returns `{ answer }` rather than the promise itself. An `async`
 * function flattens any promise it returns — `return answer` would make it
 * settle only when *the answer* settles, so awaiting it would deadlock the
 * very test that is supposed to produce the answer.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

import { useConfirm, type ConfirmOptions } from '@/hooks/useConfirm';

let askConfirm: ((options: ConfirmOptions) => Promise<boolean>) | null = null;

/** The smallest screen that can host the hook: it only has to render it. */
function Harness() {
  const { confirm, dialog } = useConfirm();
  askConfirm = confirm;
  return <div>{dialog}</div>;
}

describe('useConfirm', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    askConfirm = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  /**
   * Renders the harness and raises a prompt, returning the promise it answers.
   *
   * Two separate acts: `root.render` commits on a microtask, so the hook's
   * `confirm` does not exist yet on the line after it — the harness has to be
   * on screen before it can be asked anything.
   */
  async function raisePrompt(options: Partial<ConfirmOptions> = {}): Promise<{
    answer: Promise<boolean>;
  }> {
    await act(async () => {
      root.render(<Harness /> as ReactElement);
    });
    let answer: Promise<boolean> | undefined;
    await act(async () => {
      answer = askConfirm!({ title: 'حذف', ...options });
      // Flush the state the prompt sets so its dialog is on screen.
      await Promise.resolve();
    });
    return { answer: answer! };
  }

  const buttonWith = (label: string) =>
    [...container.querySelectorAll('button')].find((button) => button.textContent?.trim() === label);

  it('answers yes when the confirm button is pressed', async () => {
    const { answer } = await raisePrompt({ confirmLabel: 'حذف' });

    expect(buttonWith('حذف')).toBeDefined();
    await act(async () => {
      buttonWith('حذف')!.click();
    });
    await expect(answer).resolves.toBe(true);
  });

  it('answers no when the person cancels', async () => {
    const { answer } = await raisePrompt();

    await act(async () => {
      buttonWith('إلغاء')!.click();
    });
    await expect(answer).resolves.toBe(false);
  });

  /**
   * Two prompts can only be on screen at once if a second was raised before
   * the first was answered — two taps inside the same frame. The second does
   * not answer the first, and nothing else ever will, so the first has to be
   * cancelled outright rather than left waiting.
   */
  it('cancels a prompt left unanswered by a second one', async () => {
    const { answer: first } = await raisePrompt({ confirmLabel: 'حذف' });

    let second: Promise<boolean> | undefined;
    await act(async () => {
      second = askConfirm!({ title: 'استعادة' });
      await Promise.resolve();
    });
    await expect(first).resolves.toBe(false);

    // The screen now holds the second prompt, and it still answers.
    await act(async () => {
      buttonWith('إلغاء')!.click();
    });
    await expect(second!).resolves.toBe(false);
  });

  it('does not leave a handler hanging when the screen unmounts beneath it', async () => {
    const { answer } = await raisePrompt({ confirmLabel: 'حذف' });

    await act(async () => {
      root.unmount();
    });
    await expect(answer).resolves.toBe(false);
  });
});
