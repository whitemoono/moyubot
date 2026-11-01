import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { GlassCard, PrimaryButton, TextButton } from '../components/Glass';
import { clearSession, currentSession, normalizeServer, saveSession } from '../lib/server';
import { disconnect, reconnect, useSyncStatus } from '../lib/data';
import { colors } from '../theme';

interface PendingClaim { id: string; claim: string; token: string; deviceId: string; workspace: string }

/** 配对：扫电脑端二维码（或粘贴链接）→ claim → 等电脑确认 → 保存会话。 */
export default function Pair() {
  const status = useSyncStatus();
  const [server, setServer] = useState(currentSession()?.server ?? 'https://pwa.moyubot.net');
  const [link, setLink] = useState('');
  const [stage, setStage] = useState<'idle' | 'claiming' | 'waiting' | 'done'>('idle');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const openScanner = async () => {
    setError('');
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) { setError('相机权限未开启；仍可粘贴连接链接配对。'); return; }
    }
    setScanning(true);
  };

  const claim = async (rawInput?: string) => {
    setError(''); setNote('');
    try {
      const base = normalizeServer(server);
      let raw = (rawInput ?? link).trim();
      if (raw.includes('#pair=')) {
        const parsed = new URL(raw);
        if (parsed.origin !== base) throw new Error(`这个链接属于 ${parsed.origin}，和上面填的服务器地址不一致`);
        raw = parsed.hash.slice(6);
      }
      const [id, secret, ...extra] = raw.split('.');
      if (!id || !secret || extra.length) throw new Error('连接链接无效：请粘贴电脑端生成的完整链接');
      setStage('claiming');
      const pending: PendingClaim = await fetch(`${base}/api/pair/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, secret, name: 'MoyuBot iOS' }),
      }).then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '配对请求失败');
        return data as PendingClaim;
      });
      setStage('waiting');
      setNote('已扫码，请在电脑端点击「确认连接」…');
      const deadline = Date.now() + 5 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const check = await fetch(`${base}/api/pair/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: pending.id, claim: pending.claim }),
        }).then((response) => response.json());
        if (check.status === 'approved') {
          await saveSession({ token: pending.token, deviceId: pending.deviceId, workspace: pending.workspace, server: base });
          await reconnect();
          setStage('done');
          setNote('连接成功，实时同步已开启');
          setTimeout(() => router.back(), 800);
          return;
        }
        if (check.status !== 'claimed') throw new Error('连接请求已取消，请重新生成二维码');
      }
      throw new Error('等待确认超时，请在电脑端重新生成二维码');
    } catch (e) {
      setStage('idle');
      setError((e as Error).message);
    }
  };

  const disconnectNow = async () => {
    await disconnect();
    setNote('已退出本机连接');
  };

  const connected = !!currentSession();

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <Stack.Screen options={{ title: '' }} />
      {connected ? (
        <View style={styles.block}>
          <Text style={styles.symbol}>⌁</Text>
          <Text style={styles.title}>已连接你的自建工作空间</Text>
          <Text style={styles.note}>服务器：{currentSession()?.server}</Text>
          <Text style={styles.note}>实时同步：{status.enabled ? '开启中' : '已暂停'} · 待上传 {status.pending} · 冲突 {status.conflicts}</Text>
          {status.error ? <Text style={styles.error}>{status.error}</Text> : null}
          <TextButton title="退出本机连接" onPress={() => void disconnectNow()} />
        </View>
      ) : (
        <View style={styles.block}>
          <GlassCard radius={28} style={{ padding: 18, gap: 10 }}>
            <Text style={styles.symbol}>⌁</Text>
            <Text style={styles.title}>1 · 电脑端生成二维码</Text>
            <Text style={styles.note}>电脑「连接手机」→ 生成连接二维码；把二维码下的链接发到手机。</Text>
            <Text style={styles.title}>2 · 扫码或粘贴链接</Text>
            {scanning ? (
              <View style={styles.cameraWrap}>
                <CameraView
                  style={styles.camera}
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={({ data }: { data: string }) => {
                    if (stage !== 'idle') return;
                    setScanning(false);
                    setLink(data);
                    void claim(data);
                  }}
                />
                <Pressable style={styles.cameraClose} onPress={() => setScanning(false)}><Text style={styles.cameraCloseText}>收起相机</Text></Pressable>
              </View>
            ) : (
              <Pressable style={styles.scanButton} onPress={() => void openScanner()} disabled={stage !== 'idle'}>
                <Text style={styles.scanText}>📷 打开相机扫码</Text>
              </Pressable>
            )}
            <TextInput style={[styles.input, styles.mono]} value={server} onChangeText={setServer} placeholder="https://pwa.moyubot.net" autoCapitalize="none" autoCorrect={false} />
            <TextInput style={[styles.input, styles.mono, styles.area]} value={link} onChangeText={setLink} placeholder="粘贴 https://…/#pair=… 完整链接" autoCapitalize="none" autoCorrect={false} multiline />
            <PrimaryButton title={stage === 'idle' ? '连接这台电脑 →' : stage === 'claiming' ? '正在请求连接…' : stage === 'waiting' ? '等待电脑确认…' : '已完成'} onPress={() => void claim()} disabled={stage !== 'idle'} loading={stage !== 'idle'} />
            {note ? <Text style={styles.note}>{note}</Text> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </GlassCard>
          <Text style={styles.hint}>配对后内容不会自动上传：回首页打开「同步中」才开始双向同步。</Text>
          {stage !== 'idle' ? <View style={styles.overlayBusy} pointerEvents="none"><ActivityIndicator size="large" color={colors.blue} /></View> : null}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  block: { flex: 1, padding: 18, gap: 8, justifyContent: 'center' },
  symbol: { fontSize: 40, color: colors.gray2, textAlign: 'center' },
  title: { fontSize: 16, fontWeight: '700', color: colors.ink, marginTop: 4 },
  note: { fontSize: 13, color: colors.gray, lineHeight: 19 },
  hint: { fontSize: 12, color: colors.gray2, lineHeight: 18, textAlign: 'center', paddingBottom: 10 },
  error: { fontSize: 13, color: '#dc2626' },
  input: { backgroundColor: 'rgba(255, 255, 255, 0.72)', borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.65)', paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: colors.ink },
  area: { minHeight: 70, textAlignVertical: 'top' },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 13 },
  cameraWrap: { borderRadius: 16, overflow: 'hidden', height: 260 },
  camera: { flex: 1 },
  cameraClose: { position: 'absolute', bottom: 10, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 7 },
  cameraCloseText: { color: '#fff', fontSize: 13 },
  scanButton: { backgroundColor: 'rgba(255, 255, 255, 0.72)', borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.65)', alignItems: 'center', paddingVertical: 12 },
  scanText: { fontSize: 15, fontWeight: '600', color: colors.ink },
  overlayBusy: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
});
