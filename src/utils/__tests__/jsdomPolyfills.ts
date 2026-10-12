/**
 * jsdom test sandbox lacks Node's TextEncoder/TextDecoder globals, but
 * `utils/contentStore` builds one at module load. Import this module first
 * (before any app import) so the globals exist in time.
 */
import { TextDecoder, TextEncoder } from 'node:util';

if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = TextEncoder as typeof globalThis.TextEncoder;
}
if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = TextDecoder as typeof globalThis.TextDecoder;
}
