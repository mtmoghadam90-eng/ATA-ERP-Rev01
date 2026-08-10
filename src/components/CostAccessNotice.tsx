import { Lock } from 'lucide-react';

/**
 * Says why the money on this screen is blank.
 *
 * Purchase orders and supplier inquiries are almost entirely statements of what
 * the company pays, so for a user without the cost permission the server blanks
 * most of the numbers and refuses saves. Without a word of explanation that
 * reads as a broken screen — every price zero, and the save button answering
 * with a permission error. This is that word.
 *
 * Not drawn at all for users who can see costs, which is the normal case.
 */
export default function CostAccessNotice({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-4 text-sm">
      <Lock size={18} className="mt-0.5 shrink-0 text-amber-600" />
      <div className="space-y-1">
        <p className="font-bold">مبالغ این صفحه برای شما نمایش داده نمی‌شود.</p>
        <p className="text-amber-800 leading-relaxed">
          دسترسی «مشاهده بهای خرید» برای حساب شما فعال نیست، بنابراین قیمت‌ها،
          هزینه‌ها و بهای تمام شده خالی نمایش داده می‌شوند و امکان ذخیره اسناد این
          بخش وجود ندارد. سایر اطلاعات مانند تأمین‌کننده، اقلام، تاریخ‌ها و مراحل
          کار همچنان در دسترس است. برای فعال‌سازی با مدیر سامانه تماس بگیرید.
        </p>
      </div>
    </div>
  );
}
