/**
 * Input sanitization helpers for the web renderer.
 *
 * Mirrors the equivalent module in the desktop app — kept as its own
 * file so future audits can grep for `stripBidi(` to confirm every
 * untrusted-text boundary is gated.
 */

/**
 * Strip Unicode control codepoints and bidirectional override
 * characters from a string. Used wherever we render attacker-
 * influenceable text — chiefly attachment filenames pulled from the
 * chain payload, which a hostile uploader could craft to inject a
 * U+202E and visually reverse the trailing extension (e.g. making a
 * `report-fdp.exe` look like `report-exe.pdf`).
 *
 * Stripped ranges:
 *  - U+0000..U+001F, U+007F..U+009F : control characters
 *  - U+200E, U+200F                 : LRM / RLM marks
 *  - U+202A..U+202E                 : explicit bidi formatting
 *  - U+2066..U+2069                 : isolate-format bidi
 *  - U+2028, U+2029                 : line / paragraph separators
 *  - U+FEFF                         : BOM / zero-width no-break space
 */
const BIDI_AND_CONTROL_RE = new RegExp(
  '[' +
    '\\u0000-\\u001F\\u007F-\\u009F' +
    '\\u200E\\u200F' +
    '\\u202A-\\u202E' +
    '\\u2066-\\u2069' +
    '\\u2028\\u2029' +
    '\\uFEFF' +
  ']',
  'g',
);

export function stripBidi(s: string): string {
  if (!s) return '';
  return s.replace(BIDI_AND_CONTROL_RE, '');
}
