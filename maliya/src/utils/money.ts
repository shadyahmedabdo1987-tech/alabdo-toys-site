import { CurrencyCode } from '../types/finance';
import { currencyMeta } from '../data/currencies';

export function formatMoney(
  amount: number,
  currency: CurrencyCode,
  options?: { compact?: boolean }
): string {
  const meta = currencyMeta(currency);
  const abs = Math.abs(amount);
  const formatted = new Intl.NumberFormat('ar-EG', {
    minimumFractionDigits: abs % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(abs);

  const sign = amount < 0 ? '−' : '';
  if (options?.compact) {
    return `${sign}${formatted} ${meta.symbol}`;
  }
  return `${sign}${formatted} ${meta.symbol}`;
}

export function convertAmount(
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode,
  ratesToEGP: Record<CurrencyCode, number>
): number {
  if (from === to) return amount;
  const inEgp = amount * (ratesToEGP[from] || 1);
  return inEgp / (ratesToEGP[to] || 1);
}

export function monthKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function monthLabelAr(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return new Intl.DateTimeFormat('ar-EG', {
    month: 'long',
    year: 'numeric',
  }).format(d);
}

export function createId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
