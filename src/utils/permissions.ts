import { APP_MODULES } from '../appModules';
import { SCREEN_PERMISSION_ALIAS, type User } from '../types';

/**
 * Client-side mirror of `canSeeCosts` in `src/server/auth.ts`.
 *
 * This decides what the screens *draw*. It is not the control — the server
 * blanks the same fields on the way out, so a user without the permission gets
 * nulls from the API whatever the browser does. This exists so they are shown a
 * form without a price calculator rather than a price calculator full of empty
 * boxes.
 *
 * The two must agree on the rule, and the rule is: absent means denied. Every
 * other permission in this application reads an absent key as granted, which is
 * right for flags that predate the stored accounts and wrong for a new one
 * guarding money.
 */
export function canSeeCosts(user: User | null | undefined): boolean {
  if (!user) return false;
  if (user.isSystemAdmin) return true;
  return user.permissions?.costs === true;
}

/**
 * Client mirror of `hasPermission` in `src/server/auth.ts`: absent means
 * granted.
 *
 * The opposite default to `canSeeCosts` above, and deliberately so — these
 * flags predate the stored accounts, so an account written before a module
 * existed must not lose the module. Like `canSeeCosts`, this decides only what
 * is *drawn*; the route checks the same key on the way in.
 */
export function hasModulePermission(
  user: User | null | undefined,
  key: keyof NonNullable<User["permissions"]>,
): boolean {
  if (!user) return false;
  if (user.isSystemAdmin) return true;
  return user.permissions?.[key] !== false;
}


/* ------------------- what an account's permissions can name ---------------- */

/**
 * Every flag the users screen may offer, **derived from `APP_MODULES`**.
 *
 * It was a sixth hand-typed copy of the module list, and it had drifted exactly
 * as the other five did before they were merged — with the difference that this
 * one is not cosmetic: a module missing here **cannot be granted or denied at
 * all**. Two were missing when this was written. «کارهای متوقف» had just been
 * added and never reached the screen, which is how it was reported; and
 * «بسته‌بندی و تحویل کالا» had been missing since it was built, so it and
 * «خدمات پس از فروش» — which borrows its key — had never once been
 * configurable by anybody.
 *
 * So the rule is the one every other module list here already follows: the
 * catalogue is the single source and this is computed from it, which is what
 * makes «a module added is configurable on the same commit» a property rather
 * than something to remember. `test:rules` holds it in both directions.
 *
 * Two kinds of entry, and the difference matters:
 *
 * **A module** answers «may this account open this screen». Absent means
 * granted (`hasModulePermission`), because these flags predate the stored
 * accounts and an account written before a module existed must not lose it.
 *
 * **A field-level flag** is not a screen at all — `costs`, `assistant` and
 * `tasksAll` govern what is visible *inside* modules the account already has —
 * and all three are read **strictly**, so absent denies. They are listed
 * explicitly rather than derived, because there is nothing to derive them from
 * and each is a deliberate decision rather than a screen somebody added.
 */
export interface PermissionFlag {
  id: string;
  name: string;
  desc: string;
  /** True for the three that govern fields rather than screens. */
  fieldLevel?: boolean;
}

/**
 * The screens with **no key of their own**, which is why they are not offered.
 *
 * `afterSalesServices` is gated by `packagingDelivery` and `supplierInquiries`
 * by `suppliers` (`SCREEN_PERMISSION_ALIAS`, mirrored by `KEY_PERMISSION` on
 * the server). Drawing a switch for one would be a switch that writes a key
 * nothing ever reads — the same fault as a module missing altogether, wearing
 * the opposite hat.
 */
const ALIASED_SCREENS = new Set(Object.keys(SCREEN_PERMISSION_ALIAS));

/**
 * Wording for the *permission* where it differs from the module's own.
 *
 * A description here answers «what does granting this let somebody do», which
 * is not always what the module catalogue's one-liner says. A module with no
 * entry falls back to `APP_MODULES`'s own description — so a module added and
 * never described still gets a sensible line rather than a blank, which is what
 * keeps «derived» from quietly costing something.
 */
