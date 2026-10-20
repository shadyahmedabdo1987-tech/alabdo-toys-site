import React, { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFinance } from '../../src/store/FinanceContext';
import { Button, Chip, Field, H1 } from '../../src/components/ui';
import { colors, spacing } from '../../src/theme/tokens';
import { CURRENCIES, EXPENSE_CATEGORIES } from '../../src/data/currencies';
import { CurrencyCode, ExpenseCategory } from '../../src/types/finance';

export default function NewExpenseScreen() {
  const { state, addExpense } = useFinance();
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('food');
  const [currency, setCurrency] = useState<CurrencyCode>(
    state.settings.defaultCurrency
  );
  const [accountId, setAccountId] = useState(state.accounts[0]?.id ?? '');
  const [note, setNote] = useState('');

  const accounts = useMemo(() => state.accounts, [state.accounts]);

  const submit = () => {
    const value = Number(amount.replace(',', '.'));
    if (!title.trim() || !value || value <= 0 || !accountId) {
      Alert.alert('تحقق من البيانات', 'أدخل عنواناً ومبلغاً صحيحاً واختر حساباً');
      return;
    }
    addExpense({
      title: title.trim(),
      amount: value,
      currency,
      category,
      accountId,
      note: note.trim() || undefined,
      date: new Date().toISOString(),
    });
    router.back();
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content}>
          <H1>مصروف جديد</H1>
          <Text style={styles.sub}>سجّل العملية بوضوح — التصنيف والعملة والحساب</Text>

          <Field label="العنوان" value={title} onChangeText={setTitle} placeholder="مثال: بقالة" />
          <Field
            label="المبلغ"
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="0.00"
          />

          <Text style={styles.label}>التصنيف</Text>
          <View style={styles.chips}>
            {EXPENSE_CATEGORIES.map((c) => (
              <Chip
                key={c.id}
                label={c.label}
                active={category === c.id}
                onPress={() => setCategory(c.id)}
              />
            ))}
          </View>

          <Text style={styles.label}>العملة</Text>
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

          <Text style={styles.label}>من حساب</Text>
          <View style={styles.chips}>
            {accounts.map((a) => (
              <Chip
                key={a.id}
                label={a.name}
                active={accountId === a.id}
                onPress={() => setAccountId(a.id)}
              />
            ))}
          </View>

          <Field
            label="ملاحظة (اختياري)"
            value={note}
            onChangeText={setNote}
            placeholder="تفاصيل إضافية"
          />

          <View style={styles.actions}>
            <Button label="حفظ المصروف" onPress={submit} />
            <Button label="إلغاء" variant="ghost" onPress={() => router.back()} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.mist },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  sub: {
    fontFamily: 'IBMPlexSansArabic_400Regular',
    color: colors.muted,
    textAlign: 'right',
  },
  label: {
    fontFamily: 'IBMPlexSansArabic_500Medium',
    color: colors.muted,
    textAlign: 'right',
    fontSize: 13,
  },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
});
