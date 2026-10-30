import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSettings } from '@moyu/core';
import { useMoyu } from '../state';
import { useDialogFocus } from '../lib/use-dialog-focus';
import { Button, IconButton, Panel, Segmented, Toggle } from '../components/Glass';
import { Icon } from '../components/Icon';
import { ProfileSettings } from '../components/ProfileSettings';
import { AboutSettings } from './AboutSettings';
import { FeedbackSettings } from './FeedbackSettings';
import { ProvidersSettings } from './ProvidersSettings';
import { BotsView } from './BotsView';
import { CloudView } from './CloudView';
import { UsageView } from './UsageView';
import { WorkspacePathSettings } from '../components/WorkspacePathSettings';
import { CapabilitiesSettings } from './CapabilitiesSettings';

const ACCENTS = ['#f5f5f5', '#737373', '#404040', '#6366f1', '#ec4899', '#06b6d4', '#f97316', '#22c55e'];
const SECTIONS = [
  { id: 'appearance', label: '通用', icon: 'sliders', hint: '让工作空间更合你的习惯。' },
  { id: 'profile', label: '个人资料', icon: 'users', hint: '为你的工作空间换个表情。' },
  { id: 'bots', label: 'Bot 管理', icon: 'bots', hint: '管理你的角色、模型、人格与工具。' },
  { id: 'capabilities', label: 'MCP 与 Skills', icon: 'plug', hint: '为当前工作区添加工具服务与技能，再分配给 Bot。' },
  { id: 'providers', label: '模型供应商', icon: 'spark', hint: '连接官方服务、第三方中转站与本地模型。' },
  { id: 'cloud', label: '共享云电脑', icon: 'cloud', hint: '一个共享的执行空间，需要时唤醒，空闲时休眠。' },
  { id: 'usage', label: '用量', icon: 'usage', hint: '每一次调用，都看得见。' },
  { id: 'feedback', label: '反馈与帮助', icon: 'chat', hint: '交流想法，反馈问题，一起完善 MoyuBot。' },
  { id: 'about', label: '关于', icon: 'bots', hint: '一个工作空间，连接你的模型、Bot 与云电脑。' },
] as const;

