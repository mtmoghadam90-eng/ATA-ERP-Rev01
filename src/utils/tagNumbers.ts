export const MAX_TAG_NUMBERS_LENGTH = 20000;

/** A multiline list must survive every document in the sales/delivery chain. */
export function normalizeTagNumbers(input: unknown): string | null {
  const text = String(input ?? '').replace(/\r\n?/g, '\n').trim();
  if (!text) return null;
  if (text.length > MAX_TAG_NUMBERS_LENGTH) throw new Error('فهرست تگ‌نامبرها بیش از حد طولانی است؛ حداکثر ۲۰۰۰۰ نویسه وارد کنید.');
  return text;
}
