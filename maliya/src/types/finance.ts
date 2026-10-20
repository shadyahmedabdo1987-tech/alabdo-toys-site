export type CurrencyCode =
  | 'EGP'
  | 'SAR'
  | 'AED'
  | 'USD'
  | 'EUR'
  | 'GBP'
  | 'KWD'
  | 'QAR'
  | 'BHD'
  | 'OMR'
  | 'JOD'
  | 'TRY'
  | 'MAD';

export type AccountType = 'cash' | 'bank' | 'wallet' | 'savings';

export type ExpenseCategory =
  | 'food'
  | 'transport'
  | 'home'
  | 'bills'
  | 'health'
  | 'shopping'
  | 'education'
  | 'entertainment'
  | 'other';

export type DebtDirection = 'owed_to_me' | 'i_owe';

export type DebtStatus = 'open' | 'partial' | 'paid';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: CurrencyCode;
  balance: number;
  createdAt: string;
}

export interface Expense {
  id: string;
  title: string;
  amount: number;
  currency: CurrencyCode;
  category: ExpenseCategory;
  accountId: string;
  note?: string;
  date: string;
  createdAt: string;
}

export interface Income {
  id: string;
  title: string;
  amount: number;
  currency: CurrencyCode;
  accountId: string;
  isSalary: boolean;
  monthKey: string;
  note?: string;
  date: string;
  createdAt: string;
}

export interface DebtPayment {
  id: string;
  amount: number;
  currency: CurrencyCode;
  date: string;
  note?: string;
}

export interface Debt {
  id: string;
  person: string;
  direction: DebtDirection;
  amount: number;
  currency: CurrencyCode;
  paidAmount: number;
  status: DebtStatus;
  dueDate?: string;
  note?: string;
  payments: DebtPayment[];
  createdAt: string;
}

export interface AppSettings {
  defaultCurrency: CurrencyCode;
  displayName: string;
  ratesToEGP: Record<CurrencyCode, number>;
}

export interface FinanceState {
  accounts: Account[];
  expenses: Expense[];
  incomes: Income[];
  debts: Debt[];
  settings: AppSettings;
}
