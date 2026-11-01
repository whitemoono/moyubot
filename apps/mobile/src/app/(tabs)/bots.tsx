import { Stack, router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BotAvatar } from '../../components/BotAvatar';
import { GlassCard } from '../../components/Glass';
import { useCollection } from '../../lib/data';
import { colors } from '../../theme';

interface Bot { id: string; name: string; avatar?: { shape?: string; from?: string; glyph?: string }; providerId?: string; model?: string }

/** 伙伴：greeting 卡 + Bot 卡片网格（对应 PWA 首页的伙伴卡）。 */
export default function Bots() {
  const bots = useCollection<Bot>('bots');

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.topBar}><Text style={styles.topTitle}>伙伴</Text></View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 70, paddingBottom: 130, gap: 12 }}>
        <GlassCard radius={23} style={{ gap: 4 }}>
          <Text style={styles.greetingTitle}>你的伙伴</Text>
          <Text style={styles.greetingNote}>{bots.length} 个 Bot · 点按查看资料、定时任务与记忆</Text>
        </GlassCard>
        <View style={styles.grid}>
          {bots.map((bot) => (
            <Pressable key={bot.id} style={({ pressed }) => [styles.botCard, pressed && { opacity: 0.8 }]} onPress={() => router.push(`/bot/${bot.id}`)}>
              <View style={styles.ava}><BotAvatar bot={bot} size={61} /></View>
              <Text numberOfLines={1} style={styles.name}>{bot.name}</Text>
              <Text numberOfLines={1} style={styles.model}>{bot.model || '—'}</Text>
            </Pressable>
          ))}
          {bots.length % 2 === 1 ? <View style={{ flex: 1 }} /> : null}
        </View>
        {bots.length ? null : <Text style={styles.note}>还没有同步到伙伴。</Text>}
        <Pressable style={({ pressed }) => [styles.createRow, pressed && { opacity: 0.8 }]} onPress={() => router.push('/create')}>
          <Text style={styles.createPlus}>＋</Text>
          <Text style={styles.createText}>创建新 Bot</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, paddingTop: 54, paddingHorizontal: 20, zIndex: 20 },
  topTitle: { fontSize: 24, fontWeight: '700', color: colors.ink },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  botCard: { flex: 1, minWidth: '47%', borderRadius: 23, padding: 14, gap: 6, alignItems: 'flex-start' },
  ava: { width: 61, height: 61 },
  name: { fontSize: 16, fontWeight: '600', color: colors.ink },
  model: { fontSize: 12, color: colors.muted },
  note: { fontSize: 13, color: colors.muted, textAlign: 'center', paddingVertical: 30 },
  createRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 23, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.9)', backgroundColor: 'rgba(255,255,255,0.43)', paddingVertical: 16 },
  createPlus: { fontSize: 20, color: colors.ink, fontWeight: '600' },
  createText: { fontSize: 15.5, fontWeight: '600', color: colors.ink },
  greetingTitle: { fontSize: 19, fontWeight: '700', color: colors.ink },
  greetingNote: { fontSize: 13, color: colors.muted },
});
