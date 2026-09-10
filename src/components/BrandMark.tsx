/*
 * The company's mark, in the one place both the sidebar and the login screen
 * read it from.
 *
 * Two states, and the fallback is the half that matters: a fresh installation
 * has no `logoUrl` until somebody uploads one, so the mark drawn when there is
 * none is what most databases show on their first day. It is the gauge the
 * sidebar has always drawn — precision instrumentation, which is the business —
 * and it was written out inside `Sidebar.tsx`; the login screen needing the
 * same thing is exactly when a second copy would have been made.
 *
 * `data-brand-mark` names which of the two is drawn, and it is not decoration:
 * both screens are full of lucide icons, which are `<svg>` too, so a render
 * test asking "is the fallback showing" by tag name is answered by a padlock
 * and passes whatever this component does. It was written that way first and
 * a negative check caught it.
 */

interface BrandMarkProps {
  logoUrl?: string | null;
  /** Pixel size of the fallback glyph. The tile around it is the caller's. */
  size?: number;
}

export default function BrandMark({ logoUrl, size = 24 }: BrandMarkProps) {
  if (logoUrl) {
    return (
      <img
        data-brand-mark="logo"
        src={logoUrl}
        alt="لوگو"
        className="w-full h-full object-contain"
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <svg
      data-brand-mark="fallback"
      className="text-sky-400"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Gauge representation for precision instrumentation & tools */}
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeWidth="1.5" className="stroke-sky-500/40" />
      <circle cx="12" cy="11" r="3.5" />
      <path d="M12 11l2-2" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="12" cy="11" r="1" fill="currentColor" />
    </svg>
  );
}
