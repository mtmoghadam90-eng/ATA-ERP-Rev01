import type { Customer } from "../types";
import type { DuplicateMatch } from "../utils/customerDuplicates";
import { customersApi } from "./customers";
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
/**
 * Asks the server which existing customers the candidate looks like.
 *
 * The rules themselves live in `utils/customerDuplicates` and run on both sides,
 * but the *set they run over* is the point: in the browser that set is whatever
 * the picker happens to have loaded — twenty rows — so the check would miss a
 * duplicate simply because the record was on another page. The endpoint narrows
 * the candidates in SQL first and scores them with the same rules.
 */
export async function findServerDuplicates(
  candidate: Partial<Customer>,
): Promise<DuplicateMatch[]> {
  const { matches } = await customersApi.checkDuplicates({
    customerType: candidate.customerType ?? "حقوقی",
    companyName: candidate.companyName,
    firstName: candidate.firstName,
    lastName: candidate.lastName,
    mobile: candidate.mobile,
    phone: candidate.phone,
    email: candidate.email,
    province: candidate.province,
    economicCode: candidate.economicCode,
  });
  return matches.map((m) => ({
    customer: m.customer as unknown as Customer,
    severity: m.severity,
    primaryField: m.primaryField as DuplicateMatch["primaryField"],
    reason: m.reason,
  }));
}

/**
 * Creates a customer, keeping the links the form collected.
 *
 * The quick-add form offers a "linked to" picker, and pre-ticks the project's
 * customer when the new record is a contact person — but a link is a
 * relationship the server maintains on both sides, so `customerToWriteInput`
 * omits it and the create endpoint has nowhere to put it. Every caller of that
 * form was therefore dropping the links silently. They are written here, with
 * their own endpoint, right after the record exists.
 *
 * A failure to link is not a failure to create: the customer is returned either
 * way, so the caller still gets something to put in the field it was opened
 * from.
 */
export async function createCustomerWithLinks(customer: Partial<Customer>): Promise<Customer> {
  const created = await customersApi.create(customerToWriteInput(customer));
  const linked = (customer.linkedCustomerIds ?? []).filter(Boolean);
  if (linked.length === 0) return detailToCustomer(created);

  try {
    return detailToCustomer(await customersApi.setLinks(created.id, linked));
  } catch (err) {
    console.error("customer created but its links could not be written", err);
    return detailToCustomer(created);
  }
}

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
