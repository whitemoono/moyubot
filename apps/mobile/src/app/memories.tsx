import { Stack, useLocalSearchParams } from 'expo-router';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Backdrop } from '../components/Backdrop';
import { useCollection, useSyncVersion } from '../lib/data';
import { colors } from '../theme';

interface Memory { id: string; botId?: string; text: string; pinned?: boolean; createdAt?: number; source?: string }

export default function Memories() {
  const { botId } = useLocalSearchParams<{ botId?: string }>();
  useSyncVersion();
  const memories = useCollection<Memory>('memories')
    .filter((m) => !botId || m.botId === botId)
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.createdAt ?? 0) - (a.createdAt ?? 0));

  return (
    <View style={styles.screen}>
      <Backdrop />
      <Stack.Screen options={{ title: '资料库' }} />
      <SafeAreaView edges={['left', 'right']} style={{ flex: 1 }}>
        <FlatList
          data={memories}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 8 }}
          renderItem={({ item }) => (
            <View style={styles.card}>
              {item.pinned ? <Text style={styles.pin}>📌</Text> : null}
              <Text style={styles.text} selectable>{item.text}</Text>
              <Text style={styles.meta}>{item.source ?? 'manual'}{item.createdAt ? ` · ${new Date(item.createdAt).toLocaleDateString('zh-CN')}` : ''}</Text>
            </View>
          )}
          ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>这个 Bot 还没有长期记忆。</Text></View>}
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  card: { backgroundColor: 'rgba(255, 255, 255, 0.78)', borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.65)', padding: 14, gap: 6 },
  pin: { position: 'absolute', top: 8, right: 10, fontSize: 12 },
  text: { fontSize: 14.5, lineHeight: 21, color: colors.ink },
  meta: { fontSize: 11.5, color: colors.gray2 },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyText: { fontSize: 13, color: colors.gray },
});
