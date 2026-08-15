import { Prisma } from "@prisma/client";

/**
 * Drops catalogue references that no longer point at anything.
 *
 * Document lines (proforma, purchase order, delivery, inquiry, project item)
 * carry `productId` and `variantId` as real foreign keys. When a client sends
 * one that does not exist the insert fails with P2003, the whole save is lost,
 * and the user is told the record "cannot be deleted because other records
 * depend on it" — which is what the foreign-key mapping says and has nothing to
 * do with what they were doing.
 *
 * That is not hypothetical. The proforma configurator invented a variant id
 * (`var-<timestamp>`) for a combination it had just auto-created, saved the
 * product without waiting, and put its own id on the line — but the server
 * assigns the variant's id itself, so the line referenced a SKU that never
 * existed under that id and the whole proforma failed to save.
 *
 * The line's own text — product name, code, SKU string, specs — is stored on
 * the line, so dropping a dangling link loses the catalogue *link*, not the
 * content of the document. Losing the link is recoverable by re-picking the
 * product; losing the save is not.
 */
export async function scrubProductRefs<T extends { productId?: string | null; variantId?: string | null }>(
  tx: Prisma.TransactionClient,
  rows: T[] | undefined,
): Promise<T[] | undefined> {
  if (!rows || rows.length === 0) return rows;

  const productIds = [...new Set(rows.map((r) => r.productId).filter((v): v is string => !!v))];
  const variantIds = [...new Set(rows.map((r) => r.variantId).filter((v): v is string => !!v))];
  if (productIds.length === 0 && variantIds.length === 0) return rows;

  const [products, variants] = await Promise.all([
    productIds.length
      ? tx.product.findMany({ where: { id: { in: productIds } }, select: { id: true } })
      : Promise.resolve([]),
    variantIds.length
      ? tx.productVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true } })
      : Promise.resolve([]),
  ]);

  const knownProducts = new Set(products.map((p) => p.id));
  const knownVariants = new Set(variants.map((v) => v.id));

  return rows.map((row) => {
    const badProduct = !!row.productId && !knownProducts.has(row.productId);
    const badVariant = !!row.variantId && !knownVariants.has(row.variantId);
    if (!badProduct && !badVariant) return row;
    return {
      ...row,
      ...(badProduct ? { productId: null } : {}),
      ...(badVariant ? { variantId: null } : {}),
    };
  });
}
