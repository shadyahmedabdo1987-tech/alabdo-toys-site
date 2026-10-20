import React, { useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFinance } from '../../src/store/FinanceContext';
import { Button, Chip, Field, H1, RowItem, Section } from '../../src/components/ui';
import { colors, radii, spacing } from '../../src/theme/tokens';
import { formatMoney } from '../../src/utils/money';
import { CURRENCIES } from '../../src/data/currencies';
import { CurrencyCode } from '../../src/types/finance';

export default function DebtDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, addDebtPayment } = useFinance();
  const debt = useMemo(
    () => state.debts.find((d) => d.id === id),
    [state.debts, id]
  );
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>(
    debt?.currency ?? state.settings.defaultCurrency
  );
  const [note, setNote] = useState('');

  if (!debt) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.content}>
          <H1>المديونية غير موجودة</H1>
          <Button label="رجوع" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  const remaining = Math.max(0, debt.amount - debt.paidAmount);

  const pay = () => {
    const value = Number(amount.replace(',', '.'));
    if (!value || value <= 0) {
      Alert.alert('تحقق من البيانات', 'أدخل مبلغ سداد صحيح');
      return;
    }
    addDebtPayment(debt.id, {
      amount: value,
      currency,
      date: new Date().toISOString(),
      note: note.trim() || undefined,
    });
    setAmount('');
    setNote('');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Button label="رجوع" variant="ghost" onPress={() => router.back()} />
        <H1>{debt.person}</H1>
        <Text style={styles.meta}>
          {debt.direction === 'owed_to_me' ? 'دين لك' : 'دين عليك'} ·{' '}
          {debt.status === 'paid'
            ? 'مسدد بالكامل'
            : debt.status === 'partial'
              ? 'مسدد جزئياً'
              : 'مفتوح'}
        </Text>

        <View style={styles.panel}>
          <Text style={styles.panelLabel}>المتبقي</Text>
          <Text style={styles.panelValue}>
            {formatMoney(remaining, debt.currency)}
          </Text>
          <Text style={styles.panelSub}>
            الإجمالي {formatMoney(debt.amount, debt.currency)} · المدفوع{' '}
            {formatMoney(debt.paidAmount, debt.currency)}
          </Text>
        </View>

        {debt.status !== 'paid' ? (
          <Section title="تسجيل سداد">
            <Field
              label="مبلغ السداد"
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
            />
            <View style={styles.chips}>
              {CURRENCIES.map((c) => (
                <Chip
                  key={c.code}
                  label={c.code}
                  active={currency === c.code}
                  onPress={() => setCurrency(c.code)}
                />
              ))}
            </View>
            <Field label="ملاحظة" value={note} onChangeText={setNote} />
            <Button label="تأكيد السداد" onPress={pay} />
          </Section>
        ) : null}

        <Section title="سجل السداد" subtitle={`${debt.payments.length} دفعة`}>
          <View style={styles.list}>
            {debt.payments.length === 0 ? (
              <Text style={styles.empty}>لا توجد دفعات بعد</Text>
            ) : (
              debt.payments.map((p) => (
                <RowItem
                  key={p.id}
                  title={formatMoney(p.amount, p.currency)}
                  subtitle={new Date(p.date).toLocaleDateString('ar-EG')}
                  mark="س"
                  markTone="gold"
                />
              ))
            )}
          </View>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.mist },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  meta: {
    fontFamily: 'IBMPlexSansArabic_400Regular',
    color: colors.muted,
    textAlign: 'right',
  },
  panel: {
    backgroundColor: colors.forest,
    borderRadius: radii.xl,
    padding: spacing.lg,
  },
  panelLabel: {
    fontFamily: 'IBMPlexSansArabic_400Regular',
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'right',
  },
  panelValue: {
    fontFamily: 'IBMPlexSansArabic_700Bold',
    color: colors.white,
    fontSize: 32,
    textAlign: 'right',
    marginVertical: 6,
  },
  panelSub: {
    fontFamily: 'IBMPlexSansArabic_400Regular',
    color: 'rgba(255,255,255,0.75)',
    textAlign: 'right',
  },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  list: { gap: spacing.sm },
  empty: {
    fontFamily: 'IBMPlexSansArabic_400Regular',
    color: colors.muted,
    textAlign: 'center',
  },
});
