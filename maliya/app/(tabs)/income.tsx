import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFinance } from '../../src/store/FinanceContext';
import { Button, H1, RowItem, Section } from '../../src/components/ui';
import { colors, radii, spacing } from '../../src/theme/tokens';
import { formatMoney, monthKey, monthLabelAr } from '../../src/utils/money';

export default function IncomeScreen() {
  const { state, monthIncomeIn } = useFinance();
  const currency = state.settings.defaultCurrency;
  const key = monthKey();
  const total = monthIncomeIn(currency, key);

  const salaries = useMemo(
    () => state.incomes.filter((i) => i.isSalary && i.monthKey === key),
    [state.incomes, key]
  );
  const others = useMemo(
    () => state.incomes.filter((i) => !i.isSalary || i.monthKey !== key),
    [state.incomes, key]
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <H1>الدخل والمرتب</H1>
        <View style={styles.hero}>
          <Text style={styles.label}>{monthLabelAr(key)}</Text>
          <Text style={styles.value}>{formatMoney(total, currency)}</Text>
          <Text style={styles.hint}>يشمل المرتب الشهري وأي دخل إضافي</Text>
        </View>

        <Section title="المرتب الشهري" subtitle="سجّل مرتبك لكل شهر">
          <View style={styles.list}>
            {salaries.length === 0 ? (
              <Text style={styles.empty}>لم يُسجّل مرتب لهذا الشهر بعد</Text>
            ) : (
              salaries.map((inc) => (
                <RowItem
                  key={inc.id}
                  title={inc.title}
                  subtitle={new Date(inc.date).toLocaleDateString('ar-EG')}
                  trailing={formatMoney(inc.amount, inc.currency)}
                  mark="م"
                  markTone="gold"
                />
              ))
            )}
          </View>
          <Button
            label="إدخال المرتب الشهري"
            onPress={() => router.push({ pathname: '/income/new', params: { salary: '1' } })}
          />
        </Section>

        <Section title="كل الدخل" subtitle="سجل الدخل الكامل">
          <View style={styles.list}>
            {[...salaries, ...others.filter((o) => !salaries.includes(o))]
              .slice(0, 12)
              .map((inc) => (
                <RowItem
                  key={inc.id}
                  title={inc.title}
                  subtitle={`${inc.isSalary ? 'مرتب' : 'دخل'} · ${inc.monthKey}`}
                  trailing={formatMoney(inc.amount, inc.currency)}
                  mark={inc.isSalary ? 'م' : 'د'}
                  markTone={inc.isSalary ? 'gold' : 'sage'}
                />
              ))}
          </View>
          <Button
            label="إضافة دخل"
            variant="secondary"
            onPress={() => router.push('/income/new')}
          />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.mist },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  hero: {
    backgroundColor: colors.goldSoft,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: '#E5D7A8',
  },
  label: {
    fontFamily: 'IBMPlexSansArabic_500Medium',
    color: colors.muted,
    textAlign: 'right',
  },
  value: {
    fontFamily: 'IBMPlexSansArabic_700Bold',
    fontSize: 32,
    color: colors.forest,
    textAlign: 'right',
    marginVertical: 6,
  },
  hint: {
    fontFamily: 'IBMPlexSansArabic_400Regular',
    color: colors.muted,
    textAlign: 'right',
  },
  list: { gap: spacing.sm },
  empty: {
    fontFamily: 'IBMPlexSansArabic_400Regular',
    color: colors.muted,
    textAlign: 'center',
    padding: spacing.md,
  },
});
