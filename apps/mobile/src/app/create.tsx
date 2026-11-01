import { Stack, router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Backdrop } from '../components/Backdrop';
import { BotAvatar } from '../components/BotAvatar';
import { GlassCard, PrimaryButton } from '../components/Glass';
import { getClient, useCollection, useSyncVersion } from '../lib/data';
import { colors } from '../theme';

interface Bot { id: string; name: string; avatar?: { shape?: string; from?: string; glyph?: string }; providerId?: string; model?: string; temperature?: number; systemPrompt?: string; approvalPolicy?: string; tools?: string[]; workspaceId?: string }
interface ShapeData { [shape: string]: unknown }

const shapes = Object.keys(require('../assets/grok-portraits.json') as ShapeData);
const palette = ['#5b8def', '#0A84FF', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#151517'];

/** 创建新 Bot（原型「创建新 Bot」弹层）：形状 + 颜色实时预览；创建 = 写入同步层，电脑端自动出现。 */
export default function CreateBot() {
  useSyncVersion();
  const bots = useCollection<Bot>('bots');
  const [name, setName] = useState('');
  const [shape, setShape] = useState('chibi');
  const [color, setColor] = useState(palette[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const base = useMemo(() => bots.find((b) => b.providerId && b.model) ?? bots[0], [bots]);
  const previewBot = { name: name.trim() || '新 Bot', avatar: { shape, from: color } };

  const create = async () => {
    const finalName = name.trim();
    if (!finalName) { setError('先给 Bot 起个名字'); return; }
    if (!getClient()?.state.enabled) { setError('请先开启实时同步'); return; }
    if (!base) { setError('还没有同步到任何 Bot，无法继承模型配置'); return; }
    setBusy(true); setError('');
    try {
      const id = `bot_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      getClient()!.put('bots', id, {
        id,
        name: finalName.slice(0, 60),
        avatar: { shape, from: color, to: color, glyph: finalName.slice(0, 1) },
        providerId: base.providerId,
        model: base.model,
        temperature: base.temperature ?? 0.7,
        systemPrompt: `你是 ${finalName}，运行在 MoyuBot 里的智能体。`,
        approvalPolicy: base.approvalPolicy ?? 'ask',
        tools: [],
        workspaceId: base.workspaceId ?? 'workspace_cloud',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await getClient()!.sync(true);
      router.back();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <View style={styles.screen}>
      <Backdrop />
      <Stack.Screen options={{ title: '创建新 Bot' }} />
      <SafeAreaView edges={['left', 'right']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 50 }}>
          <View style={styles.hero}>
            <View style={styles.heroAvatar}><BotAvatar bot={previewBot} size={100} /></View>
            <Text style={styles.heroName}>{name.trim() || '新 Bot'}</Text>
          </View>

          <GlassCard radius={22} style={{ padding: 14, gap: 10 }}>
            <Text style={styles.label}>名字</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="例如：小喵" maxLength={60} />
            <Text style={styles.label}>形状</Text>
            <View style={styles.shapeGrid}>
              {shapes.map((s) => (
                <Pressable key={s} onPress={() => setShape(s)} style={({ pressed }) => [styles.shapeCell, shape === s && styles.shapeCellActive, pressed && { opacity: 0.7 }]}>
                  <BotAvatar bot={{ name: s, avatar: { shape: s, from: color } }} size={40} />
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>颜色</Text>
            <View style={styles.colorRow}>
              {palette.map((c) => (
                <Pressable key={c} onPress={() => setColor(c)} style={[styles.colorCell, { backgroundColor: c }, color === c && styles.colorCellActive]} />
              ))}
            </View>
          </GlassCard>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <PrimaryButton title="创建并同步到电脑" onPress={() => void create()} disabled={busy} loading={busy} />
          <Text style={styles.hint}>创建后经实时同步出现在电脑端列表；模型继承现有 Bot 的授权配置。</Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  hero: { alignItems: 'center', marginVertical: 8 },
  heroAvatar: { width: 100, height: 100, borderRadius: 50, overflow: 'hidden' },
  heroName: { marginTop: 11, fontSize: 15, color: colors.name, fontWeight: '500' },
  label: { fontSize: 12, color: colors.groupHead, fontWeight: '600' },
  input: { backgroundColor: 'rgba(255, 255, 255, 0.72)', borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.65)', paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: colors.ink },
  shapeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  shapeCell: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent', backgroundColor: 'rgba(255,255,255,0.5)' },
  shapeCellActive: { borderColor: colors.blue, backgroundColor: 'rgba(10, 132, 255, 0.10)' },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  colorCell: { width: 32, height: 32, borderRadius: 16, borderWidth: 3, borderColor: 'transparent' },
  colorCellActive: { borderColor: '#fff' },
  error: { fontSize: 13, color: '#dc2626' },
  hint: { fontSize: 12, color: colors.gray2, lineHeight: 18, textAlign: 'center' },
});
