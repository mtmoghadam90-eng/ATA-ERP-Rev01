/**
 * Seeds the SQL Server database with the reference data the app cannot start
 * without: user accounts, the settings document, and exchange rates.
 *
 * Idempotent — every write is an upsert keyed on a natural key, so running it
 * twice changes nothing. It deliberately does NOT seed business data (customers,
 * projects, products): those are entered by users, and the previous JSON seeds
 * were demo rows nobody wants in a real database.
 *
 *   npx tsx scripts/seedDb.ts
 *
 * Output is English on purpose: the Windows console codepage mangles Persian.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { getDb, disconnectDb, isDbConfigured } from "../src/server/db";
import { SEED_USERS } from "../src/useERPStore";
import { DEFAULT_SETTINGS, SEED_EXCHANGE_RATES } from "../src/seedData";

const BCRYPT_HASH_RE = /^\$2[aby]\$\d{2}\$/;

/** Hashes a seed password unless it is already a hash (bcryptjs emits $2a$). */
function toHash(password: string | undefined): string {
  const raw = password || "123";
  return BCRYPT_HASH_RE.test(raw) ? raw : bcrypt.hashSync(raw, 10);
}

async function seedUsers(): Promise<number> {
  const db = getDb();
  let written = 0;

  for (const u of SEED_USERS) {
    const data = {
      username: u.username,
      fullName: u.fullName,
      role: u.role || "user",
      isSystemAdmin: !!u.isSystemAdmin,
      position: u.position ?? null,
      signatureImage: u.signatureImage ?? null,
      permissions: u.permissions ? JSON.stringify(u.permissions) : null,
    };

    // Keyed on username, not id: a re-run must not create a second account for
    // the same person, and it must never overwrite a password already changed.
    await db.user.upsert({
      where: { username: u.username },
      create: { id: u.id, ...data, passwordHash: toHash(u.password) },
      update: data,
    });
    written++;
  }
  return written;
}

async function seedSettings(): Promise<boolean> {
  const db = getDb();
  const existing = await db.appSetting.findUnique({ where: { id: "singleton" } });
  if (existing) return false; // never clobber configuration a user has edited

  await db.appSetting.create({
    data: { id: "singleton", data: JSON.stringify(DEFAULT_SETTINGS) },
  });
  return true;
}

async function seedRates(): Promise<number> {
  const db = getDb();
  let written = 0;
  for (const r of SEED_EXCHANGE_RATES) {
    // Rates are refreshed from tgju.org at runtime, so only create — an upsert
    // that updated would push live rates back to these stale starting values.
    const existing = await db.exchangeRate.findUnique({ where: { currency: r.currency } });
    if (existing) continue;
    await db.exchangeRate.create({
      data: {
        id: r.id,
        currency: r.currency,
        name: r.name,
        rateToRial: r.rateToRIYAL,
        lastUpdated: new Date(r.lastUpdated),
      },
    });
    written++;
  }
  return written;
}

async function main(): Promise<void> {
  if (!isDbConfigured()) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
    process.exit(1);
  }

  console.log("Seeding reference data...");
  const users = await seedUsers();
  console.log(`  users:          ${users} upserted`);

  const settings = await seedSettings();
  console.log(`  settings:       ${settings ? "created" : "already present, left untouched"}`);

  const rates = await seedRates();
  console.log(`  exchange rates: ${rates} created`);

  console.log("Done. Seed accounts use password 123 and are forced to change it at first login.");
}

main()
  .catch((err) => {
    console.error("Seeding failed:", err?.message || err);
    process.exit(1);
  })
  .finally(() => disconnectDb());
