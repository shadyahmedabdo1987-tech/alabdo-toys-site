import React, { useEffect } from 'react';
import { I18nManager, Platform, View, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  useFonts,
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
} from '@expo-google-fonts/ibm-plex-sans-arabic';
import * as SplashScreen from 'expo-splash-screen';
import { FinanceProvider } from '../src/store/FinanceContext';
import { colors } from '../src/theme/tokens';

SplashScreen.preventAutoHideAsync().catch(() => {});

if (!I18nManager.isRTL) {
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(true);
}

export default function RootLayout() {
  const [loaded] = useFonts({
    IBMPlexSansArabic_400Regular,
    IBMPlexSansArabic_500Medium,
    IBMPlexSansArabic_600SemiBold,
    IBMPlexSansArabic_700Bold,
  });

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => {});
  }, [loaded]);

  if (!loaded) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.forest,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator color={colors.gold} size="large" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <FinanceProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.mist },
            animation: Platform.OS === 'ios' ? 'default' : 'fade_from_bottom',
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="expense/new"
            options={{ presentation: 'modal', headerShown: false }}
          />
          <Stack.Screen
            name="income/new"
            options={{ presentation: 'modal', headerShown: false }}
          />
          <Stack.Screen
            name="debt/new"
            options={{ presentation: 'modal', headerShown: false }}
          />
          <Stack.Screen
            name="debt/[id]"
            options={{ presentation: 'card', headerShown: false }}
          />
          <Stack.Screen
            name="account/new"
            options={{ presentation: 'modal', headerShown: false }}
          />
        </Stack>
      </FinanceProvider>
    </GestureHandlerRootView>
  );
}
