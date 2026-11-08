/**
 * The words of the «ثبت استعلام جدید» notice.
 *
 * It used to read «استعلام جدید ثبت شد برای پروژه» and stop — the sentence
 * named a project and printed none, so whoever received it had to go and look
 * for which job had been asked about. The project is named by its code first
 * (what every other screen is searched by) and its name, and the supplier
 * asked is named too; a general warehouse purchase says so.
 */
export function inquiryCreatedNotice(input: {
  projectCode?: string | null;
  projectName?: string | null;
  supplierName?: string | null;
  /** True when the inquiry belongs to a project, even one that could not be read. */
  hasProject: boolean;
}): string {
  const supplier = String(input.supplierName ?? "").trim();
  const from = supplier ? ` از «${supplier}»` : "";
  if (!input.hasProject) return `استعلام جدید${from} ثبت شد (خرید انبار، بدون پروژه)`;
  const code = String(input.projectCode ?? "").trim();
  const name = String(input.projectName ?? "").trim();
  const project = [code, name].filter(Boolean).join(" — ");
  return project
    ? `استعلام جدید${from} برای پروژه ${project} ثبت شد`
    : `استعلام جدید${from} برای یک پروژه ثبت شد`;
}
