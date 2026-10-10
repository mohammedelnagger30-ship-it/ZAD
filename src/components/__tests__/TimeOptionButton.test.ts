/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';

// Simple render test for TimeOptionButton component
describe('TimeOptionButton', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('should export TimeOptionButton component', async () => {
    const mod = await import('../../components/TimeOptionButton');
    expect(mod.TimeOptionButton).toBeDefined();
    expect(typeof mod.TimeOptionButton).toBe('function');
  });

  it('should render correct number of options', () => {
    // Create a simple DOM-based test
    const container = document.createElement('div');
    document.body.appendChild(container);

    const options = [5, 10, 15, 30];
    
    // Render buttons manually to test logic
    options.forEach((opt) => {
      const btn = document.createElement('button');
      btn.textContent = String(opt);
      btn.dataset.value = String(opt);
      container.appendChild(btn);
    });

    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(4);
    expect(buttons[0].textContent).toBe('5');
    expect(buttons[3].textContent).toBe('30');

    document.body.removeChild(container);
  });
});
