import { AVATAR_SIZES, AvatarSize, avatarColors, initialsOf } from '../utils/avatar';

/*
 * A person, drawn beside their name.
 *
 * One component for all three places — the sidebar's signed-in account, the
 * users grid, and every message in a project's feed — because the feed's is the
 * one with a constraint on it («خیلی کوچیک», so the messages stay the thing
 * being read) and a second copy is how that constraint comes to hold on one
 * screen and not the others.
 *
 * It draws exactly one element. In the feed it takes the place of the generic
 * person glyph that was already in the author chip, so the card gains nothing:
 * the same box, now saying who rather than saying «somebody».
 */

interface AvatarProps {
  name: string | null | undefined;
  url?: string | null;
  size?: AvatarSize;
  /** Extra classes for the caller's own layout — never for the size. */
  className?: string;
}

export default function Avatar({ name, url, size = 'sm', className = '' }: AvatarProps) {
  const { px, initials: maxInitials } = AVATAR_SIZES[size];
  const label = String(name ?? '').trim();
  const initials = initialsOf(label, maxInitials);
  const { bg, fg, ring } = avatarColors(label);

  /*
   * The box is fixed in both states and set inline rather than by a class.
   * A photograph that arrives after the row is drawn must not move the text
   * beside it, and these are three sizes rather than a scale — a Tailwind
   * class per size would be three more names to keep in step with the table
   * that already decides them.
   */
  const box = {
    width: px,
    height: px,
    minWidth: px,
    // Beneath the smallest legible size the letter is a smudge, so the disc
    // shows colour alone rather than a glyph nobody can read.
    fontSize: Math.max(9, Math.round(px * 0.42)),
  };

  if (url) {
    return (
      <img
        src={url}
        alt={label || 'کاربر'}
        title={label || undefined}
        data-avatar="photo"
        className={`rounded-full object-cover bg-slate-100 ${className}`}
        style={{ ...box, boxShadow: `inset 0 0 0 1px ${ring}` }}
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <span
      title={label || undefined}
      data-avatar="initials"
      aria-hidden={!label}
      className={`rounded-full inline-flex items-center justify-center font-bold leading-none select-none ${className}`}
      style={{ ...box, backgroundColor: bg, color: fg, boxShadow: `inset 0 0 0 1px ${ring}` }}
    >
      {initials}
    </span>
  );
}
