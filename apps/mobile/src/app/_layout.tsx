import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { initData } from '../lib/data';

export default function Layout() {
  useEffect(() => { void initData(); }, []);
  return <Stack screenOptions={{ headerShadowVisible: false, headerTitleStyle: { fontWeight: '600' } }} />;
}
