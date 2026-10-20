import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFinance } from '../../src/store/FinanceContext';
import { Button, Chip, H1, RowItem, Section } from '../../src/components/ui';
import { colors, spacing } from '../../src/theme/tokens';
import { EXPENSE_CATEGORIES } from '../../src/data/currencies';
import { formatMoney, monthKey } from '../../src/utils/money';
import { ExpenseCategory } from '../../src/types/finance';

export default function ExpensesScreen() {
  const { state, monthExpenseIn } = useFinance();
  const [filter, setFilter] = useState<ExpenseCategory | 'all'>('all');
  const currency = state.settings.defaultCurrency;
  const total = monthExpenseIn(currency);

  const list = useMemo(() => {
    const base = state.expenses.filter((e) => e.date.slice(0, 7) === monthKey());
    if (filter === 'all') return base;
    return base.filter((e) => e.category === filter);
  }, [state.expenses, filter]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.head}>
          <H1>المصروفات</H1>
          <Text style={styles.total}>{formatMoney(total, currency)}</Text>
          <Text style={styles.sub}>إجمالي هذا الشهر بعملة العرض</Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          <Chip
            label="الكل"
            active={filter === 'all'}
            onPress={() => setFilter('all')}
          />
          {EXPENSE_CATEGORIES.map((c) => (
            <Chip
              key={c.id}
              label={c.label}
              active={filter === c.id}
              onPress={() => setFilter(c.id)}
            />
          ))}
        </ScrollView>

        <Section title="سجل المصروفات" subtitle={`${list.length} عملية`}>
          <View style={styles.list}>
            {list.length === 0 ? (
              <Text style={styles.empty}>لا توجد مصروفات في هذا التصنيف</Text>
            ) : (
              list.map((exp) => {
                const cat = EXPENSE_CATEGORIES.find((c) => c.id === exp.category);
                return (
                  <RowItem
                    key={exp.id}
                    title={exp.title}
                    subtitle={`${cat?.label ?? ''} · ${new Date(exp.date).toLocaleDateString('ar-EG')}`}
                    trailing={formatMoney(-exp.amount, exp.currency)}
                    mark={cat?.mark ?? 'م'}
                    markTone="coral"
                  />
                );
              })
            )}
          </View>
          <Button
            label="إضافة مصروف"
            onPress={() => router.push('/expense/new')}
          />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.mist },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  head: { gap: 4 },
  total: {
    fontFamily: 'IBMPlexSansArabic_700Bold',
    fontSize: 30,
    color: colors.coral,
    textAlign: 'right',
  },
  sub: {
    fontFamily: 'IBMPlexSansArabic_400Regular',
    color: colors.muted,
    textAlign: 'right',
  },
  chips: {
    flexDirection: 'row-reverse',
    gap: 8,
    paddingVertical: 4,
  },
  list: { gap: spacing.sm },
  empty: {
    fontFamily: 'IBMPlexSansArabic_400Regular',
    color: colors.muted,
    textAlign: 'center',
    padding: spacing.lg,
  },
});
