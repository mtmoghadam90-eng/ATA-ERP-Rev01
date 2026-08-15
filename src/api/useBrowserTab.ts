import { useEffect } from "react";

/**
 * The browser tab's name and icon.
 *
 * The title is fixed — it is what the company calls the application — while the
 * icon follows the logo stored in settings, so a tab among a dozen others is
 * recognisable at a glance without anyone maintaining a second copy of the
 * image. `index.html` carries the title too, so the tab is right from the first
 * paint rather than after the settings arrive.
 *
 * The `<link rel="icon">` is replaced rather than mutated: Chrome and Safari
 * often ignore an `href` changed in place, and re-inserting the element is what
 * reliably makes them re-read it.
 */

export const APP_TITLE = "پنل کاری ارشیا";

export function useBrowserTab(logoUrl?: string | null): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.title !== APP_TITLE) document.title = APP_TITLE;
  }, []);

  useEffect(() => {
    if (typeof document === "undefined" || !logoUrl) return;

    const link = document.createElement("link");
    link.rel = "icon";
    link.href = logoUrl;

    // An uploaded logo is a path under /uploads; a seeded one may be a data URI.
    // Either works as an icon, but the type has to be right for the data URI.
    const dataType = /^data:([^;,]+)/.exec(logoUrl)?.[1];
    if (dataType) link.type = dataType;
    else if (/\.png($|\?)/i.test(logoUrl)) link.type = "image/png";
    else if (/\.svg($|\?)/i.test(logoUrl)) link.type = "image/svg+xml";
    else if (/\.jpe?g($|\?)/i.test(logoUrl)) link.type = "image/jpeg";

    const previous = Array.from(document.querySelectorAll("link[rel~='icon']"));
    previous.forEach((el) => el.remove());
    document.head.appendChild(link);

    return () => {
      link.remove();
      previous.forEach((el) => document.head.appendChild(el));
    };
  }, [logoUrl]);
}
