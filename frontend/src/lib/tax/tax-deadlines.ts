/**
 * Tax deadline alerts for investors.
 *
 * Tracks filing deadlines, extension deadlines, and estimated payment
 * due dates across multiple jurisdictions.
 */

import { JurisdictionCode } from './jurisdictions';

export type DeadlineType = 'filing' | 'extension' | 'estimated_payment' | 'information_return';

export interface TaxDeadline {
  id: string;
  type: DeadlineType;
  title: string;
  description: string;
  date: string; // ISO date
  jurisdiction: JurisdictionCode;
  isRecurring: boolean;
  daysUntilDeadline: number;
  severity: 'overdue' | 'critical' | 'warning' | 'info';
}

export interface DeadlineAlert {
  deadline: TaxDeadline;
  message: string;
  actionUrl?: string;
}

interface DeadlineDefinition {
  type: DeadlineType;
  title: string;
  description: string;
  month: number; // 1-12
  day: number; // 1-31
  isRecurring: boolean;
}

const JURISDICTION_DEADLINES: Record<JurisdictionCode, DeadlineDefinition[]> = {
  US: [
    { type: 'filing', title: 'Federal Tax Filing Deadline', description: 'IRS Form 1040 due for individual income tax', month: 4, day: 15, isRecurring: true },
    { type: 'estimated_payment', title: 'Q1 Estimated Tax Payment', description: 'First quarterly estimated tax payment due', month: 4, day: 15, isRecurring: true },
    { type: 'estimated_payment', title: 'Q2 Estimated Tax Payment', description: 'Second quarterly estimated tax payment due', month: 6, day: 15, isRecurring: true },
    { type: 'estimated_payment', title: 'Q3 Estimated Tax Payment', description: 'Third quarterly estimated tax payment due', month: 9, day: 15, isRecurring: true },
    { type: 'estimated_payment', title: 'Q4 Estimated Tax Payment', description: 'Fourth quarterly estimated tax payment due', month: 1, day: 15, isRecurring: true },
    { type: 'extension', title: 'Extension Filing Deadline', description: 'Extended federal tax filing deadline (if extension filed)', month: 10, day: 15, isRecurring: true },
  ],
  UK: [
    { type: 'filing', title: 'Self Assessment Registration', description: 'Register for Self Assessment by this date', month: 10, day: 5, isRecurring: true },
    { type: 'filing', title: 'Self Assessment Paper Return', description: 'Paper tax return deadline', month: 10, day: 31, isRecurring: true },
    { type: 'filing', title: 'Self Assessment Online Return', description: 'Online tax return deadline', month: 1, day: 31, isRecurring: true },
    { type: 'estimated_payment', title: 'Balancing Payment Due', description: 'Balancing payment for previous tax year', month: 1, day: 31, isRecurring: true },
    { type: 'estimated_payment', title: 'First Payment on Account', description: 'First payment on account for current tax year', month: 7, day: 31, isRecurring: true },
    { type: 'estimated_payment', title: 'Second Payment on Account', description: 'Second payment on account', month: 1, day: 31, isRecurring: true },
  ],
  CA: [
    { type: 'filing', title: 'Personal Tax Filing Deadline', description: 'T1 General income tax return due', month: 4, day: 30, isRecurring: true },
    { type: 'estimated_payment', title: 'Instalment Payment Q1', description: 'First quarterly tax instalment', month: 3, day: 15, isRecurring: true },
    { type: 'estimated_payment', title: 'Instalment Payment Q2', description: 'Second quarterly tax instalment', month: 6, day: 15, isRecurring: true },
    { type: 'estimated_payment', title: 'Instalment Payment Q3', description: 'Third quarterly tax instalment', month: 9, day: 15, isRecurring: true },
    { type: 'estimated_payment', title: 'Instalment Payment Q4', description: 'Fourth quarterly tax instalment', month: 12, day: 15, isRecurring: true },
  ],
  AU: [
    { type: 'filing', title: 'Individual Tax Return Deadline', description: 'Lodge tax return by this date', month: 10, day: 31, isRecurring: true },
    { type: 'estimated_payment', title: 'PAYG Instalment Q1', description: 'First PAYG instalment', month: 3, day: 28, isRecurring: true },
    { type: 'estimated_payment', title: 'PAYG Instalment Q2', description: 'Second PAYG instalment', month: 6, day: 28, isRecurring: true },
    { type: 'estimated_payment', title: 'PAYG Instalment Q3', description: 'Third PAYG instalment', month: 9, day: 28, isRecurring: true },
    { type: 'estimated_payment', title: 'PAYG Instalment Q4', description: 'Fourth PAYG instalment', month: 12, day: 28, isRecurring: true },
  ],
  EU: [
    { type: 'filing', title: 'Annual Tax Filing', description: 'Annual income tax return (varies by member state)', month: 7, day: 31, isRecurring: true },
    { type: 'estimated_payment', title: 'Advance Tax Payment Q1', description: 'First advance payment', month: 3, day: 15, isRecurring: true },
    { type: 'estimated_payment', title: 'Advance Tax Payment Q2', description: 'Second advance payment', month: 6, day: 15, isRecurring: true },
  ],
  ZA: [
    { type: 'filing', title: 'Provisional Tax Return Filing', description: 'Provisional tax return (IRP6) due', month: 8, day: 31, isRecurring: true },
    { type: 'filing', title: 'Annual Tax Return', description: 'ITR12 annual tax return deadline', month: 11, day: 24, isRecurring: true },
    { type: 'estimated_payment', title: 'First Provisional Payment', description: 'First provisional tax payment', month: 8, day: 31, isRecurring: true },
    { type: 'estimated_payment', title: 'Second Provisional Payment', description: 'Second provisional tax payment', month: 2, day: 28, isRecurring: true },
  ],
  IN: [
    { type: 'filing', title: 'ITR Filing Deadline', description: 'Income Tax Return (ITR) due date', month: 7, day: 31, isRecurring: true },
    { type: 'estimated_payment', title: 'Advance Tax Q1 (15%)', description: 'First advance tax instalment', month: 6, day: 15, isRecurring: true },
    { type: 'estimated_payment', title: 'Advance Tax Q2 (45%)', description: 'Second advance tax instalment', month: 9, day: 15, isRecurring: true },
    { type: 'estimated_payment', title: 'Advance Tax Q3 (75%)', description: 'Third advance tax instalment', month: 12, day: 15, isRecurring: true },
    { type: 'estimated_payment', title: 'Advance Tax Q4 (100%)', description: 'Final advance tax instalment', month: 3, day: 15, isRecurring: true },
  ],
  SG: [
    { type: 'filing', title: 'Income Tax Filing Deadline', description: 'File income tax return (e-filing)', month: 4, day: 18, isRecurring: true },
    { type: 'estimated_payment', title: 'Tax Payment Deadline', description: 'Payment of tax assessed', month: 5, day: 1, isRecurring: true },
  ],
};

