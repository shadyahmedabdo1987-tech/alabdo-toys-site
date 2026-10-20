import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
  TextStyle,
  TextInputProps,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radii, shadows, spacing } from '../theme/tokens';

export function Screen({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

export function BrandMark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const fontSize = size === 'lg' ? 42 : size === 'sm' ? 22 : 30;
  return (
    <Text
      style={[
        styles.brand,
        {
          fontSize,
          lineHeight: fontSize * 1.15,
        },
      ]}
    >
      رصيد
    </Text>
  );
}

export function H1({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: TextStyle;
}) {
  return <Text style={[styles.h1, style]}>{children}</Text>;
}

export function H2({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: TextStyle;
}) {
  return <Text style={[styles.h2, style]}>{children}</Text>;
}

export function Body({
  children,
  style,
  muted,
}: {
  children: React.ReactNode;
  style?: TextStyle;
  muted?: boolean;
}) {
  return (
    <Text style={[styles.body, muted && styles.muted, style]}>{children}</Text>
  );
}

export function HeroPanel({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <LinearGradient
      colors={['#0F3D38', '#1A6B5C', '#2A8F78']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.hero, style]}
    >
      <View style={styles.heroGlow} />
      {children}
    </LinearGradient>
  );
}

export function Section({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <View style={{ flex: 1 }}>
          <H2>{title}</H2>
          {subtitle ? <Body muted>{subtitle}</Body> : null}
        </View>
        {action}
      </View>
      {children}
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        variant === 'primary' && styles.btnPrimary,
        variant === 'secondary' && styles.btnSecondary,
        variant === 'ghost' && styles.btnGhost,
        variant === 'danger' && styles.btnDanger,
        pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] },
        disabled && { opacity: 0.45 },
      ]}
    >
      <Text
        style={[
          styles.btnText,
          (variant === 'secondary' || variant === 'ghost') && {
            color: colors.forest,
          },
          variant === 'danger' && { color: colors.white },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Field({
  label,
  ...props
}: { label: string } & TextInputProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        style={styles.input}
        {...props}
      />
    </View>
  );
}

export function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function RowItem({
  title,
  subtitle,
  trailing,
  mark,
  markTone = 'sage',
  onPress,
}: {
  title: string;
  subtitle?: string;
  trailing?: string;
  mark?: string;
  markTone?: 'sage' | 'gold' | 'coral' | 'sky';
  onPress?: () => void;
}) {
  const tone =
    markTone === 'gold'
      ? colors.goldSoft
      : markTone === 'coral'
        ? colors.coralSoft
        : markTone === 'sky'
          ? colors.skySoft
          : colors.sage;
  const markColor =
    markTone === 'gold'
      ? colors.gold
      : markTone === 'coral'
        ? colors.coral
        : markTone === 'sky'
          ? colors.sky
          : colors.teal;

  const content = (
    <>
      {mark ? (
        <View style={[styles.mark, { backgroundColor: tone }]}>
          <Text style={[styles.markText, { color: markColor }]}>{mark}</Text>
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle ? <Text style={styles.rowSub}>{subtitle}</Text> : null}
      </View>
      {trailing ? <Text style={styles.rowTrail}>{trailing}</Text> : null}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
      >
        {content}
      </Pressable>
    );
  }
  return <View style={styles.row}>{content}</View>;
}

export function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'good' | 'warn';
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text
        style={[
          styles.statValue,
          tone === 'good' && { color: colors.mint },
          tone === 'warn' && { color: colors.coral },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.mist,
  },
  brand: {
    color: colors.white,
    fontFamily: 'IBMPlexSansArabic_700Bold',
    letterSpacing: 0.5,
    textAlign: 'right',
  },
  h1: {
    fontFamily: 'IBMPlexSansArabic_700Bold',
    fontSize: 28,
    color: colors.ink,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  h2: {
    fontFamily: 'IBMPlexSansArabic_600SemiBold',
    fontSize: 20,
    color: colors.ink,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  body: {
    fontFamily: 'IBMPlexSansArabic_400Regular',
    fontSize: 15,
    color: colors.ink,
    lineHeight: 24,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  muted: {
    color: colors.muted,
  },
  hero: {
    borderRadius: radii.xl,
    padding: spacing.lg,
    overflow: 'hidden',
    ...shadows.soft,
  },
  heroGlow: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(196,163,90,0.18)',
    top: -40,
    left: -30,
  },
  section: {
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  sectionHead: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  btn: {
    minHeight: 48,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: {
    backgroundColor: colors.forest,
  },
  btnSecondary: {
    backgroundColor: colors.sage,
  },
  btnGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.line,
  },
  btnDanger: {
    backgroundColor: colors.coral,
  },
  btnText: {
    fontFamily: 'IBMPlexSansArabic_600SemiBold',
    fontSize: 16,
    color: colors.white,
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    fontFamily: 'IBMPlexSansArabic_500Medium',
    fontSize: 13,
    color: colors.muted,
    textAlign: 'right',
  },
  input: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    minHeight: 50,
    paddingHorizontal: spacing.md,
    fontFamily: 'IBMPlexSansArabic_400Regular',
    fontSize: 16,
    color: colors.ink,
    textAlign: 'right',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.sm,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipActive: {
    backgroundColor: colors.forest,
    borderColor: colors.forest,
  },
  chipText: {
    fontFamily: 'IBMPlexSansArabic_500Medium',
    fontSize: 13,
    color: colors.forest,
  },
  chipTextActive: {
    color: colors.white,
  },
  row: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.white,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
  },
  mark: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markText: {
    fontFamily: 'IBMPlexSansArabic_700Bold',
    fontSize: 16,
  },
  rowTitle: {
    fontFamily: 'IBMPlexSansArabic_600SemiBold',
    fontSize: 15,
    color: colors.ink,
    textAlign: 'right',
  },
  rowSub: {
    fontFamily: 'IBMPlexSansArabic_400Regular',
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
    textAlign: 'right',
  },
  rowTrail: {
    fontFamily: 'IBMPlexSansArabic_600SemiBold',
    fontSize: 14,
    color: colors.forest,
  },
  stat: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: radii.md,
    padding: spacing.md,
    gap: 4,
  },
  statLabel: {
    fontFamily: 'IBMPlexSansArabic_400Regular',
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
    textAlign: 'right',
  },
  statValue: {
    fontFamily: 'IBMPlexSansArabic_700Bold',
    fontSize: 16,
    color: colors.white,
    textAlign: 'right',
  },
});
