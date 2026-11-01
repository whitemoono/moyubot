/** 彩色光斑渐变背景：液态玻璃的底（原型 body + 光斑）。 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

export function Backdrop() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient colors={['#e9eaf2', '#f3f3f6', '#ece9e2']} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={['rgba(10, 132, 255, 0.16)', 'rgba(10, 132, 255, 0)']} style={[styles.blob, { top: -60, right: -70, width: 260, height: 260 }]} />
      <LinearGradient colors={['rgba(242, 193, 78, 0.15)', 'rgba(242, 193, 78, 0)']} style={[styles.blob, { bottom: 60, left: -80, width: 300, height: 300 }]} />
      <LinearGradient colors={['rgba(52, 199, 89, 0.10)', 'rgba(52, 199, 89, 0)']} style={[styles.blob, { top: '45%', right: -90, width: 240, height: 240 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  blob: { position: 'absolute', borderRadius: 999 },
});
