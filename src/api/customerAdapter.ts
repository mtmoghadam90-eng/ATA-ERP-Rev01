import type { Customer } from "../types";
import type { CustomerDetail, CustomerRow, CustomerWriteInput } from "./customers";
import { assertComplete, markComplete, markPartial } from "./partial";

/**
 * Translation between the API's shapes and the `Customer` shape the views were
 * written against.
 *
 * The two differ in three places, all of them deliberate on the server side:
 * links are rows rather than an id array, custom values are a JSON column rather
 * than an object, and agreements are a child table. Keeping the translation here
 * means the existing forms and grids keep working against the type they already
 * know, instead of every one of them learning the wire format.
 *
 * This is a seam, not a permanent layer: as each view is migrated it can drop to
 * the API types directly. It exists so the migration is one change at a time.
 */

function parseCustomValues(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    // Malformed JSON in one record must not break the whole grid.
    return {};
  }
}

/** A grid row, in the shape the existing table markup expects. */
export function rowToCustomer(row: CustomerRow): Customer {
  return markPartial({
    id: row.id,
    createdAt: row.createdAt,
    customerType: row.customerType as Customer["customerType"],
    status: row.status as Customer["status"],
    companyName: row.companyName,
    firstName: row.firstName ?? undefined,
    lastName: row.lastName ?? undefined,
    economicCode: row.economicCode ?? undefined,
    industry: row.industry ?? undefined,
    phone: row.phone ?? undefined,
    mobile: row.mobile ?? undefined,
    email: row.email ?? undefined,
    province: row.province ?? undefined,
    city: row.city ?? undefined,
    tags: row.tags ?? undefined,
    linkedCustomerIds: row.linksFrom.map((link) => link.to.id),
    customValues: parseCustomValues(row.customValues),
    // Present on the detail record only; the grid does not show them.
    contactName: "",
    contactLastName: "",
  } as Customer);
}

/** The full record, for the edit form. */
export function detailToCustomer(detail: CustomerDetail): Customer {
  return markComplete({
    ...rowToCustomer(detail),
    gender: (detail.gender ?? undefined) as Customer["gender"],
    position: detail.position ?? undefined,
    keyPerson: detail.keyPerson ?? undefined,
    address: detail.address ?? undefined,
    notes: detail.notes ?? undefined,
    moduleAgreements: detail.agreements.map((a) => ({
      id: a.id,
      moduleName: a.moduleName,
      text: a.text,
      createdAt: a.createdAt,
    })),
    contactName: detail.customerType === "حقوقی" ? (detail.keyPerson ?? "") : (detail.firstName ?? ""),
    contactLastName: detail.customerType === "حقوقی" ? "" : (detail.lastName ?? ""),
  } as Customer);
}

/**
 * A form's state, as the write endpoint wants it.
 *
 * `linkedCustomerIds` and `moduleAgreements` are deliberately absent: they have
 * their own endpoints, because each is a relationship the server maintains on
 * both sides rather than a column on this record.
 */
export function customerToWriteInput(customer: Partial<Customer>): CustomerWriteInput {
  assertComplete(customer, "مشتری");
  const isLegal = customer.customerType === "حقوقی";

  return {
    customerType: customer.customerType ?? "حقوقی",
    status: customer.status,
    companyName: customer.companyName ?? "",
    firstName: isLegal ? null : (customer.firstName ?? null),
    lastName: isLegal ? null : (customer.lastName ?? null),
    gender: isLegal ? null : (customer.gender || null),
    position: isLegal ? null : (customer.position ?? null),
    economicCode: isLegal ? (customer.economicCode || null) : null,
    industry: isLegal ? (customer.industry ?? null) : null,
    keyPerson: isLegal ? (customer.keyPerson ?? null) : null,
    phone: customer.phone ?? null,
    mobile: customer.mobile ?? null,
    email: customer.email ?? null,
    province: customer.province ?? null,
    city: customer.city ?? null,
    address: customer.address ?? null,
    notes: customer.notes ?? null,
    tags: customer.tags ?? null,
    customValues:
      customer.customValues && Object.keys(customer.customValues).length > 0
        ? JSON.stringify(customer.customValues)
        : null,
  };
}
