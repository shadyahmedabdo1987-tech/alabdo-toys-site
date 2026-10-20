import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFinance } from '../../src/store/FinanceContext';
import { Button, Chip, H1, RowItem, Section } from '../../src/components/ui';
import { colors, spacing } from '../../src/theme/tokens';
import { formatMoney } from '../../src/utils/money';
import { DebtDirection } from '../../src/types/finance';

export default function DebtsScreen() {
  const { state, debtSummaryIn } = useFinance();
  const [tab, setTab] = useState<DebtDirection | 'all'>('all');
  const currency = state.settings.defaultCurrency;
  const summary = debtSummaryIn(currency);

  const list = useMemo(() => {
    if (tab === 'all') return state.debts;
    return state.debts.filter((d) => d.direction === tab);
  }, [state.debts, tab]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <H1>المديونيات</H1>
        <View style={styles.cards}>
          <View style={[styles.card, styles.cardGood]}>
            <Text style={styles.cardLabel}>لك عند الآخرين</Text>
            <Text style={[styles.cardValue, { color: colors.teal }]}>
              {formatMoney(summary.owedToMe, currency)}
            </Text>
          </View>
          <View style={[styles.card, styles.cardWarn]}>
            <Text style={styles.cardLabel}>عليك للآخرين</Text>
            <Text style={[styles.cardValue, { color: colors.coral }]}>
              {formatMoney(summary.iOwe, currency)}
            </Text>
          </View>
        </View>

        <View style={styles.chips}>
          <Chip label="الكل" active={tab === 'all'} onPress={() => setTab('all')} />
          <Chip
            label="لي"
            active={tab === 'owed_to_me'}
            onPress={() => setTab('owed_to_me')}
          />
          <Chip
            label="عليّ"
            active={tab === 'i_owe'}
            onPress={() => setTab('i_owe')}
          />
        </View>

        <Section title="قائمة الديون" subtitle="اضغط لتسجيل سداد">
          <View style={styles.list}>
            {list.map((d) => {
              const remaining = Math.max(0, d.amount - d.paidAmount);
              const status =
                d.status === 'paid'
                  ? 'مسدد'
                  : d.status === 'partial'
                    ? 'جزئي'
                    : 'مفتوح';
              return (
                <RowItem
                  key={d.id}
                  title={d.person}
                  subtitle={`${d.direction === 'owed_to_me' ? 'لي' : 'عليّ'} · ${status}`}
                  trailing={formatMoney(remaining, d.currency)}
                  mark={d.person.slice(0, 1)}
                  markTone={d.direction === 'owed_to_me' ? 'gold' : 'coral'}
                  onPress={() => router.push(`/debt/${d.id}`)}
                />
              );
            })}
          </View>
          <Button label="إضافة مديونية" onPress={() => router.push('/debt/new')} />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.mist },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  cards: { flexDirection: 'row-reverse', gap: spacing.sm },
  card: {
    flex: 1,
    borderRadius: 16,
    padding: spacing.md,
    borderWidth: 1,
  },
  cardGood: {
    backgroundColor: colors.sage,
    borderColor: '#C5DDD5',
  },
  cardWarn: {
    backgroundColor: colors.coralSoft,
    borderColor: '#EDD2CB',
  },
  cardLabel: {
    fontFamily: 'IBMPlexSansArabic_400Regular',
    color: colors.muted,
    textAlign: 'right',
    fontSize: 12,
  },
  cardValue: {
    fontFamily: 'IBMPlexSansArabic_700Bold',
    fontSize: 18,
    textAlign: 'right',
    marginTop: 6,
  },
  chips: { flexDirection: 'row-reverse', gap: 8 },
  list: { gap: spacing.sm },
});
