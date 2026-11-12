import { api } from "./client";
import type { CommissionState, CommissionTerms } from "../utils/referralCommission";

/** «معرف‌ها و پورسانت» endpoints — the strict `referrerCommissions` flag. */

export interface ReferredProjectRow {
  projectId: string;
  code: string;
  name: string;
  status: string;
  customerName: string;
  referrerCustomerId: string;
  won: boolean;
  winningDateJalali: string | null;
  creationDateJalali: string | null;
  revenueRial: number;
  grossProfitRial: number;
  marginPercent: number | null;
  costCoveragePercent: number;
  collectedPercent: number;
  terms: CommissionTerms | null;
  earned: number;
  payable: number;
  given: number;
  due: number;
  state: CommissionState;
}

export interface ReferrerRow {
  customerId: string;
  name: string;
  exists: boolean;
  commissionBasis: string | null;
  commissionRate: number | null;
  referred: number;
  won: number;
  revenueRial: number;
  grossProfitRial: number;
  earned: number;
  payable: number;
  given: number;
  due: number;
  projects: ReferredProjectRow[];
}

export interface PayoutRow {
  id: string;
  projectId: string;
  kind: string;
  amountRial: number;
  payoutDateJalali: string | null;
  description: string | null;
  createdByName: string | null;
  createdAt: string;
}

export const referrerCommissionsApi = {
  report: (query: { from?: string; to?: string; referrerId?: string }) =>
    api.get<{ referrers: ReferrerRow[]; truncated: boolean }>("/api/referrer-commissions", query),
  setTerms: (customerId: string, commissionBasis: string | null, commissionRate: number | null) =>
    api.put<Record<string, never>>(`/api/referrer-commissions/referrers/${customerId}/terms`, { commissionBasis, commissionRate }),
  payouts: (projectId: string) =>
    api.get<{ payouts: PayoutRow[] }>(`/api/referrer-commissions/projects/${projectId}/payouts`).then((r) => r.payouts),
  addPayout: (projectId: string, body: { kind: string; amountRial: number; payoutDate?: string; description?: string }) =>
    api.post<{ id: string }>(`/api/referrer-commissions/projects/${projectId}/payouts`, body),
  deletePayout: (id: string) => api.delete<Record<string, never>>(`/api/referrer-commissions/payouts/${id}`),
};
