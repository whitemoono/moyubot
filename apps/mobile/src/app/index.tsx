import { Stack, router } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BotAvatar } from '../components/BotAvatar';
import { getClient, useCollection, useSyncStatus } from '../lib/data';

interface Bot { id: string; name: string; avatar?: { shape?: string; from?: string; glyph?: string } }
interface Conversation { id: string; botId?: string; title?: string; group?: { memberBotIds?: string[] }; updatedAt?: number; deletedAt?: number }

export default function Home() {
  const bots = useCollection<Bot>('bots');
  const conversations = useCollection<Conversation>('conversations');
  const status = useSyncStatus();

  const rows = useMemo(() => conversations
    .filter((c) => !c.deletedAt)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)), [conversations]);

  const titleFor = (conversation: Conversation): { name: string; bot?: Bot; isGroup: boolean } => {
    if (conversation.group) return { name: conversation.title || '群聊', isGroup: true };
    const bot = bots.find((item) => item.id === conversation.botId);
    return { name: bot?.name ?? conversation.title ?? '对话', bot, isGroup: false };
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <Stack.Screen
        options={{
          title: '墨鱼',
          headerRight: () => (
            <Pressable onPress={() => router.push('/pair')} hitSlop={8}>
              <Text style={{ color: status.connected ? '#0a7' : '#c60', fontSize: 13 }}>
                {status.connected ? (status.enabled ? '同步中' : '已连接') : '连接电脑'}
              </Text>
            </Pressable>
          ),
        }}
      />
      {!status.connected ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>还没有连接电脑</Text>
          <Text style={styles.emptyNote}>在电脑端「连接手机」生成二维码，把链接粘贴到手机完成配对。</Text>
          <Pressable style={styles.primaryButton} onPress={() => router.push('/pair')}>
            <Text style={styles.primaryButtonText}>去连接电脑</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => void getClient()?.sync(true)} />}
          renderItem={({ item }) => {
            const { name, bot, isGroup } = titleFor(item);
            return (
              <Pressable style={styles.row} onPress={() => router.push(`/chat/${item.id}`)}>
                {isGroup
                  ? <View style={[styles.groupIcon, { backgroundColor: bot?.avatar?.from ?? '#5b8def' }]}><Text style={styles.groupIconText}>{(bot?.name ?? '群').slice(0, 1)}</Text></View>
                  : <BotAvatar bot={bot ?? { name }} size={48} />}
                <View style={styles.rowText}>
                  <Text numberOfLines={1} style={styles.rowTitle}>{name}</Text>
                  <Text numberOfLines={1} style={styles.rowNote}>{isGroup ? `群聊 · ${item.group?.memberBotIds?.length ?? 0} 个 Bot` : '对话'}</Text>
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={(
            <View style={styles.empty}>
              <Text style={styles.emptyNote}>还没有同步到对话。开启实时同步后，电脑端的内容会自动过来。</Text>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f7f9' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#fff', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e5e7eb' },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 16, fontWeight: '600', color: '#111' },
  rowNote: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  groupIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  groupIconText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  empty: { padding: 40, alignItems: 'center', gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#111' },
  emptyNote: { fontSize: 13, color: '#6b7280', textAlign: 'center', lineHeight: 19 },
  primaryButton: { marginTop: 10, backgroundColor: '#111', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12 },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
