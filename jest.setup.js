/**
 * Jest global setup — polyfill TextEncoder/TextDecoder.
 *
 * jsdom 26+ (via whatwg-url) requires TextEncoder/TextDecoder as
 * globals.  jest-environment-jsdom provides them for tests that use
 * the @jest-environment jsdom docblock, but test files that directly
 * `require('jsdom')` load whatwg-url before the environment sets up
 * these globals.  This setup file ensures they exist early enough.
 */

const { TextEncoder, TextDecoder } = require('util');

if (typeof globalThis.TextEncoder === 'undefined') {
    globalThis.TextEncoder = TextEncoder;
}
if (typeof globalThis.TextDecoder === 'undefined') {
    globalThis.TextDecoder = TextDecoder;
}
