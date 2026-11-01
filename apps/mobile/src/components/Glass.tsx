/** 玻璃材质组件 —— 逐值对应 apps/web/src/glass.css 的卡片配方：
 *  radial 高光 + linear 白渐变 + fill .43 + 白描边 + 内高光/暗沿 + 柔和投影。 */
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, shadow } from '../theme';

export function GlassCard({ children, style, radius = 23 }: { children?: React.ReactNode; style?: StyleProp<ViewStyle>; radius?: number }) {
  return (
    <View style={[{ borderRadius: radius, overflow: 'hidden' }, shadowCard(), style]}>
      <BlurView intensity={45} tint="light" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.glassFill }]} />
      <LinearGradient
        colors={['rgba(255, 255, 255, 0.30)', 'rgba(255, 255, 255, 0.02)', 'rgba(255, 255, 255, 0.14)']}
        start={{ x: 0.18, y: 0 }}
        end={{ x: 0.82, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: 1, borderColor: colors.glassStroke }]} pointerEvents="none" />
      <View style={{ position: 'absolute', top: 0, left: 1, right: 1, height: 1.5, backgroundColor: 'rgba(255,255,255,0.95)' }} pointerEvents="none" />
      <View style={{ padding: 14 }}>{children}</View>
    </View>
  );
}

function shadowCard(): StyleProp<ViewStyle> {
  return Platform.OS === 'ios'
    ? { shadowColor: '#385134', shadowOpacity: 0.09, shadowRadius: 12, shadowOffset: { width: 0, height: 8 } }
    : { elevation: 3 };
}

export function GlassPill({ children, onPress, style }: { children?: React.ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ borderRadius: 999, overflow: 'hidden' }, style, pressed && { opacity: 0.72 }]}>
      <BlurView intensity={45} tint="light" style={{ paddingHorizontal: 12, paddingVertical: 9 }}>
        <View style={{ borderWidth: 1, borderColor: colors.glassStroke, borderRadius: 999, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7 }}>
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
      style={({ pressed }) => [styles.primary, pressed && { opacity: 0.85 }, (disabled || loading) && { opacity: 0.45 }]}
    >
      <LinearGradient colors={[colors.primaryFrom, colors.primaryTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { borderRadius: 15, borderWidth: 1, borderColor: 'rgba(123, 149, 96, 0.3)' }]} pointerEvents="none" />
      <Text style={styles.primaryText}>{loading ? '…' : title}</Text>
    </Pressable>
  );
}

export function TextButton({ title, onPress, disabled }: { title: string; onPress?: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.text, pressed && { opacity: 0.6 }]}>
      <Text style={[styles.textText, { color: '#839079' }]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  primary: { borderRadius: 15, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, paddingHorizontal: 20, overflow: 'hidden' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  text: { alignItems: 'center', paddingVertical: 10 },
  textText: { fontSize: 15 },
});
