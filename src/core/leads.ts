// Lead capture.
//
// Stored in localStorage for now. When a backend lands, swap the two functions
// below for API calls — nothing else in the app touches storage directly.

import type { Audience } from './types';

export interface StoredLead {
  id: string;
  createdAt: string;
  quoteNo: string;
  name: string;
  email: string;
  phone: string;
  zip: string;
  notes: string;
  modelId: string;
  total: number;
  shareLink: string;
  audience: Audience;
}

const KEY = 'bc.leads.v1';

export function listLeads(): StoredLead[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as StoredLead[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLead(lead: Omit<StoredLead, 'id' | 'createdAt'>): StoredLead {
  const record: StoredLead = {
    ...lead,
    id: `l${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    createdAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify([record, ...listLeads()].slice(0, 500)));
  } catch {
    // Storage full or blocked; the quote document is still produced.
  }
  return record;
}

export function deleteLead(id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(listLeads().filter((l) => l.id !== id)));
  } catch {
    // Nothing to do.
  }
}

export function leadsToCsv(leads: StoredLead[]): string {
  const cols: (keyof StoredLead)[] = [
    'createdAt', 'quoteNo', 'name', 'email', 'phone', 'zip', 'modelId', 'total', 'audience', 'notes', 'shareLink',
  ];
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [cols.join(','), ...leads.map((l) => cols.map((c) => cell(l[c])).join(','))].join('\r\n');
}
