import { Tabs } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../theme';

const TABS = [
  { name: 'index', label: '对话', icon: '💬' },
  { name: 'bots', label: '伙伴', icon: '🤖' },
  { name: 'work', label: '工作台', icon: '🧰' },
  { name: 'me', label: '我的', icon: '👤' },
];

/** PWA .bottom-nav：悬浮玻璃胶囊导航（radius 36，fill .24，blur 26，选中浅绿渐变）。 */
function GlassNav(props: { state: { index: number; routes: { name: string }[] }; navigation: { navigate: (name: string) => void } }) {
  const { state, navigation } = props as { state: { index: number; routes: { name: string }[] }; navigation: { navigate: (name: string) => void } };
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + 13 }]}>
      <View style={styles.shell}>
        <BlurView intensity={50} tint="light" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255, 255, 255, 0.24)' }]} />
        <View style={[StyleSheet.absoluteFill, { borderRadius: 36, borderWidth: 0.5, borderColor: 'rgba(134, 145, 125, 0.21)' }]} pointerEvents="none" />
        <View style={styles.row}>
          {TABS.map((tab) => {
            const active = state.routes[state.index]?.name === tab.name;
            return (
              <Pressable key={tab.name} style={styles.item} onPress={() => navigation.navigate(tab.name)}>
                {active ? <LinearGradient colors={['rgba(245, 249, 237, 0.67)', 'rgba(211, 225, 196, 0.49)']} style={StyleSheet.absoluteFill} /> : null}
                <Text style={styles.icon}>{tab.icon}</Text>
                <Text style={[styles.label, active && styles.labelActive]}>{tab.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false, tabBarShowLabel: false }}
      tabBar={(props: any) => <GlassNav {...props} />}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="bots" />
      <Tabs.Screen name="work" />
      <Tabs.Screen name="me" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 15, right: 15 },
  shell: { height: 66, borderRadius: 36, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', height: 66, paddingHorizontal: 6 },
  item: { flex: 1, height: 56, borderRadius: 27, alignItems: 'center', justifyContent: 'center', gap: 2, overflow: 'hidden' },
  icon: { fontSize: 17 },
  label: { fontSize: 10, color: '#7c8775' },
  labelActive: { color: '#41573a', fontWeight: '600' },
});
