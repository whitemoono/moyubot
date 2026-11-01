import { Stack, router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GlassCard, TextButton } from '../../components/Glass';
import { disconnect, useCollection, useSyncStatus, useSyncVersion } from '../../lib/data';
import { currentSession } from '../../lib/server';
import { colors } from '../../theme';

interface Profile { userName?: string }

/** 我的：用户卡 + 连接状态 + 服务器信息（对应 PWA 我的 tab）。 */
export default function Me() {
  useSyncVersion();
  const profiles = useCollection<Profile>('profile');
  const status = useSyncStatus();
  const session = currentSession();
  const userName = profiles[0]?.userName || '本地用户';

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.topBar}><Text style={styles.topTitle}>我的</Text></View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 70, paddingBottom: 130, gap: 12 }}>
        <GlassCard radius={23} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={styles.ava}><Text style={styles.avaText}>{userName.slice(0, 1)}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{userName}</Text>
            <Text style={styles.meta}>{status.connected ? '已连接自建服务器' : '未连接电脑'}</Text>
          </View>
        </GlassCard>

        <GlassCard radius={23} style={{ gap: 6 }}>
          <Text style={styles.label}>连接</Text>
          <Text style={styles.meta}>服务器：{session?.server ?? '未配置'}</Text>
          <Text style={styles.meta}>实时同步：{status.enabled ? '开启中' : '已暂停'} · 待上传 {status.pending} · 冲突 {status.conflicts}</Text>
          {status.lastSync ? <Text style={styles.meta}>最近同步：{new Date(status.lastSync).toLocaleTimeString('zh-CN')}</Text> : null}
          {status.error ? <Text style={styles.error}>{status.error}</Text> : null}
          <Pressable style={({ pressed }) => [styles.pairButton, pressed && { opacity: 0.8 }]} onPress={() => router.push('/pair')}>
            <Text style={styles.pairText}>{status.connected ? '设备与配对管理' : '去连接电脑'}</Text>
          </Pressable>
          {status.connected ? <TextButton title="退出本机连接" onPress={() => void disconnect()} /> : null}
        </GlassCard>

        <GlassCard radius={23} style={{ gap: 6 }}>
          <Text style={styles.label}>关于</Text>
          <Text style={styles.meta}>MoyuBot 手机端 · 数据仅存于你自建的服务器与本机</Text>
          <Text style={styles.meta}>API Key 不进入手机；执行凭据由电脑端明确授权后加密保存在服务器。</Text>
        </GlassCard>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, paddingTop: 54, paddingHorizontal: 20, zIndex: 20 },
  topTitle: { fontSize: 24, fontWeight: '700', color: colors.ink },
  ava: { width: 61, height: 61, borderRadius: 31, backgroundColor: 'rgba(255,255,255,0.6)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.glassStroke },
  avaText: { fontSize: 24, fontWeight: '700', color: colors.softInk },
  name: { fontSize: 18, fontWeight: '700', color: colors.ink },
  meta: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  label: { fontSize: 12, fontWeight: '600', color: colors.muted },
  error: { fontSize: 12.5, color: '#dc2626' },
  pairButton: { backgroundColor: 'rgba(255, 255, 255, 0.55)', borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.glassStroke, alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  pairText: { fontSize: 14.5, fontWeight: '600', color: colors.ink },
});
