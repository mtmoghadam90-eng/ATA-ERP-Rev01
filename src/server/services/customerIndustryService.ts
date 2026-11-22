import { getDb } from '../db';
import { invalidateSettingsCache } from '../settings';
import { DEFAULT_SETTINGS } from '../../seedData';
import { appendIndustry } from '../../utils/customerIndustries';

/** A narrow append, authorised by customer-write access, never a settings replacement. */
export async function addCustomerIndustry(value: unknown, db = getDb()) {
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await db.$transaction(async (tx) => {
        const row = await tx.appSetting.findUnique({ where: { id: 'singleton' } });
        const stored = row?.data ? JSON.parse(row.data) : {};
        const options = stored.dropdownItems?.industries ?? DEFAULT_SETTINGS.dropdownItems?.industries ?? [];
        const next = appendIndustry(options, value);
        const data = JSON.stringify({ ...stored, dropdownItems: { ...stored.dropdownItems, industries: next.industries } });
        await tx.appSetting.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', data }, update: { data } });
        return next;
      }, { isolationLevel: 'Serializable' });
      invalidateSettingsCache();
      return result;
    } catch (err) {
      if ((err as { code?: string }).code !== 'P2034' || attempt >= 2) throw err;
    }
  }
}
