/**
 * How large a file this application accepts, said once.
 *
 * It was said in five places and they did not agree: three forms refused a
 * non-image over **2 MB** with their own hand-written check and their own
 * sentence, the server refused an image over **10 MB** and anything else over
 * **20 MB**, and multer stopped the request at 20 MB before any of them ran. So
 * the answer to «چقدر می‌توانم پیوست کنم» depended on which form you were
 * standing in — and the two forms that never grew a check of their own had no
 * limit at all until the upload was already on the wire.
 *
 * One number, enforced in exactly two places: in `uploadFile`, which is the
 * only path a browser has, so a form that never thought about it is covered;
 * and on the server, which is the authority and is what an integration posting
 * the same shape meets. A check in a component is a courtesy — it saves the
 * round trip and names the file — but it is never the rule.
 */

/** 20 MB, the same figure multer stops the request at. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Written out for a message, in Persian digits like everything a user reads. */
export const MAX_UPLOAD_LABEL = "۲۰ مگابایت";

/**
 * Why this file cannot be uploaded, or null.
 *
 * Names the file, because the forms that accept several at once would
 * otherwise say «one of these is too big» and leave somebody to work out
 * which. The size is in whole megabytes to one decimal — a figure a person
 * compares against the limit at a glance, not an exact byte count.
 */
export function oversizedUploadReason(file: { name?: string; size: number }): string | null {
  if (file.size <= MAX_UPLOAD_BYTES) return null;
  const mb = (file.size / (1024 * 1024)).toFixed(1);
  const named = file.name ? `«${file.name}» ` : "";
  return `${named}${mb} مگابایت است؛ حداکثر حجم مجاز ${MAX_UPLOAD_LABEL} می‌باشد.`;
}
