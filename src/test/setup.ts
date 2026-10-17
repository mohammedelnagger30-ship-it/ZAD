/**
 * jsdom does not ship `TextEncoder` / `TextDecoder`, and Node keeps them behind
 * `node:util` rather than on the global object inside the jsdom environment.
 *
 * Several modules compute byte lengths at import time — `contentStore` builds its
 * encoder in the module body, so a test that merely imports anything in the content
 * chain dies with `ReferenceError: TextEncoder is not defined` before it renders a
 * single element. Polyfilling here, once, keeps every test free of that concern.
 */
import { TextDecoder, TextEncoder } from 'node:util';

const scope = globalThis as unknown as Record<string, unknown>;

if (typeof scope.TextEncoder === 'undefined') scope.TextEncoder = TextEncoder;
if (typeof scope.TextDecoder === 'undefined') scope.TextDecoder = TextDecoder;
