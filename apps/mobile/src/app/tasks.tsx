import { Stack, useLocalSearchParams } from 'expo-router';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Backdrop } from '../components/Backdrop';
import { useCollection, useSyncVersion } from '../lib/data';
import { colors } from '../theme';

interface Schedule { id: string; botId?: string; title: string; prompt?: string; cron?: string; runAt?: string; enabled?: boolean; nextRunAt?: number; lastStatus?: string }

export default function Tasks() {
  const { botId } = useLocalSearchParams<{ botId?: string }>();
  useSyncVersion();
  const schedules = useCollection<Schedule>('schedules')
    .filter((s) => !botId || s.botId === botId)
    .sort((a, b) => (b.nextRunAt ?? 0) - (a.nextRunAt ?? 0));

  return (
    <View style={styles.screen}>
      <Backdrop />
      <Stack.Screen options={{ title: '定时任务' }} />
      <SafeAreaView edges={['left', 'right']} style={{ flex: 1 }}>
        <FlatList
          data={schedules}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 8 }}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.rowTop}>
                <Text numberOfLines={1} style={styles.title}>{item.title}</Text>
                <View style={[styles.badge, { backgroundColor: item.enabled ? 'rgba(52, 199, 89, 0.18)' : 'rgba(120,120,128,0.14)' }]}>
                  <Text style={[styles.badgeText, { color: item.enabled ? '#1f8f43' : colors.gray }]}>{item.enabled ? '启用' : '停用'}</Text>
                </View>
              </View>
              {item.cron ? <Text style={styles.meta}>cron：{item.cron}</Text> : null}
              {item.runAt ? <Text style={styles.meta}>单次：{new Date(item.runAt).toLocaleString('zh-CN')}</Text> : null}
              {item.nextRunAt ? <Text style={styles.meta}>下次：{new Date(item.nextRunAt).toLocaleString('zh-CN')}</Text> : null}
              {item.lastStatus ? <Text style={styles.meta}>上次：{item.lastStatus}</Text> : null}
            </View>
          )}
          ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>还没有同步到定时任务。</Text></View>}
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  card: { backgroundColor: 'rgba(255, 255, 255, 0.78)', borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.65)', padding: 14, gap: 4 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { flex: 1, fontSize: 15.5, fontWeight: '600', color: colors.ink },
  badge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  meta: { fontSize: 12.5, color: colors.gray },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyText: { fontSize: 13, color: colors.gray },
});
