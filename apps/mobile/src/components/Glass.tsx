/** 液态玻璃基础组件：expo-blur + 白渐变 + 内高光描边，对应原型 .glass 材质。 */
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, glass, shadow } from '../theme';

export function GlassCard({ children, style, radius = 24 }: { children?: React.ReactNode; style?: StyleProp<ViewStyle>; radius?: number }) {
  return (
    <View style={[{ borderRadius: radius, overflow: 'hidden' as const }, shadowCard(), style]}>
      <BlurView intensity={glass.blurIntensity} tint="light" style={StyleSheet.absoluteFill} />
      <LinearGradient colors={[...glass.gradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: 1, borderColor: glass.border }]} pointerEvents="none" />
      <View style={{ borderRadius: radius }}>{children}</View>
    </View>
  );
}

function shadowCard(): StyleProp<ViewStyle> {
  return Platform.OS === 'ios'
    ? { shadowColor: '#2d3255', shadowOpacity: 0.25, shadowRadius: 15, shadowOffset: { width: 0, height: 12 } }
    : { elevation: 4 };
}

export function GlassPill({ children, onPress, style }: { children?: React.ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ borderRadius: 999, overflow: 'hidden' }, style, pressed && { opacity: 0.75 }]}>
      <BlurView intensity={glass.blurIntensity} tint="light" style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
        <LinearGradient colors={[...glass.gradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: glass.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 - 8, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {children}
        </View>
      </BlurView>
    </Pressable>
  );
}

export function PrimaryButton({ title, onPress, disabled, loading }: { title: string; onPress?: () => void; disabled?: boolean; loading?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [styles.primary, pressed && { opacity: 0.8 }, (disabled || loading) && { opacity: 0.45 }]}
    >
      <Text style={styles.primaryText}>{loading ? '…' : title}</Text>
    </Pressable>
  );
}

export function TextButton({ title, onPress, disabled }: { title: string; onPress?: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.text, pressed && { opacity: 0.6 }]}>
      <Text style={styles.textText}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  primary: { backgroundColor: colors.ink, borderRadius: 16, alignItems: 'center', justifyContent: 'center', paddingVertical: 15, paddingHorizontal: 20 },
  primaryText: { color: '#fff', fontSize: 16.5, fontWeight: '600' },
  text: { alignItems: 'center', paddingVertical: 10 },
  textText: { color: colors.gray, fontSize: 15 },
});
