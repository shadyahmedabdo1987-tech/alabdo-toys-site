import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Account,
  Debt,
  DebtPayment,
  Expense,
  FinanceState,
  Income,
  AppSettings,
  CurrencyCode,
} from '../types/finance';
import { DEFAULT_RATES_TO_EGP } from '../data/currencies';
import { convertAmount, createId, monthKey } from '../utils/money';

const STORAGE_KEY = 'raseed_finance_v1';

const defaultSettings: AppSettings = {
  defaultCurrency: 'EGP',
  displayName: 'حسابي',
  ratesToEGP: DEFAULT_RATES_TO_EGP,
};

function seedState(): FinanceState {
  const cashId = createId('acc');
  const bankId = createId('acc');
  const now = new Date().toISOString();
  const thisMonth = monthKey();

  const accounts: Account[] = [
    {
      id: cashId,
      name: 'نقدي',
      type: 'cash',
      currency: 'EGP',
      balance: 4200,
      createdAt: now,
    },
    {
      id: bankId,
      name: 'حساب بنكي',
      type: 'bank',
      currency: 'EGP',
      balance: 28500,
      createdAt: now,
    },
    {
      id: createId('acc'),
      name: 'محفظة دولار',
      type: 'wallet',
      currency: 'USD',
      balance: 350,
      createdAt: now,
    },
  ];

  const incomes: Income[] = [
    {
      id: createId('inc'),
      title: 'المرتب الشهري',
      amount: 18000,
      currency: 'EGP',
      accountId: bankId,
      isSalary: true,
      monthKey: thisMonth,
      date: now,
      createdAt: now,
    },
  ];

  const expenses: Expense[] = [
    {
      id: createId('exp'),
      title: 'بقالة الأسبوع',
      amount: 850,
      currency: 'EGP',
      category: 'food',
      accountId: cashId,
      date: now,
      createdAt: now,
    },
    {
      id: createId('exp'),
      title: 'وقود',
      amount: 600,
      currency: 'EGP',
      category: 'transport',
      accountId: cashId,
      date: now,
      createdAt: now,
    },
    {
      id: createId('exp'),
      title: 'فاتورة نت',
      amount: 350,
      currency: 'EGP',
      category: 'bills',
      accountId: bankId,
      date: now,
      createdAt: now,
    },
  ];

  const debts: Debt[] = [
    {
      id: createId('debt'),
      person: 'أحمد',
      direction: 'owed_to_me',
      amount: 2500,
      currency: 'EGP',
      paidAmount: 500,
      status: 'partial',
      note: 'سلفة مؤقتة',
      payments: [
        {
          id: createId('pay'),
          amount: 500,
          currency: 'EGP',
          date: now,
          note: 'دفعة أولى',
        },
      ],
      createdAt: now,
    },
    {
      id: createId('debt'),
      person: 'محل الأجهزة',
      direction: 'i_owe',
      amount: 4000,
      currency: 'EGP',
      paidAmount: 0,
      status: 'open',
      dueDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 20).toISOString(),
      payments: [],
      createdAt: now,
    },
  ];

  return {
    accounts,
    expenses,
    incomes,
    debts,
    settings: defaultSettings,
  };
}

interface FinanceContextValue {
  ready: boolean;
  state: FinanceState;
  totalBalanceIn: (currency: CurrencyCode) => number;
  monthExpenseIn: (currency: CurrencyCode, key?: string) => number;
  monthIncomeIn: (currency: CurrencyCode, key?: string) => number;
  debtSummaryIn: (currency: CurrencyCode) => {
    owedToMe: number;
    iOwe: number;
  };
  addExpense: (input: Omit<Expense, 'id' | 'createdAt'>) => void;
  addIncome: (input: Omit<Income, 'id' | 'createdAt'>) => void;
  addAccount: (input: Omit<Account, 'id' | 'createdAt'>) => void;
  addDebt: (
    input: Omit<Debt, 'id' | 'createdAt' | 'paidAmount' | 'status' | 'payments'>
  ) => void;
  addDebtPayment: (
    debtId: string,
    payment: Omit<DebtPayment, 'id'>
  ) => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
  resetDemo: () => void;
}

const FinanceContext = createContext<FinanceContextValue | null>(null);

