import { CurrencyCode, ExpenseCategory, AccountType } from '../types/finance';

export const CURRENCIES: {
  code: CurrencyCode;
  nameAr: string;
  symbol: string;
}[] = [
  { code: 'EGP', nameAr: 'جنيه مصري', symbol: 'ج.م' },
  { code: 'SAR', nameAr: 'ريال سعودي', symbol: 'ر.س' },
  { code: 'AED', nameAr: 'درهم إماراتي', symbol: 'د.إ' },
  { code: 'USD', nameAr: 'دولار أمريكي', symbol: '$' },
  { code: 'EUR', nameAr: 'يورو', symbol: '€' },
  { code: 'GBP', nameAr: 'جنيه إسترليني', symbol: '£' },
  { code: 'KWD', nameAr: 'دينار كويتي', symbol: 'د.ك' },
  { code: 'QAR', nameAr: 'ريال قطري', symbol: 'ر.ق' },
  { code: 'BHD', nameAr: 'دينار بحريني', symbol: 'د.ب' },
  { code: 'OMR', nameAr: 'ريال عماني', symbol: 'ر.ع' },
  { code: 'JOD', nameAr: 'دينار أردني', symbol: 'د.أ' },
  { code: 'TRY', nameAr: 'ليرة تركية', symbol: '₺' },
  { code: 'MAD', nameAr: 'درهم مغربي', symbol: 'د.م' },
];

/** Approximate mid-market style rates vs EGP for local conversion demos. */
export const DEFAULT_RATES_TO_EGP: Record<CurrencyCode, number> = {
  EGP: 1,
  SAR: 13.0,
  AED: 13.3,
  USD: 48.8,
  EUR: 52.5,
  GBP: 62.0,
  KWD: 158.0,
  QAR: 13.4,
  BHD: 129.0,
  OMR: 126.5,
  JOD: 68.8,
  TRY: 1.45,
  MAD: 4.9,
};

export const EXPENSE_CATEGORIES: {
  id: ExpenseCategory;
  label: string;
  mark: string;
}[] = [
  { id: 'food', label: 'طعام', mark: 'ط' },
  { id: 'transport', label: 'مواصلات', mark: 'م' },
  { id: 'home', label: 'منزل', mark: 'ن' },
  { id: 'bills', label: 'فواتير', mark: 'ف' },
  { id: 'health', label: 'صحة', mark: 'ص' },
  { id: 'shopping', label: 'تسوق', mark: 'ت' },
  { id: 'education', label: 'تعليم', mark: 'ع' },
  { id: 'entertainment', label: 'ترفيه', mark: 'ر' },
  { id: 'other', label: 'أخرى', mark: 'أ' },
];

export const ACCOUNT_TYPES: { id: AccountType; label: string }[] = [
  { id: 'cash', label: 'نقدي' },
  { id: 'bank', label: 'بنك' },
  { id: 'wallet', label: 'محفظة' },
  { id: 'savings', label: 'ادخار' },
];

export function currencyMeta(code: CurrencyCode) {
  return CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0];
}