const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  products: 'مدیریت مشخصات فنی کالاها، دسته‌بندی و تعریف تجهیزات ابزاردقیق',
  tasks: 'تخته کار، کارتابل ارجاعات همکاران، پیگیری فروش و اعلان‌های سیستم',
  packagingDelivery:
    'پکینگ‌لیست‌ها و تحویل محموله‌ها. همین دسترسی «خدمات پس از فروش» را هم باز می‌کند، '
    + 'چون آن ماژول کلید جداگانه‌ای ندارد.',
  messaging:
    'قالب‌های پیام، صف و سوابق ارسال پیامک، بله و ایمیل. تنظیمات درگاه‌ها جداگانه با '
    + 'دسترسی «تنظیمات سیستم» کنترل می‌شود.',
  stuckWork:
    'گزارش هرچه در زنجیره روی زمین مانده. هر بخش از این گزارش جداگانه با دسترسی ماژول '
    + 'خودش کنترل می‌شود؛ بدون دسترسی «سفارشات خرید» آن بخش نمایش داده نمی‌شود.',
  settings: 'تغییر الگوهای پیش‌فاکتور، فیلدهای دلخواه و تنظیمات عمومی',
  users: 'تعریف پرسنل، تغییر رمز عبور و تنظیم سطح دسترسی ماژول‌ها',
};

/** The three that govern fields inside modules the account already has. */
export const FIELD_LEVEL_PERMISSIONS: readonly PermissionFlag[] = [
  {
    id: 'assistant',
    name: 'دستیار هوشمند',
    desc: 'پنل پرسش و پاسخ هوش مصنوعی در داشبورد. جداگانه از دسترسی داشبورد کنترل می‌شود؛ '
      + 'می‌توانید داشبورد را بدهید و این را ندهید. دستیار فقط همان داده‌هایی را می‌بیند که '
      + 'خود کاربر اجازه دیدنش را دارد.',
    fieldLevel: true,
  },
  {
    id: 'costs',
    name: 'مشاهده بهای خرید',
    desc: 'دیدن قیمت تمام شده: ماشین‌حساب قیمت کالا، هزینه‌های سفارش خرید و مبالغ آفر '
      + 'تأمین‌کنندگان. بدون این دسترسی، این اعداد نمایش داده نمی‌شوند و سفارش خرید و '
      + 'استعلام قابل ذخیره نیست.',
    fieldLevel: true,
  },
  {
    id: 'tasksAll',
    name: 'مشاهده وظایف همه کاربران',
    desc: 'دیدن وظایف کل تیم در صفحه «وظایف و پیگیری». بدون این دسترسی هر کاربر فقط '
      + 'وظایفی را می‌بیند که به او ارجاع شده یا خودش ثبت کرده است. برای مدیر فروش یا '
      + 'سرپرست تیم مناسب است.',
    fieldLevel: true,
  },
];

/** Every switch the users screen draws, modules first and in catalogue order. */
export const PERMISSION_FLAGS: readonly PermissionFlag[] = [
  ...APP_MODULES
    .filter((m) => !ALIASED_SCREENS.has(m.id))
    .map((m) => ({
      id: m.id,
      name: m.name,
      desc: PERMISSION_DESCRIPTIONS[m.id] ?? m.description,
    })),
  ...FIELD_LEVEL_PERMISSIONS,
];

/**
 * The two administrative modules a new account does **not** get.
 *
 * Everything else a module offers is on by default, which is the same answer
 * `hasModulePermission` gives for a key that is absent — so a fresh account and
 * an account written before a module existed see the same thing, rather than
 * the ticked boxes disagreeing with what the route guard would have allowed.
 */
const OFF_BY_DEFAULT = new Set([
  'settings',
  'users',
  /*
   * And the ledger, which is the one entry here that is not administrative.
   *
   * It is off because it was off: the «کاربر جدید» form withheld it while the
   * component's own initial state granted it, so the two hand-typed copies
   * disagreed and the form's answer is the one that ever ran. Widening it while
   * merging the copies would have been a silent grant of the money screens to
   * every account made from here on — a merge is not the place to decide that,
   * and somebody ticks the box when they mean to.
   */
  'transactions',
]);

