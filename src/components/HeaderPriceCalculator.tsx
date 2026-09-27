import PriceCalculatorModal from './PriceCalculatorModal';
import { useExchangeRates } from '../api/exchangeRates';

/**
 * The price calculator as a scratch tool, opened from the header.
 *
 * «هر موقع خواستم قیمت یه کالا رو دم دستی حساب کنم» — the same calculator the
 * product and proforma forms use, with nothing behind it: `standalone` removes
 * the apply button, so a figure worked out here is never written anywhere.
 *
 * Its own component so the rates hook is only mounted while it is open, and so
 * `App` gains no hook of its own (a hook below its early return is a white
 * page — CLAUDE.md).
 */
export default function HeaderPriceCalculator({ onClose }: { onClose: () => void }) {
  const { rates } = useExchangeRates();
  return (
    <PriceCalculatorModal
      open
      standalone
      onClose={onClose}
      title="ماشین حساب قیمت (محاسبه دستی)"
      subtitle="فقط برای محاسبه؛ چیزی ثبت نمی‌شود."
      initialPriceForeign={0}
      currency="یورو"
      exchangeRates={rates}
      // Re-seed once the rates arrive, so the rate box starts from today's
      // stored rate rather than the placeholder used while they load.
      seedKey={rates.length > 0 ? 'rates' : 'waiting'}
    />
  );
}
