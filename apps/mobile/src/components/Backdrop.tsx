/** PWA .phone-screen 背景：#f8faf6 底 + 三团鼠尾草绿/奶油径向光斑（react-native-svg 径向渐变）。 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

export function Backdrop() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="b1" cx="94%" cy="23%" rx="45%" ry="45%">
            <Stop offset="0" stopColor="#dce8cb" stopOpacity="0.73" />
            <Stop offset="1" stopColor="#dce8cb" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="b2" cx="2%" cy="65%" rx="38%" ry="38%">
            <Stop offset="0" stopColor="#f2dfce" stopOpacity="0.44" />
            <Stop offset="1" stopColor="#f2dfce" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="b3" cx="87%" cy="96%" rx="42%" ry="42%">
            <Stop offset="0" stopColor="#dae5dc" stopOpacity="0.61" />
            <Stop offset="1" stopColor="#dae5dc" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="#f8faf6" />
        <Rect width="100%" height="100%" fill="url(#b1)" />
        <Rect width="100%" height="100%" fill="url(#b2)" />
        <Rect width="100%" height="100%" fill="url(#b3)" />
      </Svg>
    </View>
  );
}
