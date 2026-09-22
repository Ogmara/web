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

/**
 * Every codepoint the node refuses in self-declared, wallet-supplied text
 * (protocol §3.11's descriptor rule, reused verbatim for message button
 * `label`/`command` — protocol §3.3), mirrored from `@ogmara/sdk`'s
 * `FORBIDDEN_DESCRIPTOR_CHARS`.
 *
 * `stripBidi()` above is a STRICT SUBSET of this — it misses U+061C, U+200B,
 * U+2060-U+2064, U+FEFF, U+FFF9-U+FFFB and the U+E0000 tag block, which is
 * the primitive behind invisible-text smuggling. Since the whole point of
 * sanitizing here is defending against a node that never validated (any
 * node predating the field this string belongs to), a filter laxer than the
 * node's own defeats its own purpose.
 *
 * U+200C ZWNJ and U+200D ZWJ are deliberately NOT stripped — ZWJ is required
 * for emoji sequences and ZWNJ for Persian and Indic orthography, and
 * neither can reorder text.
 */
const FORBIDDEN_DESCRIPTOR_CHARS = new RegExp(
  '[' +
    '\\u0000-\\u001F\\u007F-\\u009F' +
    '\\u061C\\u200B\\u200E\\u200F' +
    '\\u2028\\u2029' +
    '\\u202A-\\u202E' +
    '\\u2060-\\u2064' +
    '\\u2066-\\u2069' +
    '\\uFEFF\\uFFF9-\\uFFFB' +
  ']|[\\u{E0000}-\\u{E007F}]',
  'gu',
);

/** Render-time sanitizer for any self-declared, wallet-supplied string. */
export function safeText(s: string | null | undefined): string {
  return stripBidi(s ?? '').replace(FORBIDDEN_DESCRIPTOR_CHARS, '');
}
