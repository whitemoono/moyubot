import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BotAvatar } from '../../components/BotAvatar';
import { Backdrop } from '../../components/Backdrop';
import { GlassCard } from '../../components/Glass';
import { useCollection } from '../../lib/data';
import { colors } from '../../theme';

interface Bot { id: string; name: string; avatar?: { shape?: string; from?: string; glyph?: string }; providerId?: string; model?: string; systemPrompt?: string; approvalPolicy?: string; tools?: string[] }
interface Memory { id: string; botId?: string; text: string; pinned?: boolean }

export default function BotProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const bots = useCollection<Bot>('bots');
  const memories = useCollection<Memory>('memories');
  const bot = bots.find((b) => b.id === String(id));
  const botMemories = memories.filter((m) => !bot || m.botId === bot.id);

  if (!bot) {
    return (
      <View style={styles.screen}>
        <Backdrop />
        <Stack.Screen options={{ title: '' }} />
        <View style={styles.center}><Text style={styles.note}>没有找到这个 Bot</Text></View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Backdrop />
      <Stack.Screen options={{ title: '' }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 8, paddingBottom: 60 }}>
        <View style={styles.hero}>
          <View style={styles.heroAvatar}><BotAvatar bot={bot} size={100} /></View>
          <Text style={styles.heroName}>{bot.name}</Text>
        </View>

        <GlassCard radius={20} style={{ padding: 14, gap: 6 }}>
          <Text style={styles.label}>模型</Text>
          <Text style={styles.value}>{bot.providerId || '（未设置）'} · {bot.model || '（未设置）'}</Text>
          <Text style={styles.label}>权限</Text>
          <Text style={styles.value}>{bot.approvalPolicy === 'auto' ? '自动执行' : bot.approvalPolicy === 'ask' ? '每次确认' : bot.approvalPolicy ?? '—'}</Text>
          <Text style={styles.label}>记忆</Text>
          <Text style={styles.value}>{botMemories.length} 条</Text>
        </GlassCard>

        {bot.systemPrompt ? (
          <GlassCard radius={20} style={{ padding: 14, marginTop: 12 }}>
            <Text style={styles.label}>角色提示词</Text>
            <Text style={styles.prompt} numberOfLines={8}>{bot.systemPrompt}</Text>
          </GlassCard>
        ) : null}

        <View style={{ gap: 8, marginTop: 12 }}>
          <Pressable style={({ pressed }) => [styles.navRow, pressed && { backgroundColor: colors.rowPressed }]} onPress={() => router.push(`/tasks?botId=${bot.id}`)}>
            <Text style={styles.navIcon}>⏰</Text>
            <View style={{ flex: 1 }}><Text style={styles.navTitle}>定时任务</Text><Text style={styles.navNote}>同步自电脑端</Text></View>
            <Text style={styles.navChevron}>›</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [styles.navRow, pressed && { backgroundColor: colors.rowPressed }]} onPress={() => router.push(`/memories?botId=${bot.id}`)}>
            <Text style={styles.navIcon}>📚</Text>
            <View style={{ flex: 1 }}><Text style={styles.navTitle}>资料库</Text><Text style={styles.navNote}>{botMemories.length} 条长期记忆</Text></View>
            <Text style={styles.navChevron}>›</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [styles.navRow, pressed && { backgroundColor: colors.rowPressed }]} onPress={() => router.push('/computer')}>
            <Text style={styles.navIcon}>🖥️</Text>
            <View style={{ flex: 1 }}><Text style={styles.navTitle}>电脑</Text><Text style={styles.navNote}>经服务器操作已授权的云电脑</Text></View>
            <Text style={styles.navChevron}>›</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hero: { alignItems: 'center', marginVertical: 10 },
  heroAvatar: { width: 100, height: 100, borderRadius: 50, overflow: 'hidden' },
  heroName: { marginTop: 11, fontSize: 15, color: colors.name, fontWeight: '500' },
  label: { fontSize: 12, color: colors.groupHead, fontWeight: '600' },
  value: { fontSize: 15, color: colors.ink },
  prompt: { fontSize: 13.5, lineHeight: 20, color: colors.ink },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255, 255, 255, 0.72)', borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.65)', padding: 14 },
  navIcon: { fontSize: 20 },
  navTitle: { fontSize: 15.5, fontWeight: '600', color: colors.ink },
  navNote: { fontSize: 12.5, color: colors.gray, marginTop: 2 },
  navChevron: { fontSize: 22, color: colors.gray2 },
  note: { fontSize: 13, color: colors.gray },
});