function calculateDaysUntil(targetMonth: number, targetDay: number): number {
  const now = new Date();
  const year = now.getFullYear();

  // Handle January deadlines that fall in the next calendar year
  let targetYear = year;
  if (targetMonth < now.getMonth() + 1 || (targetMonth === now.getMonth() + 1 && targetDay < now.getDate())) {
    targetYear = year + 1;
  }

  const target = new Date(targetYear, targetMonth - 1, targetDay);
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function getSeverity(daysUntil: number): TaxDeadline['severity'] {
  if (daysUntil < 0) return 'overdue';
  if (daysUntil <= 7) return 'critical';
  if (daysUntil <= 30) return 'warning';
  return 'info';
}

/**
 * Get all upcoming tax deadlines for a jurisdiction.
 */
export function getUpcomingDeadlines(
  jurisdiction: JurisdictionCode,
  limit: number = 5,
): TaxDeadline[] {
  const definitions = JURISDICTION_DEADLINES[jurisdiction] ?? JURISDICTION_DEADLINES.US;

  const deadlines: TaxDeadline[] = definitions.map((def, index) => {
    const daysUntil = calculateDaysUntil(def.month, def.day);
    return {
      id: `${jurisdiction}-${def.type}-${index}`,
      type: def.type,
      title: def.title,
      description: def.description,
      date: new Date(new Date().getFullYear(), def.month - 1, def.day).toISOString().slice(0, 10),
      jurisdiction,
      isRecurring: def.isRecurring,
      daysUntilDeadline: daysUntil,
      severity: getSeverity(daysUntil),
    };
  });

  return deadlines
    .filter((d) => d.daysUntilDeadline >= 0)
    .sort((a, b) => a.daysUntilDeadline - b.daysUntilDeadline)
    .slice(0, limit);
}

/**
 * Get overdue deadlines (past due, not yet resolved).
 */
export function getOverdueDeadlines(jurisdiction: JurisdictionCode): TaxDeadline[] {
  const definitions = JURISDICTION_DEADLINES[jurisdiction] ?? JURISDICTION_DEADLINES.US;

  return definitions
    .map((def, index) => {
      const daysUntil = calculateDaysUntil(def.month, def.day);
      return {
        id: `${jurisdiction}-${def.type}-${index}`,
        type: def.type,
        title: def.title,
        description: def.description,
        date: new Date(new Date().getFullYear(), def.month - 1, def.day).toISOString().slice(0, 10),
        jurisdiction,
        isRecurring: def.isRecurring,
        daysUntilDeadline: daysUntil,
        severity: getSeverity(daysUntil),
      };
    })
    .filter((d) => d.daysUntilDeadline < 0)
    .sort((a, b) => b.daysUntilDeadline - a.daysUntilDeadline);
}

/**
 * Generate deadline alert messages.
 */
export function generateDeadlineAlerts(jurisdiction: JurisdictionCode): DeadlineAlert[] {
  const upcoming = getUpcomingDeadlines(jurisdiction, 3);
  const overdue = getOverdueDeadlines(jurisdiction);

  const alerts: DeadlineAlert[] = [];

  for (const deadline of overdue) {
    alerts.push({
      deadline,
      message: `${deadline.title} is ${Math.abs(deadline.daysUntilDeadline)} days overdue. File immediately to avoid penalties.`,
    });
  }

  for (const deadline of upcoming) {
    if (deadline.severity === 'critical') {
      alerts.push({
        deadline,
        message: `${deadline.title} is due in ${deadline.daysUntilDeadline} days. Prepare your filing now.`,
      });
    } else if (deadline.severity === 'warning') {
      alerts.push({
        deadline,
        message: `${deadline.title} is due in ${deadline.daysUntilDeadline} days.`,
      });
    }
  }

  return alerts;
}
