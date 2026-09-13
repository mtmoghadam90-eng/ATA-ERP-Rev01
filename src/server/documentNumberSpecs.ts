import { getDb } from "./db";
import { nextDocumentNumber } from "./documentNumbers";

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

export async function nextProformaNumber(input: {
  projectId?: string | null;
  customerId?: string | null;
}): Promise<string> {
  const db = getDb();
  const [project, customer] = await Promise.all([
    input.projectId
      ? db.project.findUnique({ where: { id: input.projectId }, select: { code: true } })
      : Promise.resolve(null),
    input.customerId
      ? db.customer.findUnique({ where: { id: input.customerId }, select: { companyName: true } })
      : Promise.resolve(null),
  ]);

  return nextDocumentNumber({
    formatKey: "proformaFormat", startSeqKey: "proformaStartSeq",
    fallbackFormat: "QT-{PROJECT}-{SEQ:2}",
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