export function FinanceProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<FinanceState>(seedState);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw && mounted) {
          const parsed = JSON.parse(raw) as FinanceState;
          setState({
            ...seedState(),
            ...parsed,
            settings: { ...defaultSettings, ...parsed.settings },
          });
        }
      } catch {
        // keep seed
      } finally {
        if (mounted) setReady(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
  }, [state, ready]);

  const totalBalanceIn = useCallback(
    (currency: CurrencyCode) =>
      state.accounts.reduce(
        (sum, acc) =>
          sum +
          convertAmount(
            acc.balance,
            acc.currency,
            currency,
            state.settings.ratesToEGP
          ),
        0
      ),
    [state.accounts, state.settings.ratesToEGP]
  );

  const monthExpenseIn = useCallback(
    (currency: CurrencyCode, key = monthKey()) =>
      state.expenses
        .filter((e) => e.date.slice(0, 7) === key)
        .reduce(
          (sum, e) =>
            sum +
            convertAmount(
              e.amount,
              e.currency,
              currency,
              state.settings.ratesToEGP
            ),
          0
        ),
    [state.expenses, state.settings.ratesToEGP]
  );

  const monthIncomeIn = useCallback(
    (currency: CurrencyCode, key = monthKey()) =>
      state.incomes
        .filter((i) => i.monthKey === key)
        .reduce(
          (sum, i) =>
            sum +
            convertAmount(
              i.amount,
              i.currency,
              currency,
              state.settings.ratesToEGP
            ),
          0
        ),
    [state.incomes, state.settings.ratesToEGP]
  );

  const debtSummaryIn = useCallback(
    (currency: CurrencyCode) => {
      let owedToMe = 0;
      let iOwe = 0;
      for (const d of state.debts) {
        const remaining = Math.max(0, d.amount - d.paidAmount);
        const converted = convertAmount(
          remaining,
          d.currency,
          currency,
          state.settings.ratesToEGP
        );
        if (d.direction === 'owed_to_me') owedToMe += converted;
        else iOwe += converted;
      }
      return { owedToMe, iOwe };
    },
    [state.debts, state.settings.ratesToEGP]
  );

  const addExpense = useCallback((input: Omit<Expense, 'id' | 'createdAt'>) => {
    setState((prev) => {
      const expense: Expense = {
        ...input,
        id: createId('exp'),
        createdAt: new Date().toISOString(),
      };
      const accounts = prev.accounts.map((a) => {
        if (a.id !== input.accountId) return a;
        const deduct = convertAmount(
          input.amount,
          input.currency,
          a.currency,
          prev.settings.ratesToEGP
        );
        return { ...a, balance: a.balance - deduct };
      });
      return { ...prev, expenses: [expense, ...prev.expenses], accounts };
    });
  }, []);

  const addIncome = useCallback((input: Omit<Income, 'id' | 'createdAt'>) => {
    setState((prev) => {
      const income: Income = {
        ...input,
        id: createId('inc'),
        createdAt: new Date().toISOString(),
      };
      const accounts = prev.accounts.map((a) => {
        if (a.id !== input.accountId) return a;
        const add = convertAmount(
          input.amount,
          input.currency,
          a.currency,
          prev.settings.ratesToEGP
        );
        return { ...a, balance: a.balance + add };
      });
      return { ...prev, incomes: [income, ...prev.incomes], accounts };
    });
  }, []);

  const addAccount = useCallback(
    (input: Omit<Account, 'id' | 'createdAt'>) => {
      setState((prev) => ({
        ...prev,
        accounts: [
          {
            ...input,
            id: createId('acc'),
            createdAt: new Date().toISOString(),
          },
          ...prev.accounts,
        ],
      }));
    },
    []
  );

  const addDebt = useCallback(
    (
      input: Omit<
        Debt,
        'id' | 'createdAt' | 'paidAmount' | 'status' | 'payments'
      >
    ) => {
      setState((prev) => ({
        ...prev,
        debts: [
          {
            ...input,
            id: createId('debt'),
            paidAmount: 0,
            status: 'open',
            payments: [],
            createdAt: new Date().toISOString(),
          },
          ...prev.debts,
        ],
      }));
    },
    []
  );

  const addDebtPayment = useCallback(
    (debtId: string, payment: Omit<DebtPayment, 'id'>) => {
      setState((prev) => ({
        ...prev,
        debts: prev.debts.map((d) => {
          if (d.id !== debtId) return d;
          const paidInDebtCurrency = convertAmount(
            payment.amount,
            payment.currency,
            d.currency,
            prev.settings.ratesToEGP
          );
          const paidAmount = Math.min(
            d.amount,
            d.paidAmount + paidInDebtCurrency
          );
          const status =
            paidAmount <= 0
              ? 'open'
              : paidAmount >= d.amount
                ? 'paid'
                : 'partial';
          return {
            ...d,
            paidAmount,
            status,
            payments: [
              { ...payment, id: createId('pay') },
              ...d.payments,
            ],
          };
        }),
      }));
    },
    []
  );

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setState((prev) => ({
      ...prev,
      settings: { ...prev.settings, ...patch },
    }));
  }, []);

  const resetDemo = useCallback(() => {
    setState(seedState());
  }, []);

  const value = useMemo(
    () => ({
      ready,
      state,
      totalBalanceIn,
      monthExpenseIn,
      monthIncomeIn,
      debtSummaryIn,
      addExpense,
      addIncome,
      addAccount,
      addDebt,
      addDebtPayment,
      updateSettings,
      resetDemo,
    }),
    [
      ready,
      state,
      totalBalanceIn,
      monthExpenseIn,
      monthIncomeIn,
      debtSummaryIn,
      addExpense,
      addIncome,
      addAccount,
      addDebt,
      addDebtPayment,
      updateSettings,
      resetDemo,
    ]
  );

  return (
    <FinanceContext.Provider value={value}>{children}</FinanceContext.Provider>
  );
}

export function useFinance() {
  const ctx = useContext(FinanceContext);
  if (!ctx) throw new Error('useFinance must be used within FinanceProvider');
  return ctx;
}
