import path from "path";
import fs from "fs";

/**
 * Where uploaded files live, and the one place that maps a `/uploads/...` URL
 * back to a path on disk.
 *
 * Both halves have to agree or the guard is worthless: `/api/upload` writes
 * here, and the satisfaction-letter zip reads back out of here. A second
 * `path.join(process.cwd(), "uploads")` written next to the reader would be
 * correct right up until one of them moved.
 */
export const UPLOADS_DIR = path.join(process.cwd(), "uploads");

export function ensureUploadsDir(): void {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

/**
 * Resolves a stored `/uploads/...` URL to a real file, or null.
 *
 * Null covers every reason the file cannot be served: a URL that is not an
 * upload at all (a data: URI, an external link, a `?printModule=` route), one
 * that escapes the uploads directory, and one that simply is not there any
 * more. The caller skips it rather than failing the whole download — a zip of
 * forty letters must not be lost to one deleted file.
 *
 * The containment check is done on the *resolved* path, so `..` segments and
 * URL-encoded ones cannot walk out of the directory: `/uploads/../../.env`
 * resolves outside UPLOADS_DIR and is rejected here even though it looks like
 * an uploads path.
 */
export function resolveUploadPath(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;

  // Only files this server stored. Anything else has no path on this disk.
  const marker = "/uploads/";
  if (!url.startsWith(marker)) return null;

  let relative: string;
  try {
    // Names are percent-encoded by the browser when the URL is built.
    relative = decodeURIComponent(url.slice(marker.length));
  } catch {
    return null;
  }
  if (!relative) return null;

  const resolved = path.resolve(UPLOADS_DIR, relative);
  const root = path.resolve(UPLOADS_DIR);
  // `startsWith(root)` alone would also accept a sibling like `uploads-old`.
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;

  try {
    if (!fs.statSync(resolved).isFile()) return null;
  } catch {
    return null;
  }
  return resolved;
}
