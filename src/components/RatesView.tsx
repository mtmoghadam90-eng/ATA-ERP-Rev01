import React, { useState } from 'react';
import { 
  TrendingUp, 
  RefreshCw, 
  ArrowRightLeft, 
  Coins, 
  CheckCircle,
  Clock,
  ChevronLeft
} from 'lucide-react';
import { ExchangeRate } from '../types';

interface RatesViewProps {
  exchangeRates: ExchangeRate[];
  updateExchangeRate: (id: string, newRate: number) => void;
  fetchRatesFromAPI: (silent?: boolean) => Promise<boolean>;
}

export default function RatesView({
  exchangeRates,
  updateExchangeRate,
  fetchRatesFromAPI
}: RatesViewProps) {
  const [rates, setRates] = useState<{ [key: string]: number }>(() => {
    return exchangeRates.reduce((acc: { [key: string]: number }, r) => {
      acc[r.id] = r.rateToRIYAL;
      return acc;
    }, {});
  });

  const [isLoadingTGJU, setIsLoadingTGJU] = useState(false);

  // Sync state if exchangeRates changes in parent
  React.useEffect(() => {
    setRates(exchangeRates.reduce((acc: { [key: string]: number }, r) => {
      acc[r.id] = r.rateToRIYAL;
      return acc;
    }, {}));
  }, [exchangeRates]);

  const [calcAmount, setCalcAmount] = useState<number>(1000);
  const [calcFromCurrency, setCalcFromCurrency] = useState<string>('USD');

  // Handle single currency rate update
  const handleRateChange = (id: string, val: string) => {
    const num = Number(val);
    setRates({
      ...rates,
      [id]: num
    });
  };

  const handleSaveRate = (id: string) => {
    updateExchangeRate(id, rates[id]);
    alert('نرخ تسعیر ارز با موفقیت در سیستم بروزرسانی شد و در محاسبات لندد کاست جدید اعمال می‌گردد.');
  };

  // Calculator helper
  const selectedRateObj = exchangeRates.find(r => r.currency === calcFromCurrency);
  const selectedRate = selectedRateObj ? selectedRateObj.rateToRIYAL : 0;
  const computedRiyal = calcAmount * selectedRate;

  return (
    <div className="space-y-6 animate-fade-in">
      
      {/* Page Header */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">مدیریت نرخ ارز و تبدیل واحدها</h1>
          <p className="text-slate-500 text-sm mt-1">بروزرسانی روزانه ارزهای مرجع بازرگانی جهت محاسبه بهای تمام شده قطعات و صدور مظنه ارزی</p>
        </div>
        <button
          onClick={async () => {
            setIsLoadingTGJU(true);
            const success = await fetchRatesFromAPI();
            setIsLoadingTGJU(false);
            if (success) {
              alert('نرخ‌های روزانه با موفقیت از سامانه tgju.com استخراج و بروزرسانی شدند.');
            } else {
              alert('خطا در استخراج خودکار اطلاعات؛ لطفاً اتصال اینترنت را بررسی نموده یا نرخ‌ها را به صورت دستی وارد نمایید.');
            }
          }}
          disabled={isLoadingTGJU}
          className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
        >
          <RefreshCw size={13} className={isLoadingTGJU ? 'animate-spin' : ''} />
          {isLoadingTGJU ? 'در حال دریافت...' : 'بروزرسانی زنده از TGJU'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Daily Rates Update Panel */}
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4 lg:col-span-2">
          <div>
            <h3 className="font-bold text-slate-800 text-sm">بروزرسانی نرخ‌های تسعیر ارز (به ریال)</h3>
            <p className="text-xs text-slate-400 mt-1">تغییر این مقادیر بلافاصله در فرمول‌های محاسباتی سفارشات خرید جدید اعمال می‌شود.</p>
          </div>

          <div className="divide-y divide-slate-100 space-y-3">
            {exchangeRates.map((rate) => (
              <div key={rate.id} className="pt-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-sky-50 text-sky-600 font-extrabold flex items-center justify-center font-mono">
                    {rate.currency}
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-700 text-sm">{rate.name}</h4>
                    <p className="text-[10px] text-slate-400 flex items-center gap-1 font-mono">
                      <Clock size={10} />
                      آخرین ویرایش: {new Date(rate.lastUpdated).toLocaleDateString('fa-IR')} {new Date(rate.lastUpdated).toLocaleTimeString('fa-IR')}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 w-full md:w-auto">
                  <div className="relative flex-1 md:w-48">
                    <input
                      type="number"
                      value={rates[rate.id] !== undefined ? rates[rate.id] : rate.rateToRIYAL}
                      onChange={(e) => handleRateChange(rate.id, e.target.value)}
                      className="w-full pl-12 pr-3 py-1.5 border border-slate-200 rounded-lg text-sm text-left font-mono font-bold"
                    />
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">ریال</span>
                  </div>
                  <button
                    onClick={() => handleSaveRate(rate.id)}
                    className="px-3 py-1.5 bg-sky-500 hover:bg-sky-600 text-white rounded-lg text-xs font-semibold transition flex items-center gap-1"
                  >
                    <RefreshCw size={12} />
                    بروزرسانی
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Currency Converter Calculator widget */}
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-slate-800 text-sm">مبدل سریع ارز صنعتی</h3>
              <ArrowRightLeft size={16} className="text-slate-400" />
            </div>

            {/* Selector */}
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-semibold">ارز مبدا</label>
              <select
                value={calcFromCurrency}
                onChange={(e) => setCalcFromCurrency(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-right bg-white"
              >
                {exchangeRates.map(r => (
                  <option key={r.id} value={r.currency}>{r.currency} - {r.name}</option>
                ))}
              </select>
            </div>

            {/* Amount input */}
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-semibold">حجم ارز</label>
              <input
                type="number"
                value={calcAmount}
                onChange={(e) => setCalcAmount(Math.max(0, Number(e.target.value)))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs text-left font-mono"
              />
            </div>

            {/* Results */}
            <div className="bg-slate-50 p-4 rounded-xl space-y-1 font-mono border border-slate-100 text-center">
              <p className="text-[10px] text-slate-400 font-sans">برآورد معادل نهایی به ریال</p>
              <h4 className="text-base font-extrabold text-slate-800">
                {computedRiyal.toLocaleString('fa-IR')} <span className="text-xs font-normal">ریال</span>
              </h4>
              <p className="text-[10px] text-sky-600 font-sans mt-1">
                معادل {(computedRiyal / 10).toLocaleString('fa-IR')} تومان
              </p>
            </div>
          </div>

          <div className="text-[10px] text-slate-400 leading-relaxed border-t pt-3 mt-4">
            مکانیزم یکپارچه ارزی در سیستم Arshia ERP به کارشناس بازرگانی خارجی امکان بررسی در لحظه حاشیه سود و جلوگیری از زیان نوسانات ارزی در مناقصات بزرگ را می‌دهد.
          </div>
        </div>

      </div>

    </div>
  );
}
