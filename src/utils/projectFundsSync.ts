/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Client, ProjectProfile } from '../types';

/**
 * Single Source of Truth for a project's live Funds Collected (PHP),
 * derived from Paid records in the Progress Billing / Installment Ledger.
 * Matches client ledger records by project_id/code (e.g. PRJ-0650),
 * project name, client name, projectIds array, or fallback email slug.
 */
export function getCanonicalProjectFundsCollected(
  project: ProjectProfile | null | undefined,
  clients: Client[] = []
): number {
  if (!project) return 0;

  const pid = String(project.id || '').trim().toLowerCase();
  const pidSlug = pid.replace(/[^a-z0-9]/g, '');
  const pname = String(project.name || '').trim().toLowerCase();
  const pclient = String(project.clientName || '').trim().toLowerCase();

  if (Array.isArray(clients) && clients.length > 0) {
    const matchedClients = clients.filter((c) => {
      const cname = String(c.name || '').trim().toLowerCase();
      const cpkg = String(c.packageName || '').trim().toLowerCase();
      const cemail = String(c.email || '').trim().toLowerCase();
      const cpids: string[] = Array.isArray((c as any).projectIds)
        ? (c as any).projectIds.map((x: any) => String(x || '').trim().toLowerCase())
        : [];

      if (pid && (cname === pid || cpkg === pid || cpids.includes(pid))) return true;
      if (pname && (cpkg === pname || cname === pname)) return true;
      if (pclient && cname === pclient) return true;
      if (pidSlug && pidSlug.length >= 4 && cemail.includes(pidSlug)) return true;
      return false;
    });

    if (matchedClients.length > 0) {
      const paidSum = matchedClients.reduce((acc, c) => {
        const payments = Array.isArray(c.payments) ? c.payments : [];
        const clientPaid = payments
          .filter((pay) => String(pay.status || '').toUpperCase() === 'PAID')
          .reduce((s, pay) => s + (Number(pay.amount) || 0), 0);
        return acc + clientPaid;
      }, 0);
      return Math.round(paidSum * 100) / 100;
    }
  }

  return Math.round(Number(project.fundsCollected || 0) * 100) / 100;
}
