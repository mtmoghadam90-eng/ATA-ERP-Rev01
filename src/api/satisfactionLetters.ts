import { api, buildQuery } from "./client";

/**
 * Customer satisfaction letters, across projects.
 *
 * The server answers with the whole filtered set rather than a page — the
 * amount and item-count filters are computed there, so a page would be the
 * wrong set. See the note at the top of `services/satisfactionLetters.ts`.
 *
 * Writing a letter is not here: a letter is a project document, so it is
 * written through the project's own endpoint like every other document.
 */

export interface SatisfactionLetter {
  id: string;
  name: string;
  url: string;
  size: string;
  createdAt: string;
}

export interface SatisfactionLetterRow {
  id: string;
  code: string;
  name: string;
  customerName: string;
  status: string;
  itemCount: number;
  /** Won-proforma value in rial; null when a foreign sale has no stored rate. */
  salesAmount: number | null;
  equipmentTypes: string[];
  letters: SatisfactionLetter[];
}

export interface SatisfactionLetterQuery {
  /** Indexed so it satisfies the client's `Query` shape without a cast. */
  [key: string]: string | undefined;
  search?: string;
  equipmentType?: string;
  minAmount?: string;
  maxAmount?: string;
  minItems?: string;
  maxItems?: string;
}

export interface SatisfactionLetterList {
  rows: SatisfactionLetterRow[];
  total: number;
  /** True when the server capped the result; the filters need narrowing. */
  truncated: boolean;
}

export const satisfactionLettersApi = {
  list: (query: SatisfactionLetterQuery = {}, signal?: AbortSignal) =>
    api.get<SatisfactionLetterList>("/api/projects/satisfaction-letters", query, signal),

  /**
   * The download URL for the filtered set as one zip.
   *
   * A URL rather than a fetch: the browser downloads it itself, so a large
   * archive never has to be held in memory as a blob, and the session cookie
   * rides along as it would on any other link.
   */
  zipUrl: (query: SatisfactionLetterQuery = {}) =>
    `/api/projects/satisfaction-letters/zip${buildQuery(query)}`,
};
