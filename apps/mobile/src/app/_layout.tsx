import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { initData } from '../lib/data';

export default function Layout() {
  useEffect(() => { void initData(); }, []);
  return (
    <SafeAreaProvider>
      <Stack
        screenOptions={{
          headerShadowVisible: false,
          headerTitleStyle: { fontWeight: '600' },
          headerStyle: { backgroundColor: '#f6f7f9' },
          headerTintColor: '#111',
          contentStyle: { backgroundColor: '#f6f7f9' },
        }}
      />
    </SafeAreaProvider>
  );
}
