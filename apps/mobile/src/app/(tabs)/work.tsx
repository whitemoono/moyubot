import { Stack, router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GlassCard } from '../../components/Glass';
import { useCollection, useSyncStatus, useSyncVersion } from '../../lib/data';
import { colors } from '../../theme';

interface Schedule { id: string; enabled?: boolean; nextRunAt?: number }

/** 工作台：定时任务 / 电脑 / 同步状态（对应 PWA 工作台 tab）。 */
export default function Work() {
  useSyncVersion();
  const schedules = useCollection<Schedule>('schedules');
  const status = useSyncStatus();
  const nextRun = schedules.filter((s) => s.enabled && s.nextRunAt).sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))[0];

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.topBar}><Text style={styles.topTitle}>工作台</Text></View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 70, paddingBottom: 130, gap: 12 }}>
        <GlassCard radius={23} style={{ gap: 6 }}>
          <Text style={styles.greetingTitle}>同步</Text>
          <Text style={styles.meta}>{status.connected ? (status.enabled ? '实时同步开启中' : '已连接，同步暂停') : '未连接电脑'} · 待上传 {status.pending} · 冲突 {status.conflicts}</Text>
          {status.error ? <Text style={styles.error}>{status.error}</Text> : null}
        </GlassCard>

        <Pressable style={({ pressed }) => [styles.entry, pressed && { opacity: 0.8 }]} onPress={() => router.push('/tasks')}>
          <Text style={styles.entryIcon}>⏰</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.entryTitle}>定时任务</Text>
            <Text style={styles.entryNote}>{nextRun ? `最近：${new Date(nextRun.nextRunAt!).toLocaleString('zh-CN')}` : `${schedules.length} 个任务`}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>

        <Pressable style={({ pressed }) => [styles.entry, pressed && { opacity: 0.8 }]} onPress={() => router.push('/computer')}>
          <Text style={styles.entryIcon}>🖥️</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.entryTitle}>电脑</Text>
            <Text style={styles.entryNote}>经服务器执行命令与读写文件</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, paddingTop: 54, paddingHorizontal: 20, zIndex: 20 },
  topTitle: { fontSize: 24, fontWeight: '700', color: colors.ink },
  greetingTitle: { fontSize: 19, fontWeight: '700', color: colors.ink },
  meta: { fontSize: 13, color: colors.muted },
  error: { fontSize: 12.5, color: '#dc2626' },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 23, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.9)', backgroundColor: 'rgba(255,255,255,0.43)', padding: 16 },
  entryIcon: { fontSize: 22 },
  entryTitle: { fontSize: 15.5, fontWeight: '600', color: colors.ink },
  entryNote: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  chevron: { fontSize: 22, color: colors.muted },
});
