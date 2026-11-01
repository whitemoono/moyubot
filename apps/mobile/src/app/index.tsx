import { Stack, router } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BotAvatar } from '../components/BotAvatar';
import { GlassPill } from '../components/Glass';
import { getClient, useCollection, useSyncStatus } from '../lib/data';
import { colors } from '../theme';

interface Bot { id: string; name: string; avatar?: { shape?: string; from?: string; glyph?: string } }
interface Conversation { id: string; botId?: string; title?: string; group?: { memberBotIds?: string[] }; updatedAt?: number; deletedAt?: number }

export default function Home() {
  const bots = useCollection<Bot>('bots');
  const conversations = useCollection<Conversation>('conversations');
  const status = useSyncStatus();

  const rows = useMemo(() => conversations
    .filter((c) => !c.deletedAt)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)), [conversations]);

  const hero = useMemo(() => {
    for (const c of rows) {
      const bot = bots.find((b) => b.id === c.botId);
      if (bot) return { bot, conversation: c };
    }
    return null;
  }, [rows, bots]);

  const titleFor = (conversation: Conversation): { name: string; bot?: Bot; isGroup: boolean } => {
    if (conversation.group) return { name: conversation.title || '群聊', isGroup: true };
    const bot = bots.find((item) => item.id === conversation.botId);
    return { name: bot?.name ?? conversation.title ?? '对话', bot, isGroup: false };
  };

  return (
    <View style={styles.screen}>
      {/* 彩色光斑背景：液态玻璃的底色 */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <LinearGradient colors={['#e9eaf2', '#f3f3f6', '#ece9e2']} style={StyleSheet.absoluteFill} />
        <LinearGradient colors={['rgba(10, 132, 255, 0.16)', 'rgba(10, 132, 255, 0)']} style={[styles.blob, { top: -60, right: -70, width: 260, height: 260 }]} />
        <LinearGradient colors={['rgba(242, 193, 78, 0.15)', 'rgba(242, 193, 78, 0)']} style={[styles.blob, { bottom: 60, left: -80, width: 300, height: 300 }]} />
        <LinearGradient colors={['rgba(52, 199, 89, 0.10)', 'rgba(52, 199, 89, 0)']} style={[styles.blob, { top: '45%', right: -90, width: 240, height: 240 }]} />
      </View>

      <Stack.Screen options={{ headerShown: false }} />

      {/* 原型 .home-top：我的头像 + 创建/状态胶囊，浮在滚动内容上 */}
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.topBar}>
        <View style={styles.meAva}><Text style={styles.meAvaText}>鱼</Text></View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <GlassPill onPress={() => router.push('/create')}>
            <Text style={styles.statusText}>＋</Text>
          </GlassPill>
          <GlassPill onPress={() => router.push('/pair')}>
            <View style={[styles.dot, { backgroundColor: status.connected ? (status.enabled ? colors.green : colors.gray2) : '#c60' }]} />
            <Text style={styles.statusText}>{status.connected ? (status.enabled ? '同步中' : '已连接') : '连接电脑'}</Text>
          </GlassPill>
        </View>
      </SafeAreaView>

      {!status.connected ? (
        <View style={styles.empty}>
          <Text style={styles.emptySymbol}>⌁</Text>
          <Text style={styles.emptyTitle}>还没有连接电脑</Text>
          <Text style={styles.emptyNote}>在电脑端「连接手机」生成二维码，手机扫码或粘贴链接完成配对。</Text>
          <Pressable style={styles.primaryButton} onPress={() => router.push('/pair')}>
            <Text style={styles.primaryButtonText}>去连接电脑</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 78, paddingBottom: 140 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => void getClient()?.sync(true)} tintColor={colors.gray} />}
          ListHeaderComponent={(
            <View>
              {hero ? (
                <Pressable style={styles.hero} onPress={() => router.push(`/bot/${hero.bot.id}`)}>
                  <View style={styles.heroAvatar}><BotAvatar bot={hero.bot} size={100} /></View>
                  <Text style={styles.heroName}>{hero.bot.name}</Text>
                </Pressable>
              ) : null}
              <Pressable style={styles.groupHead} onPress={() => router.push('/pair')}>
                <Text style={styles.groupHeadText}>对话</Text>
                <Text style={styles.groupHeadCount}>{rows.length}</Text>
              </Pressable>
            </View>
          )}
          renderItem={({ item }) => {
            const { name, bot, isGroup } = titleFor(item);
            return (
              <Pressable
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.rowPressed }]}
                onPress={() => router.push(`/chat/${item.id}`)}
              >
                {isGroup
                  ? <View style={[styles.groupIcon, { backgroundColor: bot?.avatar?.from ?? colors.blue }]}><Text style={styles.groupIconText}>{(bot?.name ?? '群').slice(0, 1)}</Text></View>
                  : <View style={styles.ava}><BotAvatar bot={bot ?? { name }} size={58} /></View>}
                <View style={styles.rowMain}>
                  <Text numberOfLines={1} style={styles.rowTitle}>{name}</Text>
                  <Text numberOfLines={1} style={styles.rowPreview}>{isGroup ? `${item.group?.memberBotIds?.length ?? 0} 个 Bot 的群聊` : '点按开始对话'}</Text>
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={(
            <View style={styles.empty}>
              <Text style={styles.emptyNote}>还没有同步到对话。电脑端的内容会自动过来。</Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingTop: 8, zIndex: 20 },
  meAva: { width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(255,255,255,0.84)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)' },
  meAvaText: { fontSize: 17, fontWeight: '600', color: colors.ink },
  blob: { position: 'absolute', borderRadius: 999 },
  hero: { alignItems: 'center', marginVertical: 10 },
  heroAvatar: { width: 100, height: 100, borderRadius: 50, overflow: 'hidden' },
  heroName: { marginTop: 11, fontSize: 15, color: colors.name, fontWeight: '500' },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 5, marginHorizontal: 6, marginTop: 18, marginBottom: 8 },
  groupHeadText: { fontSize: 15.5, color: colors.groupHead, fontWeight: '500' },
  groupHeadCount: { fontSize: 13, color: colors.groupHead },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 9, paddingHorizontal: 8, borderRadius: 24 },
  ava: { width: 58, height: 58 },
  rowMain: { flex: 1 },
  rowTitle: { fontSize: 16.5, fontWeight: '500', color: colors.ink },
  rowPreview: { fontSize: 13.5, color: colors.gray, marginTop: 2 },
  groupIcon: { width: 58, height: 58, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  groupIconText: { color: '#fff', fontSize: 22, fontWeight: '700' },
  statusText: { fontSize: 13, fontWeight: '500', color: colors.ink },
  dot: { width: 8, height: 8, borderRadius: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 120 },
  emptySymbol: { fontSize: 44, color: colors.gray2 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: colors.ink },
  emptyNote: { fontSize: 13, color: colors.gray, textAlign: 'center', lineHeight: 19, paddingHorizontal: 40 },
  primaryButton: { marginTop: 14, backgroundColor: colors.ink, borderRadius: 16, paddingHorizontal: 26, paddingVertical: 14 },
  primaryButtonText: { color: '#fff', fontSize: 15.5, fontWeight: '600' },
});
