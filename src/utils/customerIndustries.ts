const key = (value: string) => value.trim().replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[\s\u200c]+/g, ' ').toLowerCase();

export function appendIndustry(options: readonly string[], input: unknown): { industries: string[]; value: string } {
  const value = typeof input === 'string' ? input.trim().replace(/\s+/g, ' ') : '';
  if (!value || value.length > 200) throw new Error('نام صنعت را بین ۱ تا ۲۰۰ نویسه وارد کنید.');
  const existing = options.find((option) => key(option) === key(value));
  return { industries: existing ? [...options] : [...options, value], value: existing ?? value };
}
