/**
 * Every screen the sidebar can show, in one list.
 *
 * There were three copies of this: the sidebar's own `menuItems`, the
 * `ALL_MODULES` array inside the settings screen's ordering tab, and the
 * default order in `seedData.ts`. Adding a module meant remembering all three,
 * and the messaging module was added to one — so it appeared in the menu and
 * could not be reordered, because the settings tab looks each stored id up in
 * its own list and renders nothing for an id it does not know.
 *
 * Deliberately free of icons, and of anything that imports React: `seedData.ts`
 * reads the default order from here and is itself imported by
 * `scripts/seedDb.ts`, which runs under `tsx` in a plain Node process. The
 * icons live in `src/components/moduleIcons.ts`, keyed by `AppModuleId`, so
 * **the type-checker refuses a module with no icon** — `npm run lint` is the
 * gate `deploy.ps1` will not deploy past, which is what makes forgetting one
 * impossible rather than merely unlikely.
 */

export interface AppModule {
  /** Matches `activeView` in `App.tsx` and the permission key, where there is one. */
  id: string;
  /** As the sidebar labels it. */
  name: string;
  /** One line, shown on the ordering tab in the settings screen. */
  description: string;
}

export const APP_MODULES = [
  {
    id: "dashboard",
    name: "داشبورد",
    description: "خلاصه وضعیت، آمارهای کلیدی و نمودارهای سریع سیستم",
  },
  {
    id: "customers",
    name: "مشتریان",
    description: "مدیریت پرونده‌های خریداران حقیقی و حقوقی و ارتباطات آن‌ها",
  },
  {
    id: "projects",
    name: "پروژه‌ها (فرصت‌ها)",
    description: "کنترل فازها، فعالیت‌ها و ارجاعات مربوط به هر فرصت تجاری",
  },
  {
    id: "proformas",
    name: "پیش‌فاکتورها",
    description: "صدور و پیگیری پیشنهادهای مالی فنی برای مشتریان",
  },
  {
    id: "products",
    name: "کالا و انبار",
    description: "انبارداری، موجودی کالاها و ابزار دقیق شرکت",
  },
  {
    id: "suppliers",
    name: "تأمین‌کنندگان",
    description: "مدیریت وندورها و سازندگان داخلی و خارجی کالا",
  },
  {
    id: "supplierInquiries",
    name: "استعلام قیمت تأمین‌کنندگان",
    description: "ثبت و پیگیری استعلام قیمت از همکاران و وندورهای خارجی",
  },
  {
    id: "purchaseOrders",
    name: "سفارشات خرید خارجی",
    description: "پیگیری مراحل پروفرمای خرید، حمل و ترخیص گمرکی",
  },
  {
    id: "packagingDelivery",
    name: "بسته‌بندی و تحویل کالا",
    description: "مدیریت پکینگ‌لیست‌ها و تحویل محموله‌ها به مشتری",
  },
  {
    id: "afterSalesServices",
    name: "خدمات پس از فروش",
    description: "رسیدگی به درخواست‌ها و پشتیبانی پس از فروش و گارانتی",
  },
  {
    id: "transactions",
    name: "دریافت و پرداخت ریالی",
    description: "ثبت و کنترل تراکنش‌های مالی ریالی و صندوق شرکت",
  },
  {
    id: "tasks",
    name: "وظایف و پیگیری",
    // «کارتابل ارجاعات کار» was a module of its own and is a tab in here now:
    // the two screens asked the same question, so people had to look in two
    // places. A stored `sidebarModuleOrder` still naming it is harmless — the
    // sidebar sorts an id it does not know to the end and the ordering tab
    // renders nothing for one.
    description: "تخته کار، ارجاعات همکاران، پیگیری‌های فروش و اعلان‌ها در یک صفحه",
  },
  {
    id: "messaging",
    name: "ارسال پیام",
    description: "ارسال پیامک، پیام بله و ایمیل به مشتریان، دستی یا خودکار",
  },
  {
    id: "users",
    name: "مدیریت کاربران",
    description: "تعریف پرسنل، نقش‌ها و تنظیمات دسترسی به هر ماژول",
  },
  {
    id: "settings",
    name: "تنظیمات سیستم",
    description: "شخصی‌سازی فیلدها، دسته‌بندی‌ها و قالب‌های اسناد رسمی",
  },
] as const satisfies readonly AppModule[];

/** The id of a module, as a union — what makes the icon map exhaustive. */
export type AppModuleId = typeof APP_MODULES[number]["id"];

/**
 * The order a fresh installation gets, and the one the reset button restores.
 *
 * A stored order that is missing an id is not fatal — the sidebar sorts what it
 * does not recognise to the end and the settings tab appends it — so this is
 * about where a new module *starts*, not about whether it appears at all.
 */
export const DEFAULT_MODULE_ORDER: string[] = APP_MODULES.map((m) => m.id);
