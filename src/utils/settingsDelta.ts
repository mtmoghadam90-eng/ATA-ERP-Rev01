/**
 * A settings save sends what changed, not the whole document.
 *
 * `settings` is one JSON row, and every screen used to post the whole of it —
 * the copy that screen loaded when it was opened. So a second tab, or the same
 * person on their phone, holding a copy from before a change, overwrote that
 * change the next time it saved *anything*: «روش ارسال اعلان به همکاران» was
 * set to Telegram on one screen and read WhatsApp again after a refresh,
 * because a page opened earlier had since saved its own, older document.
 *
 * The delta is taken two levels deep, because that is the document's shape:
 * the top level is groups (`messaging`, `dropdownItems`, `requiredFields`), and
 * two screens editing one group — the quiet hours and the staff channel are both
 * `messaging` — must not overwrite each other either. Below that a value is
 * taken whole (an array is a list somebody edited, and merging lists would
 * resurrect entries they deleted — `mergeSettings`' rule).
 *
 * Pure so `test:rules` holds the round trip and the lost-update case.
 */

export interface SettingsDelta {
  /** Top-level keys set whole, or — for a plain object — the sub-keys that changed. */
  set: Record<string, unknown>;
  /** Paths removed: "key" or "key.sub". */
  removed: string[];
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function diffSettings(previous: unknown, next: unknown): SettingsDelta {
  const prev = isPlainObject(previous) ? previous : {};
  const nxt = isPlainObject(next) ? next : {};
  const set: Record<string, unknown> = {};
  const removed: string[] = [];

  for (const key of Object.keys(prev)) {
    if (!(key in nxt) || nxt[key] === undefined) {
      if (prev[key] !== undefined) removed.push(key);
    }
  }
  for (const [key, value] of Object.entries(nxt)) {
    if (value === undefined) continue;
    const before = prev[key];
    if (same(before, value)) continue;
    if (isPlainObject(before) && isPlainObject(value)) {
      const sub: Record<string, unknown> = {};
      for (const subKey of Object.keys(before)) {
        if (!(subKey in value) || value[subKey] === undefined) {
          if (before[subKey] !== undefined) removed.push(`${key}.${subKey}`);
        }
      }
      for (const [subKey, subValue] of Object.entries(value)) {
        if (subValue === undefined || same(before[subKey], subValue)) continue;
        sub[subKey] = subValue;
      }
      if (Object.keys(sub).length) set[key] = { __merge: true, ...sub };
    } else {
      set[key] = value;
    }
  }
  return { set, removed };
}

export function isEmptyDelta(delta: SettingsDelta): boolean {
  return Object.keys(delta.set).length === 0 && delta.removed.length === 0;
}

/** The stored document with a delta applied; the stored one is not mutated. */
export function applySettingsDelta(stored: unknown, delta: SettingsDelta): Record<string, unknown> {
  const out: Record<string, unknown> = isPlainObject(stored) ? { ...stored } : {};
  for (const [key, value] of Object.entries(delta.set ?? {})) {
    if (isPlainObject(value) && value.__merge === true) {
      const { __merge, ...sub } = value;
      void __merge;
      out[key] = { ...(isPlainObject(out[key]) ? out[key] as Record<string, unknown> : {}), ...sub };
    } else {
      out[key] = value;
    }
  }
  for (const path of delta.removed ?? []) {
    const [key, sub] = String(path).split(".", 2);
    if (sub === undefined) { delete out[key]; continue; }
    if (isPlainObject(out[key])) {
      const copy = { ...(out[key] as Record<string, unknown>) };
      delete copy[sub];
      out[key] = copy;
    }
  }
  return out;
}

/** A delta read off a request body, or null if it is not one. */
export function readSettingsDelta(body: unknown): SettingsDelta | null {
  if (!isPlainObject(body) || !isPlainObject(body.delta)) return null;
  const d = body.delta;
  if (!isPlainObject(d.set)) return null;
  const removed = Array.isArray(d.removed) ? d.removed.filter((p): p is string => typeof p === "string") : [];
  return { set: d.set, removed };
}