export function SettingsView({ onCreateBot }: { onCreateBot: () => void }) {
  const { settings, saveSettings, version, toast, settingsSection: section, setSettingsSection: setSection, closeSettings, activeWorkspace } = useMoyu();
  const sections = SECTIONS.map((item) => item.id === 'cloud' && activeWorkspace?.kind === 'local' ? { ...item, label: '本地电脑', hint: '工作区内的 Bot 共用本机 Windows，文件与命令在本地完成。' } : item);
  const dialog = useRef<HTMLDivElement>(null);
  const [providerDirty, setProviderDirty] = useState(false);
  const [cloudDirty, setCloudDirty] = useState(false);
  const [closeNotice, setCloseNotice] = useState(false);
  const [closing, setClosing] = useState(false);
  const finishClose = useCallback(() => setClosing(true), []);
  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(closeSettings, settings.ui.reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 150);
    return () => window.clearTimeout(timer);
  }, [closing, closeSettings, settings.ui.reduceMotion]);
  const close = useCallback(() => { if (providerDirty || cloudDirty) setCloseNotice(true); else finishClose(); }, [providerDirty, cloudDirty, finishClose]);
  useDialogFocus(dialog, close);
  const updateUi = (patch: Partial<AppSettings['ui']>) => void saveSettings({ ui: { ...settings.ui, ...patch } }).catch((error: Error) => toast(error.message, 'error'));
  const selected = sections.find((item) => item.id === section)!;
  return <div className={`settings-backdrop ${closing ? 'is-closing' : ''}`} onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" ref={dialog}>
      <aside className="settings-navigation"><div className="settings-navigation__title">设置<span>WORKSPACE</span></div>
        <nav className="settings-tabs" aria-label="设置分类">{sections.map((item) => <button type="button" key={item.id} aria-current={section === item.id ? 'page' : undefined} className={section === item.id ? 'is-active' : ''} onClick={() => { setSection(item.id); setCloseNotice(false); }}><Icon name={item.icon} size={16} />{item.label}</button>)}</nav>
        <div className="settings-navigation__footer"><Icon name="shield" size={14} /><span>本地工作空间<small>MoyuBot · v{version}</small></span></div>
      </aside>
      <div className={`settings-main settings-main--${section}`}>
        <header className="settings-heading"><div><h2 id="settings-title">{selected.label}</h2><p>{selected.hint}</p></div><IconButton name="close" label="关闭设置" onClick={close} /></header>
        <div className="settings-content">
          {section === 'capabilities' ? <CapabilitiesSettings key={activeWorkspace?.id} /> : null}
          {section === 'usage' ? <UsageView /> : null}
          {section === 'feedback' ? <FeedbackSettings /> : null}
          <div hidden={section !== 'providers'} className="settings-provider-page"><ProvidersSettings onDirty={setProviderDirty} /></div>
          <div hidden={section !== 'bots'} className="settings-bots-page">{section === 'bots' ? <BotsView embedded onCreate={onCreateBot} /> : null}</div>
          <div hidden={section !== 'cloud'} className="settings-cloud-page"><CloudView active={section === 'cloud'} onDirty={setCloudDirty} /></div>
          <ProfileSettings hidden={section !== 'profile'} />
          <Panel className="settings-card settings-general" hidden={section !== 'appearance'}>
            <h3 className="settings-section-title">外观</h3>
            <div className="settings-rows">
              <div className="settings-row"><div><strong>明暗主题</strong><p>选择适合当前环境的界面。</p></div><Segmented value={settings.ui.appearance} onChange={(value) => updateUi({ appearance: value })} options={[{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }, { value: 'system', label: '跟随系统' }]} /></div>
              <div className="settings-row"><div><strong>强调色</strong><p>用于焦点与界面细节。</p></div><div className="swatch-row">{ACCENTS.map((accent) => <button key={accent} type="button" aria-label={accent} aria-pressed={settings.ui.accent === accent} className={`swatch ${settings.ui.accent === accent ? 'is-active' : ''}`} style={{ background: accent }} onClick={() => updateUi({ accent })} />)}</div></div>
              <div className="settings-row"><div><strong>界面密度</strong><p>调整列表和面板的留白。</p></div><Segmented value={settings.ui.density} onChange={(value) => updateUi({ density: value })} options={[{ value: 'comfortable', label: '舒适' }, { value: 'compact', label: '紧凑' }]} /></div>
              <div className="settings-row"><div><strong>面板层次</strong><p>控制背景与内容区域的层次。</p></div><div className="settings-range"><input className="range" aria-label="面板层次" type="range" min={0.2} max={1} step={0.05} value={settings.ui.glassIntensity} onChange={(e) => updateUi({ glassIntensity: Number(e.target.value) })} /><span>{Math.round(settings.ui.glassIntensity * 100)}%</span></div></div>
            </div>
            <WorkspacePathSettings />
            <h3 className="settings-section-title">交互与动效</h3><div className="settings-rows"><Toggle checked={settings.ui.reduceMotion} onChange={(value) => updateUi({ reduceMotion: value })} label="减少动效" hint="减少界面过渡与角色动画，同时遵循系统设置。" /></div>
            <p className="settings-note"><Icon name="check" size={13} />外观设置会自动保存</p>
          </Panel>
          <AboutSettings hidden={section !== 'about'} />
        </div>
      </div>
      {closeNotice ? <div className="settings-unsaved" role="alert"><span>有未保存的配置，关闭前需要保存。</span><Button size="sm" variant="ghost" onClick={() => setCloseNotice(false)}>继续编辑</Button><Button size="sm" variant="danger" onClick={finishClose}>放弃更改并关闭</Button></div> : null}
    </div>
  </div>;
}
