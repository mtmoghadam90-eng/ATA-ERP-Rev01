/**
 * Makes a generated document stand on its own.
 *
 * The printable documents this application produces are downloaded as HTML
 * files and then opened from disk, emailed, or printed on a machine that has
 * never heard of the server. Every image in them — the company logo, the seal,
 * a signature, a product photo — is stored as a root-relative path like
 * `/uploads/logo.png`, because that is what the upload endpoint returns and
 * what works inside the running application.
 *
 * Opened from disk, `/uploads/logo.png` resolves against the *file* — to
 * `file:///uploads/logo.png` — and nothing is there. So the logo and the seal
 * were simply missing from every packing list and proforma anyone saved.
 *
 * The fix is to carry the pictures rather than point at them: each one is
 * fetched while the browser still has a session and embedded as a `data:` URI.
 * The result is one file with nothing outside it, which is what "standalone
 * printable file" was always supposed to mean.
 */

/** Same-origin paths only: an absolute URL elsewhere already resolves. */
const LOCAL_SRC = /(?:src|href)="(\/[^"/][^"]*)"/g;

async function toDataUri(path: string): Promise<string | null> {
  try {
    // Same origin, so the session cookie goes with it and a guarded upload
    // folder still answers.
    const response = await fetch(path, { credentials: "same-origin" });
    if (!response.ok) return null;

    const blob = await response.blob();
    // Only pictures: a stylesheet or a script has no business being inlined
    // here, and a large PDF would bloat the file for nothing.
    if (!blob.type.startsWith("image/")) return null;

    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Replaces same-origin image paths with `data:` URIs.
 *
 * Anything that cannot be fetched is rewritten to an absolute URL instead, so a
 * reader who is on the network still sees it rather than a broken frame. Never
 * throws: a document with a missing picture is worth far more than no document.
 */
export async function inlineDocumentAssets(html: string): Promise<string> {
  const paths = [...new Set([...html.matchAll(LOCAL_SRC)].map((m) => m[1]))];
  if (paths.length === 0) return html;

  const inlined = new Map<string, string>();
  await Promise.all(paths.map(async (path) => {
    const dataUri = await toDataUri(path);
    inlined.set(path, dataUri ?? new URL(path, window.location.origin).href);
  }));

  // Replaced by exact attribute text, so a path that is a prefix of another
  // cannot be corrupted — `/uploads/a.png` never rewrites `/uploads/ab.png`.
  return html.replace(LOCAL_SRC, (whole, path: string) => {
    const replacement = inlined.get(path);
    return replacement ? whole.replace(`"${path}"`, `"${replacement}"`) : whole;
  });
}
