import React, { useState } from 'react';
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
import { CURRENCIES } from '../../src/data/currencies';
import { CurrencyCode, DebtDirection } from '../../src/types/finance';

export default function NewDebtScreen() {
  const { state, addDebt } = useFinance();
  const [person, setPerson] = useState('');
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<DebtDirection>('owed_to_me');
  const [currency, setCurrency] = useState<CurrencyCode>(
    state.settings.defaultCurrency
  );
  const [note, setNote] = useState('');

  const submit = () => {
    const value = Number(amount.replace(',', '.'));
    if (!person.trim() || !value || value <= 0) {
      Alert.alert('تحقق من البيانات', 'أدخل اسم الشخص ومبلغاً صحيحاً');
      return;
    }
    addDebt({
      person: person.trim(),
      amount: value,
      currency,
      direction,
      note: note.trim() || undefined,
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
          <H1>مديونية جديدة</H1>
          <Text style={styles.sub}>تتبّع ما لك وما عليك بوضوح</Text>

          <Field
            label="الشخص / الجهة"
            value={person}
            onChangeText={setPerson}
            placeholder="اسم الشخص أو المحل"
          />
          <Field
            label="المبلغ"
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
          />

          <Text style={styles.label}>الاتجاه</Text>
          <View style={styles.chips}>
            <Chip
              label="لي عندهم"
              active={direction === 'owed_to_me'}
              onPress={() => setDirection('owed_to_me')}
            />
            <Chip
              label="عليّ لهم"
              active={direction === 'i_owe'}
              onPress={() => setDirection('i_owe')}
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

          <Field label="ملاحظة" value={note} onChangeText={setNote} />

          <View style={styles.actions}>
            <Button label="حفظ المديونية" onPress={submit} />
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
