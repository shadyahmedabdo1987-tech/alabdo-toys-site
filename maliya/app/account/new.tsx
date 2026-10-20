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
import { ACCOUNT_TYPES, CURRENCIES } from '../../src/data/currencies';
import { AccountType, CurrencyCode } from '../../src/types/finance';

export default function NewAccountScreen() {
  const { state, addAccount } = useFinance();
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('cash');
  const [currency, setCurrency] = useState<CurrencyCode>(
    state.settings.defaultCurrency
  );
  const [balance, setBalance] = useState('0');

  const submit = () => {
    const value = Number(balance.replace(',', '.'));
    if (!name.trim() || Number.isNaN(value)) {
      Alert.alert('تحقق من البيانات', 'أدخل اسم الحساب ورصيداً ابتدائياً');
      return;
    }
    addAccount({
      name: name.trim(),
      type,
      currency,
      balance: value,
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
          <H1>حساب جديد</H1>
          <Text style={styles.sub}>نقدي، بنك، محفظة، أو ادخار — بأي عملة</Text>

          <Field label="اسم الحساب" value={name} onChangeText={setName} />
          <Field
            label="الرصيد الابتدائي"
            value={balance}
            onChangeText={setBalance}
            keyboardType="decimal-pad"
          />

          <Text style={styles.label}>النوع</Text>
          <View style={styles.chips}>
            {ACCOUNT_TYPES.map((t) => (
              <Chip
                key={t.id}
                label={t.label}
                active={type === t.id}
                onPress={() => setType(t.id)}
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

          <View style={styles.actions}>
            <Button label="حفظ الحساب" onPress={submit} />
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
