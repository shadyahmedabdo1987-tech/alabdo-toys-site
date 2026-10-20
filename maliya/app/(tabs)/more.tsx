import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFinance } from '../../src/store/FinanceContext';
import {
  Button,
  Chip,
  Field,
  H1,
  H2,
  RowItem,
  Section,
} from '../../src/components/ui';
import { colors, spacing } from '../../src/theme/tokens';
import { CURRENCIES, ACCOUNT_TYPES } from '../../src/data/currencies';
import { formatMoney } from '../../src/utils/money';
import { CurrencyCode } from '../../src/types/finance';

export default function MoreScreen() {
  const { state, updateSettings, resetDemo } = useFinance();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <H1>المزيد</H1>
        <Text style={styles.lead}>
          إعدادات العملة والحسابات — مصمّمة لتجربة مالية احترافية متعددة العملات
        </Text>

        <Section title="عملة العرض الافتراضية">
          <View style={styles.chips}>
            {CURRENCIES.map((c) => (
              <Chip
                key={c.code}
                label={`${c.code}`}
                active={state.settings.defaultCurrency === c.code}
                onPress={() =>
                  updateSettings({ defaultCurrency: c.code as CurrencyCode })
                }
              />
            ))}
          </View>
        </Section>

        <Section title="الاسم الظاهر">
          <Field
            label="الاسم"
            value={state.settings.displayName}
            onChangeText={(displayName) => updateSettings({ displayName })}
          />
        </Section>

        <Section
          title="الحسابات"
          subtitle="إدارة النقد والبنوك والمحافظ"
          action={
            <Text style={styles.link} onPress={() => router.push('/account/new')}>
              إضافة
            </Text>
          }
        >
          <View style={styles.list}>
            {state.accounts.map((acc) => {
              const typeLabel =
                ACCOUNT_TYPES.find((t) => t.id === acc.type)?.label ?? acc.type;
              return (
                <RowItem
                  key={acc.id}
                  title={acc.name}
                  subtitle={`${typeLabel} · ${acc.currency}`}
                  trailing={formatMoney(acc.balance, acc.currency)}
                  mark={acc.name.slice(0, 1)}
                />
              );
            })}
          </View>
        </Section>

        <Section title="أسعار تحويل تقريبية" subtitle="مقابل الجنيه المصري">
          <View style={styles.rates}>
            {CURRENCIES.filter((c) => c.code !== 'EGP')
              .slice(0, 8)
              .map((c) => (
                <View key={c.code} style={styles.rateRow}>
                  <Text style={styles.rateCode}>{c.code}</Text>
                  <Text style={styles.rateVal}>
                    {state.settings.ratesToEGP[c.code].toFixed(2)} ج.م
                  </Text>
                </View>
              ))}
          </View>
        </Section>

        <Section title="عن رصيد">
          <H2>إدارة مالية عالمية</H2>
          <Text style={styles.about}>
            رصيد يجمع المصروفات، المرتب، الحسابات، والمديونيات في واجهة عربية
            احترافية مع دعم عملات متعددة — جاهز للبناء كتطبيق Android و iOS عبر Expo.
          </Text>
          <Button label="إعادة بيانات العرض التجريبية" variant="ghost" onPress={resetDemo} />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.mist },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  lead: {
    fontFamily: 'IBMPlexSansArabic_400Regular',
    color: colors.muted,
    textAlign: 'right',
    lineHeight: 22,
  },
  chips: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 8,
  },
  list: { gap: spacing.sm },
  link: {
    fontFamily: 'IBMPlexSansArabic_600SemiBold',
    color: colors.teal,
  },
  rates: {
    backgroundColor: colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    gap: 10,
  },
  rateRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
  },
  rateCode: {
    fontFamily: 'IBMPlexSansArabic_600SemiBold',
    color: colors.ink,
  },
  rateVal: {
    fontFamily: 'IBMPlexSansArabic_400Regular',
    color: colors.muted,
  },
  about: {
    fontFamily: 'IBMPlexSansArabic_400Regular',
    color: colors.muted,
    textAlign: 'right',
    lineHeight: 24,
  },
});
