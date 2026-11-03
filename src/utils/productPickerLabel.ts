/**
 * How a catalogue item is named in the proforma's product picker.
 *
 * Several items share a display name here — «Compact Pressure Transmitter»
 * from two makers, or two ranges of one — and the picker showed the name and
 * the stock alone, so the only way to tell them apart was to pick one and look.
 * The code and the brand go beside the name: «نام | کد | برند | موجودی».
 * A blank code or brand is left out rather than printed as an empty column.
 */
export function productPickerLabel(
  product: { displayName?: string | null; code?: string | null; brand?: string | null },
  stockText = "",
): string {
  const parts = [product.displayName, product.code, product.brand]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean);
  return `${parts.join(" | ")}${stockText}`;
}
