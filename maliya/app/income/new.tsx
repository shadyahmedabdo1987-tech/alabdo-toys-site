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
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFinance } from '../../src/store/FinanceContext';
import { Button, Chip, Field, H1 } from '../../src/components/ui';
import { colors, spacing } from '../../src/theme/tokens';
import { CURRENCIES } from '../../src/data/currencies';
import { CurrencyCode } from '../../src/types/finance';
import { monthKey } from '../../src/utils/money';

export default function NewIncomeScreen() {
  const { salary } = useLocalSearchParams<{ salary?: string }>();
  const isSalaryDefault = salary === '1';
  const { state, addIncome } = useFinance();
  const [title, setTitle] = useState(isSalaryDefault ? 'المرتب الشهري' : '');
  const [amount, setAmount] = useState('');
  const [isSalary, setIsSalary] = useState(isSalaryDefault);
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
    addIncome({
      title: title.trim(),
      amount: value,
      currency,
      accountId,
      isSalary,
      monthKey: monthKey(),
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
          <H1>{isSalary ? 'إدخال المرتب' : 'دخل جديد'}</H1>
          <Text style={styles.sub}>يُضاف المبلغ مباشرة إلى الحساب المختار</Text>

          <Field label="العنوان" value={title} onChangeText={setTitle} />
          <Field
            label="المبلغ"
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="0.00"
          />

          <Text style={styles.label}>النوع</Text>
          <View style={styles.chips}>
            <Chip label="مرتب شهري" active={isSalary} onPress={() => setIsSalary(true)} />
            <Chip
              label="دخل آخر"
              active={!isSalary}
              onPress={() => setIsSalary(false)}
            />
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

          <Text style={styles.label}>إلى حساب</Text>
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

          <Field label="ملاحظة" value={note} onChangeText={setNote} />

          <View style={styles.actions}>
            <Button label="حفظ الدخل" onPress={submit} />
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
