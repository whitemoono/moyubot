import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BotAvatar } from '../../components/BotAvatar';
import { Backdrop } from '../../components/Backdrop';
import { useCollection, useSyncVersion } from '../../lib/data';
import { approve, sendChat, stopChat, useChatRuns, type BotConfig } from '../../lib/chat';
import { colors, glass, radius, shadow } from '../../theme';

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

  // PWA .chat-identity：头像 + 名字的玻璃胶囊作为头部标题
  const headerTitle = () => (
    <View style={styles.identity}>
      <View style={styles.identityAva}>{bot ? <BotAvatar bot={bot} size={32} /> : null}</View>
      <Text style={styles.identityName}>{bot?.name ?? conversation?.title ?? '对话'}</Text>
    </View>
  );

  return (
    <View style={styles.screen}>
      <Backdrop />
      <Stack.Screen
        options={{
          headerTitle,
          headerTransparent: true,
          headerStyle: { backgroundColor: 'transparent' },
          headerTintColor: colors.ink,
          headerRight: () => bot ? (
            <Pressable hitSlop={8} onPress={() => router.push(`/bot/${bot.id}`)}>
              <Text style={{ fontSize: 18, color: colors.ink }}>⋯</Text>
            </Pressable>
          ) : null,
        }}
      />
      {bot && !bot.providerId ? <Text style={styles.warn}>这个 Bot 没有授权到服务器的模型：先在电脑端「连接手机」第 4 区授权。</Text> : null}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 12, paddingTop: 8, gap: 5, paddingBottom: 150 }}
        renderItem={({ item }) => {
          const mine = item.role === 'user';
          return (
            <View style={[styles.bubbleRow, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}>
              {!mine ? <View style={styles.miniAvatar}><BotAvatar bot={{ name: item.botName ?? bot?.name ?? 'Bot', avatar: bot?.avatar }} size={26} /></View> : null}
              <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                {mine ? (
                  <LinearGradient colors={[colors.userFrom, colors.userTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                ) : (
                  <LinearGradient colors={[...glass.msgGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                )}
                <Text style={[styles.bubbleText, mine ? { color: '#17171b' } : null]} selectable>{item.content}</Text>
              </View>
            </View>
          );
        }}
        ListFooterComponent={run ? <View style={styles.running}><ActivityIndicator size="small" color={colors.muted} /><Text style={styles.runningText}>正在处理…</Text></View> : undefined}
      />
      {approvals.length ? (
        <View style={styles.approvals}>
          {approvals.map((a) => (
            <View key={a.id} style={styles.approval}>
              <Text style={styles.approvalTitle}>工具确认 · {a.tool}</Text>
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
      <SafeAreaView edges={['bottom']} style={styles.composerArea}>
        <View style={styles.composerShell}>
          <BlurView intensity={50} tint="light" style={StyleSheet.absoluteFill} />
          <LinearGradient colors={['rgba(255, 255, 255, 0.30)', 'rgba(255, 255, 255, 0.06)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, { borderRadius: radius.composer, borderWidth: 1, borderColor: colors.glassStroke }]} pointerEvents="none" />
          <View style={styles.composer}>
            <View style={styles.compPlus}><Text style={styles.compPlusText}>＋</Text></View>
            <TextInput style={styles.input} value={text} onChangeText={setText} placeholder={bot ? `给 ${bot.name} 发消息` : '发消息'} placeholderTextColor="#8f9a85" multiline />
            {run
              ? <Pressable style={styles.stopButton} onPress={() => void stopChat(conversationId, runs)}><Text style={styles.stopText}>停止</Text></Pressable>
              : <Pressable style={[styles.sendButton, !text.trim() && { opacity: 0.4 }]} onPress={() => void send()}>
                  <LinearGradient colors={[colors.primaryFrom, colors.primaryTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                  <Text style={styles.sendText}>↑</Text>
                </Pressable>}
          </View>
          <Text style={styles.footnote}>经服务器执行 · 手机不保存任何 API Key</Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 7, paddingRight: 16, paddingVertical: 6, borderRadius: 30, borderWidth: 1, borderColor: 'rgba(255,255,255,0.94)', backgroundColor: 'rgba(255,255,255,0.36)' },
  identityAva: { width: 32, height: 32, borderRadius: 16, overflow: 'hidden' },
  identityName: { fontSize: 14, fontWeight: '600', color: colors.ink },
  bubbleRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  miniAvatar: { width: 26, height: 26, marginBottom: 2 },
  bubble: { maxWidth: '81%', borderRadius: radius.bubble, overflow: 'hidden', padding: 12, paddingBottom: 13 },
  bubbleTheirs: { borderBottomLeftRadius: radius.bubbleTail, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.65)' },
  bubbleMine: { borderBottomRightRadius: radius.bubbleTail, borderWidth: 1, borderColor: colors.userBorder },
  bubbleText: { fontSize: 16, lineHeight: 23, color: '#17171b' },
  running: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 },
  runningText: { fontSize: 12.5, color: colors.muted },
  warn: { fontSize: 12, color: '#b45309', paddingHorizontal: 12, paddingVertical: 6 },
  approvals: { paddingHorizontal: 12, gap: 8 },
  approval: { backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 16, padding: 10, gap: 6 },
  approvalTitle: { fontSize: 13, fontWeight: '700', color: colors.ink },
  approvalBody: { fontSize: 11, color: colors.muted, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  approvalButtons: { flexDirection: 'row', gap: 8 },
  approveButton: { backgroundColor: colors.ink, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7 },
  approveText: { color: '#fff', fontSize: 13 },
  denyButton: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7, borderWidth: StyleSheet.hairlineWidth, borderColor: '#d1d5db' },
  denyText: { color: colors.ink, fontSize: 13 },
  error: { fontSize: 12, color: '#dc2626', paddingHorizontal: 12, paddingVertical: 4 },
  composerArea: { backgroundColor: 'transparent' },
  composerShell: { borderRadius: radius.composer, overflow: 'hidden', marginHorizontal: 10, marginBottom: 4 },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 7, padding: 8, minHeight: 54 },
  compPlus: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(162, 176, 146, 0.11)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.36)' },
  compPlusText: { fontSize: 20, color: colors.ink, marginTop: -2 },
  input: { flex: 1, minHeight: 40, maxHeight: 110, fontSize: 16.5, color: '#101013', paddingVertical: 8 },
  sendButton: { width: 40, height: 40, borderRadius: 20, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  sendText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  stopButton: { paddingHorizontal: 14, height: 40, borderRadius: 20, backgroundColor: '#fee2e2', alignItems: 'center', justifyContent: 'center' },
  stopText: { color: '#b91c1c', fontSize: 13, fontWeight: '600' },
  footnote: { fontSize: 10.5, color: '#859579', textAlign: 'center', paddingBottom: 6 },
});
