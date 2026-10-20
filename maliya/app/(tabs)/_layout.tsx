import React from 'react';
import { Tabs } from 'expo-router';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../src/theme/tokens';

function TabIcon({
  label,
  focused,
}: {
  label: string;
  focused: boolean;
}) {
  return (
    <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
      <Text style={[styles.iconText, focused && styles.iconTextActive]}>
        {label}
      </Text>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: colors.forest,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: styles.tabLabel,
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'الرئيسية',
          tabBarIcon: ({ focused }) => (
            <TabIcon label="ر" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="expenses"
        options={{
          title: 'المصروفات',
          tabBarIcon: ({ focused }) => (
            <TabIcon label="م" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="debts"
        options={{
          title: 'المديونيات',
          tabBarIcon: ({ focused }) => (
            <TabIcon label="د" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="income"
        options={{
          title: 'الدخل',
          tabBarIcon: ({ focused }) => (
            <TabIcon label="خ" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'المزيد',
          tabBarIcon: ({ focused }) => (
            <TabIcon label="⋯" focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.paper,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    height: Platform.OS === 'ios' ? 88 : 72,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 24 : 10,
  },
  tabLabel: {
    fontFamily: 'IBMPlexSansArabic_500Medium',
    fontSize: 11,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  iconWrapActive: {
    backgroundColor: colors.sage,
  },
  iconText: {
    fontFamily: 'IBMPlexSansArabic_700Bold',
    fontSize: 13,
    color: colors.muted,
  },
  iconTextActive: {
    color: colors.forest,
  },
});
