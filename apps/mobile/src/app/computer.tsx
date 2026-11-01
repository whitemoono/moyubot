import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Backdrop } from '../components/Backdrop';
import { GlassCard } from '../components/Glass';
import { api } from '../lib/server';
import { colors } from '../theme';

/** 电脑：经服务器操作已授权的云电脑（状态 / 执行命令 / 读写文本文件），与 PWA 的 showCloud 同一套接口。 */
export default function Computer() {
  const [catalog, setCatalog] = useState<{ cloud?: { machineName?: string; remoteWorkspaceDir?: string } | null } | null>(null);
  const [cloudError, setCloudError] = useState('');
  const [cmd, setCmd] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState('');
  const [path, setPath] = useState('');

  useEffect(() => {
    api('/api/execution/config')
      .then((next) => setCatalog(next))
      .catch((e) => setCloudError((e as Error).message));
  }, []);

  const run = async () => {
    if (!cmd.trim() || !confirmed) return;
    setBusy(true); setOutput('正在连接云电脑…');
    try {
      const result = await api('/api/cloud/exec', { cmd: cmd.trim(), confirmed: true }, {}, 300000);
      setOutput(result.stdout !== undefined ? `${result.stdout}\n${result.stderr}\n退出码：${result.exitCode}` : '已执行');
    } catch (e) { setOutput((e as Error).message); }
    finally { setBusy(false); }
  };

  const readFile = async () => {
    if (!path.trim()) return;
    setBusy(true); setOutput('读取中…');
    try {
      const result = await api('/api/cloud/read', { path: path.trim() }, {}, 300000);
      setOutput(result.content ?? '(空文件)');
    } catch (e) { setOutput((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.screen}>
      <Backdrop />
      <Stack.Screen options={{ title: '电脑' }} />
      <SafeAreaView edges={['left', 'right']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 60 }}>
          {!catalog ? <View style={styles.center}><ActivityIndicator color={colors.gray} /></View> : !catalog.cloud ? (
            <Text style={styles.note}>请在电脑端「连接手机」→ 第 4 区授权云电脑连接。</Text>
          ) : (
            <>
              <GlassCard radius={20} style={{ padding: 14, gap: 4 }}>
                <Text style={styles.machine}>{catalog.cloud.machineName || '云电脑'}</Text>
                <Text style={styles.meta}>目录：{catalog.cloud.remoteWorkspaceDir || '/data/moyubot'}</Text>
                <Text style={styles.meta}>文件、命令通过已授权的云电脑执行，无需原电脑在线。</Text>
              </GlassCard>

              <GlassCard radius={20} style={{ padding: 14, gap: 8 }}>
                <Text style={styles.label}>执行命令</Text>
                <TextInput style={[styles.input, styles.area]} value={cmd} onChangeText={setCmd} placeholder="pwd" autoCapitalize="none" autoCorrect={false} multiline />
                <Pressable style={styles.checkRow} onPress={() => setConfirmed(!confirmed)}>
                  <View style={[styles.checkbox, confirmed && { backgroundColor: colors.blue, borderColor: colors.blue }]}>{confirmed ? <Text style={styles.checkText}>✓</Text> : null}</View>
                  <Text style={styles.checkLabel}>我确认在云电脑执行以上命令</Text>
                </Pressable>
                <Pressable style={[styles.runButton, (!cmd.trim() || !confirmed || busy) && { opacity: 0.4 }]} disabled={!cmd.trim() || !confirmed || busy} onPress={() => void run()}>
                  {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.runText}>执行</Text>}
                </Pressable>
                <Text style={styles.label}>读文本文件</Text>
                <TextInput style={styles.input} value={path} onChangeText={setPath} placeholder="/data/moyubot/notes.txt" autoCapitalize="none" autoCorrect={false} />
                <Pressable style={styles.readButton} disabled={busy || !path.trim()} onPress={() => void readFile()}>
                  <Text style={styles.runText2}>读取文件</Text>
                </Pressable>
              </GlassCard>

              {output ? (
                <GlassCard radius={20} style={{ padding: 14 }}>
                  <Text style={styles.output} selectable>{output}</Text>
                </GlassCard>
              ) : null}
              {cloudError ? <Text style={styles.error}>{cloudError}</Text> : null}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { alignItems: 'center', paddingVertical: 40 },
  machine: { fontSize: 16, fontWeight: '700', color: colors.ink },
  meta: { fontSize: 12.5, color: colors.gray },
  label: { fontSize: 12, color: colors.groupHead, fontWeight: '600', marginTop: 4 },
  note: { fontSize: 13, color: colors.gray, lineHeight: 19, padding: 16 },
  input: { backgroundColor: 'rgba(255, 255, 255, 0.72)', borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.65)', paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: colors.ink },
  area: { minHeight: 64, textAlignVertical: 'top' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkbox: { width: 18, height: 18, borderRadius: 5, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.gray2, alignItems: 'center', justifyContent: 'center' },
  checkText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  checkLabel: { fontSize: 13, color: colors.ink },
  runButton: { backgroundColor: colors.ink, borderRadius: 12, alignItems: 'center', paddingVertical: 12 },
  runText: { color: '#fff', fontSize: 14.5, fontWeight: '600' },
  readButton: { borderRadius: 12, alignItems: 'center', paddingVertical: 11, borderWidth: StyleSheet.hairlineWidth, borderColor: '#d1d5db' },
  runText2: { color: colors.ink, fontSize: 14 },
  output: { fontSize: 12.5, lineHeight: 19, color: colors.ink, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  error: { fontSize: 13, color: '#dc2626', paddingHorizontal: 4 },
});
