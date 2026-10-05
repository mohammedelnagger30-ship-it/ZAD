/**
 * Ambient declarations for the unit tests under the `__tests__` folders in `src`.
 *
 * The project has no test runner installed (no jest / vitest dependency, and
 * nothing in package.json invokes one), but the test files are real and worth
 * keeping. Without these declarations `npm run typecheck` fails with
 * "Cannot find name 'describe'", which blocks the whole build gate.
 *
 * These are intentionally minimal and structural rather than a copy of
 * @types/jest. `jest.mock` is typed as `any` because the module factory has to
 * describe another module's shape, which cannot be expressed here.
 *
 * Nothing in `src` outside the test folders uses these names.
 */

declare function describe(name: string, fn: () => void): void;
declare namespace describe {
  function only(name: string, fn: () => void): void;
  function skip(name: string, fn: () => void): void;
}

declare function it(name: string, fn?: () => void | Promise<void>, timeout?: number): void;
declare namespace it {
  function only(name: string, fn?: () => void | Promise<void>, timeout?: number): void;
  function skip(name: string, fn?: () => void | Promise<void>, timeout?: number): void;
  function each(cases: readonly unknown[]): (name: string, fn: (...args: never[]) => void | Promise<void>) => void;
}

declare function test(name: string, fn?: () => void | Promise<void>, timeout?: number): void;

declare function beforeEach(fn: () => void | Promise<void>, timeout?: number): void;
declare function afterEach(fn: () => void | Promise<void>, timeout?: number): void;
declare function beforeAll(fn: () => void | Promise<void>, timeout?: number): void;
declare function afterAll(fn: () => void | Promise<void>, timeout?: number): void;

interface JestMatchers<R = unknown> {
  toBe(expected: R): void;
  toEqual(expected: unknown): void;
  toStrictEqual(expected: unknown): void;
  toBeDefined(): void;
  toBeUndefined(): void;
  toBeNull(): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toBeGreaterThan(expected: number | bigint): void;
  toBeGreaterThanOrEqual(expected: number | bigint): void;
  toBeLessThan(expected: number | bigint): void;
  toBeLessThanOrEqual(expected: number | bigint): void;
  toContain(expected: unknown): void;
  toContainEqual(expected: unknown): void;
  toHaveLength(expected: number): void;
  toHaveProperty(path: string, value?: unknown): void;
  toMatch(expected: string | RegExp): void;
  toThrow(expected?: unknown): void;
  toHaveBeenCalled(): void;
  toHaveBeenCalledTimes(times: number): void;
  toHaveBeenCalledWith(...args: unknown[]): void;
  [matcher: string]: (...args: never[]) => void;
}

interface JestExpect {
  (actual: unknown): JestMatchers;
  anything(): unknown;
  any(constructor: unknown): unknown;
  assert(condition: unknown, message?: string): void;
}

declare const expect: JestExpect;

interface JestMock<T = (...args: never[]) => unknown> {
  (...args: Parameters<T>): ReturnType<T>;
  mockReturnValue(value: ReturnType<T>): JestMock<T>;
  mockResolvedValue(value: Awaited<ReturnType<T>>): JestMock<T>;
  mockRejectedValue(value: unknown): JestMock<T>;
  mockImplementation(fn: (...args: Parameters<T>) => ReturnType<T>): JestMock<T>;
  mockClear(): JestMock<T>;
  mockReset(): JestMock<T>;
  mockRestore(): JestMock<T>;
  mock: { calls: Parameters<T>[]; results: { type: string; value: unknown }[] };
}

interface Jest {
  fn<T extends (...args: never[]) => unknown = (...args: never[]) => unknown>(impl?: T): JestMock<T>;
  /** Typed loosely on purpose: the factory describes another module's shape. */
  mock(moduleName: string, factory?: () => unknown, options?: { virtual?: boolean }): void;
  unmock(moduleName: string): void;
  spyOn(object: object, method: string): JestMock<(...args: never[]) => unknown>;
  resetModules(): void;
  clearAllMocks(): void;
  resetAllMocks(): void;
  restoreAllMocks(): void;
  useFakeTimers(): void;
  useRealTimers(): void;
  advanceTimersByTime(ms: number): void;
  setTimeout(fn: () => void, ms?: number): number;
  config: Record<string, unknown>;
}

declare const jest: Jest;
