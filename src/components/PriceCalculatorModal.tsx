import React, { useEffect, useState } from "react";
import {
  Calculator,
  Info,
  Maximize2,
  Minimize2,
  Percent,
  TrendingUp,
  X,
} from "lucide-react";
import { ExchangeRate, ProductVariant } from "../types";
import { calculateSellingPrice } from "../utils/priceCalculator";

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  initialPriceForeign: number;
  currency: string;
  initialValues?: Partial<ProductVariant>;
  exchangeRates: ExchangeRate[];
  onApply: (
    sellingForeign: number,
    sellingRial: number,
    details: Partial<ProductVariant>,
    currency: string,
  ) => void;
}

const mapCurrencyToEng = (curr: string) =>
  curr === "دلار"
    ? "USD"
    : curr === "یورو"
      ? "EUR"
      : curr === "درهم"
        ? "AED"
        : curr === "یوان"
          ? "CNY"
          : null;

export default function PriceCalculatorModal({
  open,
  onClose,
  title = "محاسبه‌گر بهای تمام‌شده و قیمت فروش",
  subtitle,
  initialPriceForeign,
  currency,
  initialValues,
  exchangeRates,
  onApply,
}: Props) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [calcPriceForeign, setCalcPriceForeign] = useState<string>("0");
  const [calcCurrency, setCalcCurrency] = useState<string>("یورو");
  const [calcExchangeRate, setCalcExchangeRate] = useState<string>("0");
  const [calcRemittanceFee, setCalcRemittanceFee] = useState<string>("0");
  const [calcRemittancePct, setCalcRemittancePct] = useState<string>("0");
  const [calcShippingCost, setCalcShippingCost] = useState<string>("0");
  const [calcCustomsDutyRIYAL, setCalcCustomsDutyRIYAL] = useState<string>("0");
  const [calcOtherCostsForeign, setCalcOtherCostsForeign] =
    useState<string>("0");
  const [calcOtherCostsRIYAL, setCalcOtherCostsRIYAL] = useState<string>("0");
  const [calcProfitPct, setCalcProfitPct] = useState<string>("55");
  const [calcProfitRIYAL, setCalcProfitRIYAL] = useState<string>("0");
  const [calcMarginType, setCalcMarginType] = useState<"PERCENT" | "FIXED">(
    "PERCENT",
  );

  useEffect(() => {
    if (!open) return;
    const curr = currency || "یورو";
    setCalcCurrency(curr);

    const priceForeign =
      initialValues?.calcPriceForeign !== undefined
        ? initialValues.calcPriceForeign
        : initialPriceForeign || 0;
    setCalcPriceForeign(String(priceForeign));

    const mappedEng = mapCurrencyToEng(curr);
    const storeRate = mappedEng
      ? exchangeRates.find((r) => r.currency === mappedEng)?.rateToRIYAL
      : null;
    const defaultRate = storeRate ? String(storeRate) : "700000";

    setCalcExchangeRate(
      initialValues?.calcExchangeRate !== undefined
        ? String(initialValues.calcExchangeRate)
        : defaultRate,
    );
    setCalcRemittanceFee(
      initialValues?.calcRemittanceFee !== undefined
        ? String(initialValues.calcRemittanceFee)
        : "0",
    );
    setCalcRemittancePct(
      initialValues?.calcRemittancePct !== undefined
        ? String(initialValues.calcRemittancePct)
        : "0",
    );
    setCalcShippingCost(
      initialValues?.calcShippingCost !== undefined
        ? String(initialValues.calcShippingCost)
        : "0",
    );
    setCalcCustomsDutyRIYAL(
      initialValues?.calcCustomsDutyRIYAL !== undefined
        ? String(initialValues.calcCustomsDutyRIYAL)
        : "0",
    );
    setCalcOtherCostsForeign(
      initialValues?.calcOtherCostsForeign !== undefined
        ? String(initialValues.calcOtherCostsForeign)
        : "0",
    );
    setCalcOtherCostsRIYAL(
      initialValues?.calcOtherCostsRIYAL !== undefined
        ? String(initialValues.calcOtherCostsRIYAL)
        : "0",
    );
    setCalcProfitPct(
      initialValues?.calcProfitPct !== undefined
        ? String(initialValues.calcProfitPct)
        : "55",
    );
    setCalcProfitRIYAL(
      initialValues?.calcProfitRIYAL !== undefined
        ? String(initialValues.calcProfitRIYAL)
        : "0",
    );
    setCalcMarginType(initialValues?.calcMarginType || "PERCENT");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const result = calculateSellingPrice({
    priceForeign: Number(calcPriceForeign) || 0,
    exchangeRate: Number(calcExchangeRate) || 0,
    remittanceFee: Number(calcRemittanceFee) || 0,
    remittancePct: Number(calcRemittancePct) || 0,
    shippingCost: Number(calcShippingCost) || 0,
    otherCostsForeign: Number(calcOtherCostsForeign) || 0,
    customsDutyRIYAL: Number(calcCustomsDutyRIYAL) || 0,
    otherCostsRIYAL: Number(calcOtherCostsRIYAL) || 0,
    profitPct: Number(calcProfitPct) || 0,
    profitRIYAL: Number(calcProfitRIYAL) || 0,
    marginType: calcMarginType,
  });

  const baseOrig = Number(calcPriceForeign) || 0;
  const rate = Number(calcExchangeRate) || 0;
  const shipCost = Number(calcShippingCost) || 0;
  const otherCostForeign = Number(calcOtherCostsForeign) || 0;
  const customsDuty = Number(calcCustomsDutyRIYAL) || 0;
  const otherCostRial = Number(calcOtherCostsRIYAL) || 0;
  const profitPct = Number(calcProfitPct) || 0;

  const handleClose = () => {
    setIsFullscreen(false);
    onClose();
  };

  const handleConfirm = () => {
    onApply(
      Number(result.sellingForeign.toFixed(2)),
      result.sellingRial,
      {
        calcPriceForeign: baseOrig,
        calcExchangeRate: rate,
        calcRemittanceFee: Number(calcRemittanceFee) || 0,
        calcRemittancePct: Number(calcRemittancePct) || 0,
        calcShippingCost: shipCost,
        calcCustomsDutyRIYAL: customsDuty,
        calcOtherCostsForeign: otherCostForeign,
        calcOtherCostsRIYAL: otherCostRial,
        calcProfitPct: profitPct,
        calcProfitRIYAL: Number(calcProfitRIYAL) || 0,
        calcMarginType,
      },
      calcCurrency,
    );
    setIsFullscreen(false);
  };

  return (
    <div
      className={`fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-55 overflow-y-auto ${
        isFullscreen ? "p-0" : "p-4"
      }`}
    >
      <div
        className={`bg-white shadow-2xl border border-slate-150 overflow-hidden animate-scale-in flex flex-col transition-all duration-300 ${
          isFullscreen
            ? "w-screen h-screen rounded-none my-0 max-w-full max-h-screen"
            : "rounded-2xl w-full max-w-2xl my-8 max-h-[calc(100vh-4rem)]"
        }`}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
          <div className="flex items-center gap-2">
            <Calculator className="text-sky-500" size={20} />
            <div>
              <h3 className="font-bold text-slate-800 text-sm">{title}</h3>
              {subtitle && (
                <p className="text-[10px] text-slate-500">{subtitle}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-1.5 hover:bg-slate-200 text-slate-500 rounded-lg transition flex items-center justify-center"
              title={isFullscreen ? "خروج از تمام‌صفحه" : "تمام‌صفحه"}
            >
              {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="p-1.5 hover:bg-slate-200 text-slate-500 rounded-lg transition"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 overflow-y-auto text-right flex-1">
          {/* Result Display Box */}
          <div className="bg-slate-900 text-white p-5 rounded-2xl relative overflow-hidden shadow-inner">
            <div className="absolute top-0 left-0 w-24 h-24 bg-sky-500/10 rounded-full blur-2xl"></div>
            <div className="absolute bottom-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl"></div>

            <div className="grid grid-cols-2 gap-4 divide-x divide-x-reverse divide-slate-800 relative z-10">
              <div className="text-center space-y-1">
                <p className="text-[10px] text-slate-400 font-medium">
                  بهای تمام‌شده ارزی (Landed Cost)
                </p>
                <h4 className="text-xl font-black text-sky-400 font-mono">
                  {result.landedForeign.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{" "}
                  <span className="text-xs font-sans text-slate-300">
                    {calcCurrency}
                  </span>
                </h4>
                <p className="text-[10px] text-slate-300 font-mono">
                  {Math.round(result.landedRial).toLocaleString("fa-IR")} ریال
                </p>
              </div>

              <div className="text-center space-y-1">
                <p className="text-[10px] text-emerald-400 font-bold">
                  قیمت فروش پیشنهادی (ارزی)
                </p>
                <h4 className="text-xl font-black text-emerald-400 font-mono">
                  {result.sellingForeign.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{" "}
                  <span className="text-xs font-sans text-slate-100">
                    {calcCurrency}
                  </span>
                </h4>
                <p className="text-[10px] text-emerald-300 font-mono">
                  {Math.round(result.sellingRial).toLocaleString("fa-IR")} ریال
                </p>
              </div>
            </div>

            <div className="border-t border-slate-800 mt-4 pt-3 flex justify-between items-center text-[10px] text-slate-400 relative z-10">
              <span>
                سود ناخالص فروش:{" "}
                {result.profitAmountRial > 0
                  ? `${Math.round(result.profitAmountRial).toLocaleString(
                      "fa-IR",
                    )} ریال`
                  : "۰"}
              </span>
              <span className="font-mono bg-slate-800/60 px-2 py-0.5 rounded text-sky-300">
                ارز مرجع: {calcCurrency} | نرخ تسعیر:{" "}
                {rate.toLocaleString("fa-IR")}
              </span>
            </div>
          </div>

          {/* Form Inputs Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Left Side: Foreign/Origin Costs */}
            <div className="space-y-3.5 bg-slate-50/50 p-4 rounded-xl border border-slate-100">
              <h4 className="text-xs font-extrabold text-indigo-700 flex items-center gap-1.5 pb-2 border-b border-dashed border-slate-200">
                <TrendingUp size={14} />
                هزینه‌های ارزی خرید و مبدا
              </h4>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2 space-y-1">
                  <label className="text-[10px] font-bold text-slate-500">
                    قیمت خرید در مبدا
                  </label>
                  <input
                    type="number"
                    value={calcPriceForeign}
                    onChange={(e) => setCalcPriceForeign(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-mono text-center outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 bg-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500">
                    نوع ارز
                  </label>
                  <select
                    value={calcCurrency}
                    onChange={(e) => {
                      const newCurr = e.target.value;
                      setCalcCurrency(newCurr);
                      const mappedEng = mapCurrencyToEng(newCurr);
                      const storeRate = mappedEng
                        ? exchangeRates.find(
                            (r) => r.currency === mappedEng,
                          )?.rateToRIYAL
                        : null;
                      if (storeRate) setCalcExchangeRate(String(storeRate));
                    }}
                    className="w-full border border-slate-200 rounded-lg px-1.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-sky-500/20 bg-white"
                  >
                    <option value="یورو">یورو</option>
                    <option value="دلار">دلار</option>
                    <option value="درهم">درهم</option>
                    <option value="یوان">یوان</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500">
                    درصد کارمزد حواله
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      value={calcRemittancePct}
                      onChange={(e) => setCalcRemittancePct(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg pr-2 pl-6 py-1.5 text-xs font-mono text-center outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 bg-white"
                    />
                    <Percent
                      size={12}
                      className="absolute left-2.5 top-2.5 text-slate-400"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500">
                    کارمزد ثابت حواله ({calcCurrency})
                  </label>
                  <input
                    type="number"
                    value={calcRemittanceFee}
                    onChange={(e) => setCalcRemittanceFee(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono text-center outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500">
                    هزینه حمل ارزی ({calcCurrency})
                  </label>
                  <input
                    type="number"
                    value={calcShippingCost}
                    onChange={(e) => setCalcShippingCost(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono text-center outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 bg-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500">
                    سایر هزینه‌های ارزی ({calcCurrency})
                  </label>
                  <input
                    type="number"
                    value={calcOtherCostsForeign}
                    onChange={(e) => setCalcOtherCostsForeign(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono text-center outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 bg-white"
                  />
                </div>
              </div>
            </div>

            {/* Right Side: Domestic/Rial Costs & Margin */}
            <div className="space-y-3.5 bg-slate-50/50 p-4 rounded-xl border border-slate-100">
              <h4 className="text-xs font-extrabold text-emerald-700 flex items-center gap-1.5 pb-2 border-b border-dashed border-slate-200">
                <Info size={14} />
                ترخیص ریالی و سود فروش
              </h4>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500">
                  نرخ تسعیر ارز (ریال)
                </label>
                <input
                  type="number"
                  value={calcExchangeRate}
                  onChange={(e) => setCalcExchangeRate(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-mono text-center outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 bg-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500">
                    ترخیص و گمرک (ریال)
                  </label>
                  <input
                    type="number"
                    value={calcCustomsDutyRIYAL}
                    onChange={(e) => setCalcCustomsDutyRIYAL(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono text-center outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 bg-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500">
                    سایر مخارج ریالی (ریال)
                  </label>
                  <input
                    type="number"
                    value={calcOtherCostsRIYAL}
                    onChange={(e) => setCalcOtherCostsRIYAL(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono text-center outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 bg-white"
                  />
                </div>
              </div>

              <div className="p-3 bg-white rounded-lg border border-slate-150 space-y-2">
                <div className="flex justify-between items-center text-[10px] font-bold text-slate-500">
                  <span>نوع سود فروش</span>
                  <div className="flex gap-2 bg-slate-100 p-0.5 rounded-lg border">
                    <button
                      type="button"
                      onClick={() => setCalcMarginType("PERCENT")}
                      className={`px-2 py-0.5 rounded-md text-[9px] font-semibold transition ${
                        calcMarginType === "PERCENT"
                          ? "bg-white shadow-xs text-sky-600"
                          : "text-slate-500"
                      }`}
                    >
                      درصدی
                    </button>
                    <button
                      type="button"
                      onClick={() => setCalcMarginType("FIXED")}
                      className={`px-2 py-0.5 rounded-md text-[9px] font-semibold transition ${
                        calcMarginType === "FIXED"
                          ? "bg-white shadow-xs text-sky-600"
                          : "text-slate-500"
                      }`}
                    >
                      ثابت (ریال)
                    </button>
                  </div>
                </div>

                {calcMarginType === "PERCENT" ? (
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-400">
                      درصد سود روی بهای تمام‌شده
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        value={calcProfitPct}
                        onChange={(e) => setCalcProfitPct(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg pr-2.5 pl-6 py-1 text-xs font-mono text-center outline-none focus:ring-1 focus:ring-sky-500"
                      />
                      <Percent
                        size={11}
                        className="absolute left-2 top-2 text-slate-400"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-400">
                      مبلغ سود ثابت (ریال)
                    </label>
                    <input
                      type="number"
                      value={calcProfitRIYAL}
                      onChange={(e) => setCalcProfitRIYAL(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs font-mono text-center outline-none focus:ring-1 focus:ring-sky-500"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Math Step-by-Step Breakdown */}
          <div className="bg-slate-50 p-4 rounded-xl space-y-2.5 font-mono text-[10px] leading-relaxed border border-slate-150">
            <p className="font-bold text-slate-700 pb-1.5 border-b border-dashed border-slate-200 font-sans text-xs flex items-center gap-1.5">
              <Info size={13} className="text-slate-500" />
              فرمول تسهیم و بهای تمام‌شده نهایی
            </p>

            <div className="flex justify-between text-slate-600">
              <span>۱. بهای خرید ارزی کالا:</span>
              <span>
                {baseOrig.toLocaleString()} {calcCurrency}
              </span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>۲. کارمزد صرافی حواله ارز:</span>
              <span>
                +{result.remittanceForeign.toLocaleString()} {calcCurrency}
              </span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>۳. هزینه‌های جانبی ارزی (ترابری و غیره):</span>
              <span>
                +{(shipCost + otherCostForeign).toLocaleString()} {calcCurrency}
              </span>
            </div>
            <div className="flex justify-between text-slate-700 border-t border-dashed pt-1.5">
              <span>مجموع بهای ارزی FOB/Landed:</span>
              <span className="font-bold text-indigo-700">
                {result.totalForeignCost.toLocaleString()} {calcCurrency}
              </span>
            </div>
            <div className="flex justify-between text-slate-500 pt-1">
              <span>معادل ریالی بهای ارزی کالا (تسعیر):</span>
              <span>
                {(result.totalForeignCost * rate).toLocaleString()} ریال
              </span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>مخارج ریالی داخل کشور (ترخیص و عوارض + سایر):</span>
              <span>
                +{(customsDuty + otherCostRial).toLocaleString()} ریال
              </span>
            </div>
            <div className="flex justify-between text-slate-800 border-t border-dashed pt-1.5 text-xs font-bold">
              <span className="font-sans">بهای تمام‌شده کل کالا (ریال):</span>
              <span className="text-sky-700">
                {Math.round(result.landedRial).toLocaleString()} ریال
              </span>
            </div>
            <div className="flex justify-between text-emerald-700 pt-1 text-xs font-bold">
              <span className="font-sans">
                سود فروش محاسبه شده (
                {calcMarginType === "PERCENT" ? `${profitPct}%` : "ثابت"}):
              </span>
              <span>
                +{Math.round(result.profitAmountRial).toLocaleString()} ریال
              </span>
            </div>
          </div>
        </div>

        {/* Actions Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 border border-slate-200 hover:bg-slate-100 text-slate-600 rounded-xl text-xs font-medium transition"
          >
            انصراف
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="px-5 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-sky-500/15 flex items-center gap-1.5"
          >
            <Calculator size={14} />
            اعمال در ردیف کالا و ذخیره
          </button>
        </div>
      </div>
    </div>
  );
}
