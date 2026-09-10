/*
 * Which logo is "the company's logo", answered once.
 *
 * It lives in `settings.proformaTemplates[].logoUrl` — the active template's,
 * falling back to the first — and that sentence was already written out twice
 * in `App.tsx` (the browser tab's icon, and the sidebar's). The login screen
 * needs it too, from the *server*, because nobody has signed in yet; a third
 * and fourth copy is how the tab comes to show one template's mark and the
 * sign-in page another.
 *
 * It takes `unknown` deliberately: the server holds the settings document as
 * parsed JSON with no type, and a screen holds `AppSettings`. One reading has
 * to accept both, so every step is guarded rather than asserted.
 */

interface TemplateLike {
  name?: unknown;
  logoUrl?: unknown;
}

function templatesOf(settings: unknown): TemplateLike[] {
  const list = (settings as { proformaTemplates?: unknown } | null | undefined)?.proformaTemplates;
  return Array.isArray(list) ? (list as TemplateLike[]) : [];
}

/** The template a document is printed from: the named one, else the first. */
export function activeTemplateOf(settings: unknown): TemplateLike | undefined {
  const templates = templatesOf(settings);
  const activeId = (settings as { activeTemplateId?: unknown } | null | undefined)?.activeTemplateId;
  return templates.find((t) => t.name === activeId) ?? templates[0];
}

/**
 * The company logo, or null when none is configured.
 *
 * Null is an ordinary answer and not a fault: a fresh installation has no
 * template logo until somebody uploads one, so every reader needs a mark of
 * its own to fall back to.
 */
export function brandLogoUrl(settings: unknown): string | null {
  const url = activeTemplateOf(settings)?.logoUrl;
  return typeof url === "string" && url.trim() ? url : null;
}
