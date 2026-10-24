import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Building2, Mail, MapPin, Phone, Smartphone, User, X } from 'lucide-react';
import { customersApi, type CustomerDetail } from '../api/customers';

/**
 * A customer's name on a work card, as one press into their details.
 *
 * The card names the customer behind the job — «TC MFG شرکت سازنده توربو
 * کمپرسور» — and the person picking the card up usually wants the number to
 * ring, which meant leaving the board for the customers screen and searching.
 * The details open **in place**, in a pop-up over the board, because the board
 * is what the person is working from.
 *
 * The record is read when the pop-up opens, never taken from the card (a card
 * carries the name and nothing else). The read goes through `GET
 * /api/customers/:id`, so an account without the customers permission is told
 * so rather than shown an empty box. Without an id it is the plain text it
 * always was. The press stops the event: the card's own headline opens the
 * task, and this is a different intent.
 */
interface Props {
  customerId?: string | null;
  name: string;
  className?: string;
}

export default function CustomerInfoButton({ customerId, name, className }: Props) {
  const [open, setOpen] = useState(false);
  if (!customerId) return <span className={className}>{name}</span>;
  return (
    <>
      <button
        type="button"
        data-card-customer={customerId}
        title={`نمایش اطلاعات مشتری: ${name}`}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className={`${className ?? ''} text-right hover:text-sky-600 hover:underline transition`}
      >
        {name}
      </button>
      {open && <CustomerInfoModal customerId={customerId} onClose={() => setOpen(false)} />}
    </>
  );
}

const show = (v: unknown) => String(v ?? '').trim();

export function CustomerInfoModal({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCustomer(null); setError(null);
    customersApi.get(customerId)
      .then((c) => { if (!cancelled) setCustomer(c); })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'اطلاعات مشتری خوانده نشد.');
      });
    return () => { cancelled = true; };
  }, [customerId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isCompany = customer?.customerType === 'حقوقی';
  const place = customer ? [show(customer.province), show(customer.city)].filter(Boolean).join('، ') : '';
  const rows: { label: string; value: string; icon?: React.ReactNode; ltr?: boolean; href?: string }[] = customer ? [
    { label: 'موبایل', value: show(customer.mobile), icon: <Smartphone size={13} />, ltr: true, href: show(customer.mobile) ? `tel:${show(customer.mobile)}` : undefined },
    { label: 'تلفن', value: show(customer.phone), icon: <Phone size={13} />, ltr: true, href: show(customer.phone) ? `tel:${show(customer.phone)}` : undefined },
    { label: 'ایمیل', value: show(customer.email), icon: <Mail size={13} />, ltr: true, href: show(customer.email) ? `mailto:${show(customer.email)}` : undefined },
    { label: 'استان / شهر', value: place, icon: <MapPin size={13} /> },
    { label: 'آدرس', value: show(customer.address) },
    { label: isCompany ? 'شخص کلیدی' : 'سمت', value: show(isCompany ? customer.keyPerson : customer.position) },
    { label: 'صنعت', value: show(customer.industry) },
    { label: 'کد اقتصادی', value: show(customer.economicCode), ltr: true },
    { label: 'برچسب‌ها', value: show(customer.tags) },
  ].filter((r) => r.value) : [];
  const links = customer?.linksFrom ?? [];

  return createPortal(
    // Stops here: a React event bubbles through a portal to the card beneath it.
    <div
      className="fixed inset-0 bg-slate-900/40 z-[60] flex items-center justify-center p-4"
      data-customer-info-modal
      onClick={(e) => { e.stopPropagation(); onClose(); }}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md border border-slate-200 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-hairline shrink-0">
          <h3 className="font-bold text-sm text-slate-800 inline-flex items-center gap-2 min-w-0">
            {isCompany ? <Building2 size={16} className="shrink-0" /> : <User size={16} className="shrink-0" />}
            <span className="break-words">{customer?.companyName ?? 'اطلاعات مشتری'}</span>
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 shrink-0" title="بستن">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto text-xs">
          {!customer && !error && <p className="text-muted">در حال خواندن…</p>}
          {error && <div className="text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

          {customer && (
            <>
              <div className="flex flex-wrap gap-1.5">
                <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600">{customer.customerType}</span>
                {customer.status && <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600">{customer.status}</span>}
                {customer.doNotContact && <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">عدم تماس</span>}
              </div>

              {rows.length === 0 && <p className="text-muted">اطلاعات تماسی ثبت نشده است.</p>}
              <dl className="space-y-2" data-customer-info-rows>
                {rows.map((r) => (
                  <div key={r.label} className="flex items-start gap-2">
                    <dt className="w-24 shrink-0 text-muted inline-flex items-center gap-1">{r.icon}{r.label}</dt>
                    <dd className="flex-1 min-w-0 text-slate-800 break-words whitespace-pre-line" dir={r.ltr ? 'ltr' : undefined} style={r.ltr ? { textAlign: 'right' } : undefined}>
                      {r.href ? <a href={r.href} className="text-sky-700 hover:underline">{r.value}</a> : r.value}
                    </dd>
                  </div>
                ))}
              </dl>

              {links.length > 0 && (
                <div className="pt-2 border-t border-hairline">
                  <p className="text-muted mb-1">{isCompany ? 'اشخاص مرتبط' : 'شرکت‌های مرتبط'}</p>
                  <ul className="space-y-1">
                    {links.map((l) => (
                      <li key={l.to.id} className="text-slate-700">{l.to.companyName}</li>
                    ))}
                  </ul>
                </div>
              )}

              {show(customer.notes) && (
                <div className="pt-2 border-t border-hairline">
                  <p className="text-muted mb-1">توضیحات</p>
                  <p className="text-slate-700 whitespace-pre-line break-words">{show(customer.notes)}</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
