import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Link, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFinance } from '../../src/store/FinanceContext';
import {
  Body,
  BrandMark,
  Button,
  HeroPanel,
  RowItem,
  Section,
  Stat,
} from '../../src/components/ui';
import { colors, radii, spacing } from '../../src/theme/tokens';
import { formatMoney, monthLabelAr, monthKey } from '../../src/utils/money';
import { EXPENSE_CATEGORIES } from '../../src/data/currencies';
import { ACCOUNT_TYPES } from '../../src/data/currencies';

export default function HomeScreen() {
  const {
    state,
    totalBalanceIn,
    monthExpenseIn,
    monthIncomeIn,
    debtSummaryIn,
  } = useFinance();
  const currency = state.settings.defaultCurrency;
  const balance = totalBalanceIn(currency);
  const expense = monthExpenseIn(currency);
  const income = monthIncomeIn(currency);
  const debts = debtSummaryIn(currency);
  const net = income - expense;
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(18)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 520,
        useNativeDriver: true,
      }),
      Animated.timing(slide, {
        toValue: 0,
        duration: 520,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fade, slide]);

  const recent = state.expenses.slice(0, 4);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: fade, transform: [{ translateY: slide }] }}>
          <HeroPanel>
            <View style={styles.heroTop}>
              <View>
                <Text style={styles.hello}>مرحباً، {state.settings.displayName}</Text>
                <BrandMark size="lg" />
              </View>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{currency}</Text>
              </View>
            </View>

            <Text style={styles.balanceLabel}>إجمالي الرصيد</Text>
            <Text style={styles.balanceValue}>{formatMoney(balance, currency)}</Text>
            <Body style={styles.heroHint}>
              نظرة واحدة على أموالك عبر كل الحسابات والعملات
            </Body>

            <View style={styles.statsRow}>
              <Stat
                label={`دخل ${monthLabelAr(monthKey())}`}
                value={formatMoney(income, currency, { compact: true })}
                tone="good"
              />
              <Stat
                label="مصروفات الشهر"
                value={formatMoney(expense, currency, { compact: true })}
                tone="warn"
              />
            </View>
          </HeroPanel>
        </Animated.View>

        <View style={styles.quickRow}>
          <QuickAction label="مصروف" onPress={() => router.push('/expense/new')} />
          <QuickAction label="مرتب" onPress={() => router.push('/income/new')} />
          <QuickAction label="دين" onPress={() => router.push('/debt/new')} />
          <QuickAction label="حساب" onPress={() => router.push('/account/new')} />
        </View>

        <Section
          title="ملخص مالي"
          subtitle="صافي الشهر والمديونيات المتبقية"
        >
          <View style={styles.summaryGrid}>
            <SummaryTile
              title="صافي الشهر"
              value={formatMoney(net, currency)}
              tone={net >= 0 ? 'good' : 'warn'}
            />
            <SummaryTile
              title="لك عند الناس"
              value={formatMoney(debts.owedToMe, currency)}
              tone="good"
            />
            <SummaryTile
              title="عليك للناس"
              value={formatMoney(debts.iOwe, currency)}
              tone="warn"
            />
          </View>
        </Section>

        <Section
          title="الحسابات"
          subtitle="نقدي · بنك · محافظ متعددة العملات"
          action={
            <Link href="/account/new" asChild>
              <Pressable>
                <Text style={styles.link}>إضافة</Text>
              </Pressable>
            </Link>
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
                  markTone={acc.type === 'bank' ? 'sky' : 'sage'}
                />
              );
            })}
          </View>
        </Section>

        <Section
          title="آخر المصروفات"
          action={
            <Link href="/expenses" asChild>
              <Pressable>
                <Text style={styles.link}>الكل</Text>
              </Pressable>
            </Link>
          }
        >
          <View style={styles.list}>
            {recent.map((exp) => {
              const cat = EXPENSE_CATEGORIES.find((c) => c.id === exp.category);
              return (
                <RowItem
                  key={exp.id}
                  title={exp.title}
                  subtitle={cat?.label ?? exp.category}
                  trailing={formatMoney(-exp.amount, exp.currency)}
                  mark={cat?.mark ?? 'م'}
                  markTone="coral"
                />
              );
            })}
          </View>
          <Button
            label="تسجيل مصروف جديد"
            onPress={() => router.push('/expense/new')}
          />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function QuickAction({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.quick, pressed && { opacity: 0.85 }]}
    >
      <Text style={styles.quickText}>{label}</Text>
    </Pressable>
  );
}

function SummaryTile({
  title,
  value,
  tone,
}: {
  title: string;
  value: string;
  tone: 'good' | 'warn';
}) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileTitle}>{title}</Text>
      <Text
        style={[
          styles.tileValue,
          { color: tone === 'good' ? colors.teal : colors.coral },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.mist },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  heroTop: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  hello: {
    fontFamily: 'IBMPlexSansArabic_400Regular',
    color: 'rgba(255,255,255,0.78)',
    fontSize: 14,
    textAlign: 'right',
    marginBottom: 4,
  },
  badge: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  badgeText: {
    color: colors.goldSoft,
    fontFamily: 'IBMPlexSansArabic_600SemiBold',
    fontSize: 12,
  },
  balanceLabel: {
    fontFamily: 'IBMPlexSansArabic_400Regular',
    color: 'rgba(255,255,255,0.72)',
    fontSize: 13,
    textAlign: 'right',
  },
  balanceValue: {
    fontFamily: 'IBMPlexSansArabic_700Bold',
    color: colors.white,
    fontSize: 36,
    textAlign: 'right',
    marginTop: 4,
    marginBottom: 8,
  },
  heroHint: {
    color: 'rgba(255,255,255,0.78)',
    marginBottom: spacing.md,
  },
  statsRow: {
    flexDirection: 'row-reverse',
    gap: spacing.sm,
  },
  quickRow: {
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  quick: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 14,
    alignItems: 'center',
  },
  quickText: {
    fontFamily: 'IBMPlexSansArabic_600SemiBold',
    color: colors.forest,
    fontSize: 13,
  },
  summaryGrid: {
    gap: spacing.sm,
  },
  tile: {
    backgroundColor: colors.white,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
  },
  tileTitle: {
    fontFamily: 'IBMPlexSansArabic_400Regular',
    color: colors.muted,
    fontSize: 13,
    textAlign: 'right',
  },
  tileValue: {
    fontFamily: 'IBMPlexSansArabic_700Bold',
    fontSize: 20,
    textAlign: 'right',
    marginTop: 4,
  },
  list: { gap: spacing.sm },
  link: {
    fontFamily: 'IBMPlexSansArabic_600SemiBold',
    color: colors.teal,
    fontSize: 14,
  },
});
