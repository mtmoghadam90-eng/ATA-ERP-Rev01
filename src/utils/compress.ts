/**
 * LZW string compression, used to keep audit-log snapshots compact.
 *
 * The output is `[alphabet, codes]`: the distinct characters of the input
 * followed by codes that index into them, with learned sequences numbered from
 * the end of the alphabet upward.
 *
 * The previous version seeded the dictionary with character codes 0–255, which
 * only covers Latin-1. Every Persian character is above that range, so a single
 * Persian character was never in the dictionary, `dictionary[word]` produced
 * `undefined`, and `JSON.stringify` wrote it as `null` — leaving every snapshot
 * of Persian data unrecoverable, which in this application is all of them.
 *
 * Carrying the alphabet is what keeps it compact as well as correct. Encoding
 * each literal as its own code point would also round-trip, but a Persian
 * character is a six-digit number, and the "compressed" form came out several
 * times larger than the input it replaced.
 */

/** How many sequences to learn before starting over, to bound memory. */
const MAX_SEQUENCES = 16384;
export function compressLZW(uncompressed: string): string {
  if (!uncompressed) return '';

  const chars = [...uncompressed];
  const alphabet = [...new Set(chars)];
  const literal = new Map<string, number>(alphabet.map((c, i) => [c, i]));
  const firstSequence = alphabet.length;

  const dictionary = new Map<string, number>();
  let nextCode = firstSequence;

  const codeFor = (s: string): number | undefined =>
    literal.get(s) ?? dictionary.get(s);

  const result: number[] = [];
  let word = '';

  // Iterated by code point rather than by UTF-16 unit, so a character outside
  // the basic plane is not split into halves that mean nothing on their own.
  for (const c of chars) {
    const wc = word + c;
    if (word !== '' && codeFor(wc) !== undefined) {
      word = wc;
      continue;
    }

    if (word !== '') {
      result.push(codeFor(word)!);
      if (nextCode - firstSequence < MAX_SEQUENCES) {
        dictionary.set(wc, nextCode++);
      } else {
        dictionary.clear();
        nextCode = firstSequence;
      }
    }
    word = c;
  }

  if (word !== '') result.push(codeFor(word)!);

  return JSON.stringify([alphabet.join(''), result]);
}

export function decompressLZW(compressed: string): string {
  if (!compressed) return '';

  let parsed: unknown;
  try {
    parsed = JSON.parse(compressed);
  } catch {
    return compressed; // Not compressed at all — an older plain entry.
  }

  // Anything not shaped `[alphabet, codes]` predates this format. The old
  // encoder wrote a bare array of numbers containing `null` wherever it met a
  // character it could not encode, which is unrecoverable — saying so beats
  // guessing.
  if (!Array.isArray(parsed) || parsed.length !== 2) return '';
  const [alphabetRaw, codesRaw] = parsed as [unknown, unknown];
  if (typeof alphabetRaw !== 'string' || !Array.isArray(codesRaw)) return '';
  if (codesRaw.some((c) => typeof c !== 'number')) return '';

  const list = codesRaw as number[];
  if (list.length === 0) return '';

  const alphabet = [...alphabetRaw];
  const firstSequence = alphabet.length;

  const dictionary = new Map<number, string>();
  let nextCode = firstSequence;

  const stringFor = (code: number): string | undefined =>
    code < firstSequence ? alphabet[code] : dictionary.get(code);

  let previous = stringFor(list[0]);
  if (previous === undefined) return '';
  const result: string[] = [previous];

  for (let i = 1; i < list.length; i++) {
    const code = list[i];
    let current = stringFor(code);

    // The encoder can emit a code the moment it learns it, one step before the
    // decoder would; that case is always "the previous word plus its own first
    // character".
    if (current === undefined) {
      if (code !== nextCode) return '';
      current = previous + [...previous][0];
    }

    result.push(current);

    if (nextCode - firstSequence < MAX_SEQUENCES) {
      dictionary.set(nextCode++, previous + [...current][0]);
    } else {
      dictionary.clear();
      nextCode = firstSequence;
    }
    previous = current;
  }

  return result.join('');
}
