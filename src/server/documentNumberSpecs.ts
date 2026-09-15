import { getDb } from "./db";
import { nextDocumentNumber } from "./documentNumbers";
import {
  PROFORMA_FORMAT_FALLBACKS, PROFORMA_FORMAT_KEYS, proformaKindOf,
} from "../utils/moduleStatuses";

/**
 * The document-number specifications, in one place per document.
 *
 * They used to be written out inline in each route, which was fine while a
 * route was the only thing that issued a number. The assistant issues them too
 * now — a proforma it proposes has to be numbered the same way as one typed
 * into the form, off the same template and the same scoped sequence — and two
 * copies of a numbering rule is precisely how a series comes to have two
 * meanings. `test:rules` fails if a route grows its own copy again.
 */

/**
 * The next number for a quotation, off **its own kind's** template.
 *
 * The settings screen offers three — «پیش‌فاکتورهای مالی», «پیش‌فاکتورهای فنی»
 * and «پیش‌فاکتورهای خدمات پس از فروش» — and this read `proformaFormat` for all
 * three, so two of those boxes were configured, previewed on that very screen,
 * and used by nothing: a technical offer went out numbered as a financial one,
 * on a document a customer reads. `proformaKindOf` is the single rule and
 * `PROFORMA_FORMAT_KEYS` the single naming of the three settings keys.
 *
 * The **prefix** is what keeps the three series apart: `existing` counts the
 * numbers already issued under the rendered head, so «QT-ATA-05-38-» and
 * «QT-TECH-ATA-05-38-» step independently with one shared floor, and a document
 * on one kind does not advance another's next number.
 */
export async function nextProformaNumber(input: {
  projectId?: string | null;
  customerId?: string | null;
  proformaType?: string | null;
}): Promise<string> {
  const db = getDb();
  const kind = proformaKindOf(input.proformaType);
  const [project, customer] = await Promise.all([
    input.projectId
      ? db.project.findUnique({ where: { id: input.projectId }, select: { code: true } })
      : Promise.resolve(null),
    input.customerId
      ? db.customer.findUnique({ where: { id: input.customerId }, select: { companyName: true } })
      : Promise.resolve(null),
  ]);

  return nextDocumentNumber({
    formatKey: PROFORMA_FORMAT_KEYS[kind], startSeqKey: "proformaStartSeq",
    fallbackFormat: PROFORMA_FORMAT_FALLBACKS[kind],
    existing: async (prefix) => (await db.proforma.findMany({
      where: { proformaNumber: { startsWith: prefix } },
      select: { proformaNumber: true },
    })).map((r) => r.proformaNumber),
    taken: async (v) => !!(await db.proforma.findUnique({
      where: { proformaNumber: v }, select: { id: true },
    })),
    context: { projectCode: project?.code, customerName: customer?.companyName },
  });
}

export async function nextPackingListNumber(projectId: string): Promise<string> {
  const db = getDb();
  const project = await db.project.findUnique({
    where: { id: projectId }, select: { code: true },
  });

  return nextDocumentNumber({
    formatKey: "packingListFormat", startSeqKey: "packingListStartSeq",
    fallbackFormat: "PL-{PROJECT}-{SEQ:3}",
    existing: async (prefix) => (await db.packagingDelivery.findMany({
      where: { packingListNumber: { startsWith: prefix } },
      select: { packingListNumber: true },
    })).map((r) => r.packingListNumber),
    taken: async (v) => !!(await db.packagingDelivery.findUnique({
      where: { packingListNumber: v }, select: { id: true },
    })),
    context: { projectCode: project?.code ?? "GEN" },
  });
}
