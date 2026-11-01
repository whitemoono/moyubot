import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { clearSession, currentSession, normalizeServer, saveSession } from '../lib/server';
import { disconnect, reconnect, useSyncStatus } from '../lib/data';

interface PendingClaim { id: string; claim: string; token: string; deviceId: string; workspace: string }

/** 配对：粘贴电脑端生成的连接链接（https://…/#pair=id.secret）→ claim → 等电脑确认 → 保存会话。 */
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
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <Stack.Screen options={{ title: '连接电脑' }} />
      {connected ? (
        <View style={styles.block}>
          <Text style={styles.title}>已连接</Text>
          <Text style={styles.note}>服务器：{currentSession()?.server}</Text>
          <Text style={styles.note}>实时同步：{status.enabled ? '开启中' : '已暂停'} · 待上传 {status.pending} · 冲突 {status.conflicts}</Text>
          {status.error ? <Text style={styles.error}>{status.error}</Text> : null}
          <Pressable style={styles.secondaryButton} onPress={() => void disconnectNow()}>
            <Text style={styles.secondaryText}>退出本机连接</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.block}>
          <Text style={styles.title}>1 · 电脑端生成二维码</Text>
          <Text style={styles.note}>电脑「连接手机」→ 生成连接二维码；把二维码下的链接复制发到手机（隔空投送/微信均可）。</Text>
          <Text style={styles.title}>2 · 扫码或粘贴连接链接</Text>
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
          <Text style={styles.hint}>也可以粘贴链接：</Text>
          <TextInput style={[styles.input, styles.mono]} value={server} onChangeText={setServer} placeholder="https://pwa.moyubot.net" autoCapitalize="none" autoCorrect={false} />
          <TextInput style={[styles.input, styles.mono, styles.area]} value={link} onChangeText={setLink} placeholder="粘贴 https://…/#pair=… 完整链接" autoCapitalize="none" autoCorrect={false} multiline />
          <Pressable style={[styles.primaryButton, stage !== 'idle' && { opacity: 0.5 }]} disabled={stage !== 'idle'} onPress={() => void claim()}>
            {stage === 'idle' ? <Text style={styles.primaryText}>连接这台电脑 →</Text> : <ActivityIndicator color="#fff" />}
          </Pressable>
          {note ? <Text style={styles.note}>{note}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Text style={styles.hint}>配对后内容不会自动上传：回首页打开「同步中」才开始双向同步。</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f7f9' },
  block: { padding: 20, gap: 10 },
  title: { fontSize: 16, fontWeight: '700', color: '#111', marginTop: 6 },
  note: { fontSize: 13, color: '#6b7280', lineHeight: 19 },
  hint: { fontSize: 12, color: '#9ca3af', lineHeight: 18, marginTop: 8 },
  error: { fontSize: 13, color: '#dc2626' },
  input: { backgroundColor: '#fff', borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: '#e5e7eb', paddingHorizontal: 14, paddingVertical: 10, fontSize: 15 },
  area: { minHeight: 70, textAlignVertical: 'top' },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 13 },
  primaryButton: { backgroundColor: '#111', borderRadius: 12, alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  secondaryButton: { borderRadius: 12, alignItems: 'center', paddingVertical: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: '#d1d5db', marginTop: 10 },
  secondaryText: { color: '#111', fontSize: 14 },
  cameraWrap: { borderRadius: 12, overflow: 'hidden', height: 280 },
  camera: { flex: 1 },
  cameraClose: { position: 'absolute', bottom: 10, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 7 },
  cameraCloseText: { color: '#fff', fontSize: 13 },
  scanButton: { backgroundColor: '#fff', borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: '#d1d5db', alignItems: 'center', paddingVertical: 12 },
  scanText: { fontSize: 15, fontWeight: '600', color: '#111' },
});
