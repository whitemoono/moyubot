import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { BotAvatar } from '../../components/BotAvatar';
import { useCollection, useSyncVersion } from '../../lib/data';
import { approve, sendChat, stopChat, useChatRuns, type BotConfig } from '../../lib/chat';

interface Message { id: string; conversationId: string; botId?: string; botName?: string; role: 'user' | 'assistant'; content: string; createdAt: number; error?: string; streaming?: boolean }
interface Bot { id: string; name: string; avatar?: { shape?: string; from?: string; glyph?: string }; providerId?: string; model?: string }

export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = String(id);
  useSyncVersion();
  const bots = useCollection<Bot>('bots');
  const allMessages = useCollection<Message>('messages');
  const { runs, approvals } = useChatRuns();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const listRef = useRef<FlatList<Message>>(null);

  const conversation = useCollection<{ id: string; botId?: string; title?: string }>('conversations').find((c) => c.id === conversationId);
  const bot: BotConfig | undefined = useMemo(() => bots.find((b) => b.id === conversation?.botId), [bots, conversation]);
  const messages = useMemo(() => allMessages
    .filter((m) => m.conversationId === conversationId && m.content)
    .sort((a, b) => a.createdAt - b.createdAt), [allMessages, conversationId]);
  const run = runs.find((r) => r.conversation === conversationId && r.status === 'running');

  useEffect(() => { listRef.current?.scrollToEnd({ animated: true }); }, [messages.length, run?.id]);

  const send = async () => {
    const value = text.trim();
    if (!value || !bot) return;
    setText(''); setError('');
    try { await sendChat(bot, conversationId, value); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: bot?.name ?? conversation?.title ?? '对话' }} />
      {bot && bot.providerId === '' ? <Text style={styles.warn}>这个 Bot 没有授权到服务器的模型，先在电脑端连接手机 → 第 4 区授权。</Text> : null}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        renderItem={({ item }) => {
          const mine = item.role === 'user';
          return (
            <View style={[styles.bubbleRow, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}>
              {!mine ? <BotAvatar bot={{ name: item.botName ?? bot?.name ?? 'Bot', avatar: bot?.avatar }} size={30} /> : null}
              <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                <Text style={[styles.bubbleText, mine ? { color: '#fff' } : null]} selectable>{item.content}</Text>
              </View>
            </View>
          );
        }}
        ListFooterComponent={run ? <View style={styles.running}><ActivityIndicator size="small" /><Text style={styles.runningText}>正在处理…（工具调用会在这里请求确认）</Text></View> : undefined}
      />
      {approvals.length ? (
        <View style={styles.approvals}>
          {approvals.map((a) => (
            <View key={a.id} style={styles.approval}>
              <Text style={styles.approvalTitle}>工具确认：{a.tool}</Text>
              <Text numberOfLines={3} style={styles.approvalBody}>{JSON.stringify(a.arguments)}</Text>
              <View style={styles.approvalButtons}>
                <Pressable style={styles.approveButton} onPress={() => void approve(a.id, true)}><Text style={styles.approveText}>允许</Text></Pressable>
                <Pressable style={styles.denyButton} onPress={() => void approve(a.id, false)}><Text style={styles.denyText}>拒绝</Text></Pressable>
              </View>
            </View>
          ))}
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.composer}>
        <TextInput style={styles.input} value={text} onChangeText={setText} placeholder={bot ? `给 ${bot.name} 发消息` : '发消息'} multiline />
        {run
          ? <Pressable style={styles.stopButton} onPress={() => void stopChat(conversationId, runs)}><Text style={styles.stopText}>停止</Text></Pressable>
          : <Pressable style={[styles.sendButton, !text.trim() && { opacity: 0.4 }]} onPress={() => void send()}><Text style={styles.sendText}>↑</Text></Pressable>}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f7f9' },
  bubbleRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  bubble: { maxWidth: '78%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleMine: { backgroundColor: '#111' },
  bubbleTheirs: { backgroundColor: '#fff' },
  bubbleText: { fontSize: 15, lineHeight: 21, color: '#111' },
  running: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 },
  runningText: { fontSize: 12, color: '#6b7280' },
  warn: { fontSize: 12, color: '#b45309', paddingHorizontal: 12, paddingVertical: 6 },
  approvals: { paddingHorizontal: 12, gap: 8 },
  approval: { backgroundColor: '#fff', borderRadius: 12, padding: 10, gap: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: '#e5e7eb' },
  approvalTitle: { fontSize: 13, fontWeight: '700' },
  approvalBody: { fontSize: 11, color: '#6b7280', fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  approvalButtons: { flexDirection: 'row', gap: 8 },
  approveButton: { backgroundColor: '#111', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6 },
  approveText: { color: '#fff', fontSize: 13 },
  denyButton: { borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: '#d1d5db' },
  denyText: { color: '#111', fontSize: 13 },
  error: { fontSize: 12, color: '#dc2626', paddingHorizontal: 12, paddingVertical: 4 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, backgroundColor: '#fff' },
  input: { flex: 1, minHeight: 40, maxHeight: 110, borderRadius: 20, backgroundColor: '#f3f4f6', paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, fontSize: 15 },
  sendButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  sendText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  stopButton: { paddingHorizontal: 14, height: 40, borderRadius: 20, backgroundColor: '#fee2e2', alignItems: 'center', justifyContent: 'center' },
  stopText: { color: '#b91c1c', fontSize: 13, fontWeight: '600' },
});