/**
 * What a new account starts with, and what «مدیر سیستم» sets everything to.
 *
 * Derived for the same reason the list is: this was written out twice by hand
 * beside the list, so a module added reached neither — and the admin branch
 * silently left the new module off for the one role that is supposed to have
 * everything.
 */
export function defaultPermissions(role: 'admin' | 'user'): User['permissions'] {
  const on = role === 'admin';
  const derived: Record<string, boolean> = {};
  for (const flag of PERMISSION_FLAGS) {
    derived[flag.id] = on ? true : !(flag.fieldLevel || OFF_BY_DEFAULT.has(flag.id));
  }
  /*
   * The base is spelled out and the catalogue is spread **over** it, rather
   * than the object being built from the catalogue alone and cast.
   *
   * That is what keeps both halves honest at compile time: `User['permissions']`
   * declares which keys must exist, so dropping one from the type union without
   * dropping it here fails `npm run lint` — while a module added to the
   * catalogue arrives through the spread with nothing to remember. A cast would
   * have compiled cleanly and been wrong the first time the union changed, which
   * is the trap the client adapters already document.
   *
   * `referrals` is the one entry with no catalogue behind it: it is retired and
   * never read, and it is still required by the type because every stored
   * account carries it.
   */
  const base: User['permissions'] = {
    dashboard: on, customers: on, projects: on, proformas: on, products: on,
    suppliers: on, purchaseOrders: on, transactions: on, tasks: on,
    referrals: on, settings: on, users: on,
  };
  return { ...base, ...derived };
}

/**
 * The stored permissions resolved to a real boolean per flag.
 *
 * **The users screen was reading the stored value three different ways and the
 * application a fourth**, and that is exactly how «دسترسی کارهای متوقف را
 * غیرفعال کردم ولی همچنان می‌بیندش» happens.
 *
 * A module flag is **absent** on every account written before that module
 * existed — `stuckWork`, `packagingDelivery` and `messaging` are all optional
 * on the type for that reason. The sidebar, the route guard and the server all
 * read absent as **granted** (`!== false`, and rightly: an account must not
 * lose a screen the day a newer module ships). But the edit form's checkbox
 * read the raw value, so `undefined` drew **unticked**; the summary chip beside
 * it read `=== true`, so the same module drew **struck through**; and the
 * form's seeding normalised exactly four keys by hand — `costs`, `messaging`,
 * `assistant`, `tasksAll` — which is a list that drifted the moment a fifth
 * arrived.
 *
 * So an administrator opened the form, saw «کارهای متوقف» already unticked,
 * changed nothing, saved — and the key was still absent, so the user went on
 * seeing the screen. Pressing the box once made it *worse* in a way nobody
 * could read: `!undefined` is `true`, which grants it explicitly. It took two
 * presses to deny something the screen had been calling denied all along.
 *
 * One rule, and it is the consumers' own: a **module** flag answers `!== false`
 * and a **field-level** flag answers `=== true`, which is precisely what
 * `hasModulePermission` and `canSeeCosts` do — `test:rules` holds this function
 * against both of them over every flag rather than against a second reading.
 *
 * `isSystemAdmin` is deliberately **not** consulted. It belongs at the call
 * site: the summary chip wants «what would the server answer», which includes
 * it, while the edit form wants «what does this record actually say», which
 * does not — seeding an administrator's form from an all-true object would
 * write all-true into their stored record on the next save.
 *
 * Saving from a form seeded this way writes **every** key explicitly, so the
 * ambiguity is gone for that account from then on.
 */
export function effectivePermissions(
  stored: Partial<Record<string, boolean>> | null | undefined,
): Record<string, boolean> {
  const resolved: Record<string, boolean> = {};
  for (const flag of PERMISSION_FLAGS) {
    const value = stored?.[flag.id];
    resolved[flag.id] = flag.fieldLevel ? value === true : value !== false;
  }
  return resolved;
}
