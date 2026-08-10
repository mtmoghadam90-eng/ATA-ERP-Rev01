/**
 * A dropdown must be able to display whatever is stored in it.
 *
 * Every list of choices in this application is user-editable in settings, and
 * records keep the value that was chosen at the time. So a stored value can be
 * one the list no longer offers — the label was reworded, the entry retired, or
 * the record predates the list being customised at all.
 *
 * A `<select>` given a `value` none of its `<option>`s carry does not render
 * blank: it renders the *first* option. The screen then shows one thing while
 * the record holds another, and saving the form writes the shown value over the
 * real one. That is not hypothetical — it is how a sent proforma displayed as a
 * draft and was then saved back as one, and how the lead quality on a project
 * disagreed with what had been chosen.
 *
 * So: render the stored value as an option too, whenever the configured list
 * has no place for it.
 */
export function withStoredOption(options: string[] | undefined, stored: string | undefined | null): string[] {
  const list = options ?? [];
  const value = (stored ?? "").trim();
  if (!value || list.includes(value)) return list;
  return [...list, value];
}

/**
 * The value a fresh form should start on: the first configured choice.
 *
 * Not a hardcoded literal. A default written into the code is a value the
 * dropdown may not offer, which produces exactly the mismatch above — the form
 * shows the first option and saves the literal.
 */
export function firstOption(options: string[] | undefined, fallback: string): string {
  return (options ?? [])[0] ?? fallback;
}
