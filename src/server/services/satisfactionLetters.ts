import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { AuthUser } from "../auth";
import { fromJsonColumn } from "../childSync";
import { visibilityClause } from "./projectService";
import { summarizeProjectFinance } from "./projectFinance";
import { SATISFACTION_LETTER_KIND } from "./projectDocuments";

/**
 * Customer satisfaction letters, gathered across projects.
 *
 * A letter is not a table: it is an entry in the project's `manualDocuments`
 * JSON tagged `kind: 'satisfactionLetter'`, filed like any other project
 * document. That keeps one document store per project — the letter shows up in
 * the project's documents tab for free, and deleting the project takes its
 * letters with it — at the cost of this module, which is the only place that
 * has to know how to read them back out.
 *
 * **On paging.** This deliberately answers with the whole matching set rather
 * than a page, because two of the three filters cannot be expressed in SQL
 * here: the amount is computed from won proformas (`summarizeProjectFinance`),
 * and Prisma cannot put a relation count in a `where`. Paging first and
 * filtering after would page the wrong set — the exact failure the move to SQL
 * was meant to end. So the whole-set work happens **here**, on the server, over
 * a set the `kind` pre-filter already makes small, and the client receives a
 * finished list. `MAX_ROWS` bounds it, and `truncated` says so out loud rather
 * than quietly dropping rows.
 */

/** Enough for every letter this company will file; a guard, not a page size. */
const MAX_ROWS = 500;

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
  /** Won-proforma value in rial. Null when a foreign sale has no stored rate. */
  salesAmount: number | null;
  equipmentTypes: string[];
  letters: SatisfactionLetter[];
}

export interface SatisfactionLetterFilters {
  search?: unknown;
  equipmentType?: unknown;
  minAmount?: unknown;
  maxAmount?: unknown;
  minItems?: unknown;
  maxItems?: unknown;
}

/** A stored manual document, as the JSON column carries it. */
interface ManualDocument {
  id?: string;
  kind?: string;
  folderName?: string;
  name?: string;
  url?: string;
  size?: string;
  createdAt?: string;
}

const str = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

/** A bound the user left blank is not a bound. */
const num = (value: unknown): number | undefined => {
  const raw = str(value);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** The letters on one project, in the order they were filed. */
export function lettersOf(manualDocuments: string | null): SatisfactionLetter[] {
  const parsed = fromJsonColumn<ManualDocument[]>(manualDocuments, []);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((doc) => doc && doc.kind === SATISFACTION_LETTER_KIND && str(doc.url))
    .map((doc, index) => ({
      id: str(doc.id) ?? `letter-${index}`,
      name: str(doc.name) ?? "رضایت‌نامه",
      url: doc.url as string,
      size: str(doc.size) ?? "",
      createdAt: str(doc.createdAt) ?? "",
    }));
}

/**
 * Every project carrying at least one satisfaction letter, filtered.
 *
 * `manualDocuments: { contains }` is a `LIKE` over the JSON text — a cheap
 * pre-filter that SQL Server can run, not the authority. `lettersOf` parses
 * each candidate and decides, so a project whose JSON merely mentions the word
 * is dropped here rather than shown with no letters.
 */
export async function listSatisfactionLetters(
  user: AuthUser,
  filters: SatisfactionLetterFilters = {},
): Promise<{ rows: SatisfactionLetterRow[]; total: number; truncated: boolean }> {
  const db = getDb();

  const and: Record<string, unknown>[] = [];
  const visibility = visibilityClause(user);
  if (visibility) and.push(visibility);

  // Only projects that could have a letter. Narrows the set before anything is
  // parsed or any finance is computed.
  and.push({ manualDocuments: { contains: SATISFACTION_LETTER_KIND } });

  const equipmentType = str(filters.equipmentType);
  if (equipmentType) and.push({ items: { some: { equipmentType } } });

  const search = str(filters.search);
  if (search) {
    and.push({
      OR: [
        { code: { contains: search } },
        { name: { contains: search } },
        { customer: { companyName: { contains: search } } },
      ],
    });
  }

  const candidates = await db.project.findMany({
    where: { AND: and } as Prisma.ProjectWhereInput,
    orderBy: { createdAt: "desc" },
    select: {
      id: true, code: true, name: true, status: true,
      manualDocuments: true,
      customer: { select: { companyName: true } },
      items: { select: { equipmentType: true } },
      _count: { select: { items: true } },
    },
  });

  // Parsing decides what the LIKE only guessed at.
  const withLetters = candidates
    .map((project) => ({ project, letters: lettersOf(project.manualDocuments) }))
    .filter((entry) => entry.letters.length > 0);

  // The amount is won-proforma value, which is computed rather than stored, so
  // it can only be filtered once it exists. One batch for the whole set.
  const finance = await summarizeProjectFinance(withLetters.map((e) => e.project.id));

  const minAmount = num(filters.minAmount);
  const maxAmount = num(filters.maxAmount);
  const minItems = num(filters.minItems);
  const maxItems = num(filters.maxItems);

  const rows: SatisfactionLetterRow[] = [];
  for (const { project, letters } of withLetters) {
    const itemCount = project._count.items;
    if (minItems !== undefined && itemCount < minItems) continue;
    if (maxItems !== undefined && itemCount > maxItems) continue;

    const salesAmount = finance.get(project.id)?.salesAmount ?? null;
    // A sale with no valuable rate is unknown, not zero — an unknown amount
    // cannot satisfy a bound, so a bounded search leaves it out.
    if (minAmount !== undefined && (salesAmount === null || salesAmount < minAmount)) continue;
    if (maxAmount !== undefined && (salesAmount === null || salesAmount > maxAmount)) continue;

    rows.push({
      id: project.id,
      code: project.code,
      name: project.name,
      customerName: project.customer?.companyName ?? "",
      status: project.status,
      itemCount,
      salesAmount,
      equipmentTypes: [...new Set(
        project.items.map((item) => item.equipmentType).filter((t): t is string => !!t),
      )],
      letters,
    });
  }

  return {
    rows: rows.slice(0, MAX_ROWS),
    total: rows.length,
    truncated: rows.length > MAX_ROWS,
  };
}
