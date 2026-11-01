import { useEffect, useRef, useState } from 'react';
import type { BotAvatar as Avatar } from '@moyu/core';
import logo from '../assets/brand/logo.png';
import { useMoyu } from '../state';
import { moyu } from '../lib/bridge';
import { readAvatar } from '../lib/avatar-image';
import { useDialogFocus } from '../lib/use-dialog-focus';
import { AvatarPicker } from './AvatarPicker';
import { DEFAULT_USER_AVATAR, UserAvatar } from './UserAvatar';
import { Button } from './Glass';
import { Icon } from './Icon';

const STEPS = [{ label: '认识你', icon: 'users' }, { label: '云电脑', icon: 'cloud' }, { label: '存放位置', icon: 'folder' }] as const;
const DRIVERS = [{ value: 'instabox', label: 'InstaBox', hint: '开箱即用' }, { value: 'e2b', label: 'E2B', hint: '官方云或自建' }] as const;

export function Onboarding() {
  const { settings, secrets, saveSettings, saveCloud, chooseLocalDirectory, completeSetup, platform, toast } = useMoyu();
  const [step, setStep] = useState<number>(settings.onboarding?.step ?? 0);
  const [name, setName] = useState(settings.userName ?? '');
  const [avatar, setAvatar] = useState<Avatar>(settings.ui.userAvatar ?? DEFAULT_USER_AVATAR);
  const [key, setKey] = useState('');
  const [driver, setDriver] = useState<'instabox' | 'e2b'>(settings.cloud.driver === 'e2b' ? 'e2b' : 'instabox');
  const [baseUrl, setBaseUrl] = useState(settings.cloud.driver === 'e2b' ? settings.cloud.baseUrl : settings.cloud.baseUrl || 'https://api.instabox.sh');
  const [machineName, setMachineName] = useState(settings.cloud.machineName);
  const [skipCloud, setSkipCloud] = useState(settings.onboarding?.cloudSkipped ?? !secrets.cloudKey);
  const [directory, setDirectory] = useState(settings.workspaces.find((workspace) => workspace.kind === 'local')?.directory ?? '');
  const [dataDir, setDataDir] = useState('');
  const [initialDataDir, setInitialDataDir] = useState('');
  const [dataFallback, setDataFallback] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  useDialogFocus(dialog, () => {});

  // 数据目录：默认取安装目录下的 data（便携模式），读不到时展示系统默认位置。
  useEffect(() => {
    void moyu().dataDirInfo().then((info) => {
      setDataDir((current) => current || info.current);
      setInitialDataDir((current) => current || info.current);
      setDataFallback(info.portable || info.userData);
    }).catch(() => {});
  }, []);

  const changeDriver = (next: 'instabox' | 'e2b') => {
    setDriver(next);
    setBaseUrl(next === 'instabox' ? 'https://api.instabox.sh' : '');
    setMachineName((current) => current || 'moyubot-shared');
  };

  const nextProfile = async () => {
    setBusy(true); setError('');
    try {
      if (!name.trim()) throw new Error('先告诉我们，你希望被怎么称呼');
      await saveSettings({ userName: name, ui: { ...settings.ui, userAvatar: avatar }, onboarding: { step: 1 } });
      setStep(1);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };
  const nextCloud = async (skip: boolean) => {
    setBusy(true); setError('');
    try {
      if (!skip) {
        const label = driver === 'e2b' ? 'E2B' : 'InstaBox';
        if (!key.trim() && !secrets.cloudKey) throw new Error(`填写 ${label} API Key，或选择暂时跳过`);
        if (!machineName.trim()) throw new Error('请填写云电脑名称');
        // E2B 官方云允许留空 API 地址；InstaBox 必须填 HTTPS 地址。
        let resolvedBaseUrl = '';
        if (driver === 'instabox' || baseUrl.trim()) {
          const url = new URL(baseUrl.trim());
          if (url.protocol !== 'https:') throw new Error('云电脑 API 地址需要使用 HTTPS');
          resolvedBaseUrl = url.href.replace(/\/+$/, '');
        }
        await saveCloud({
          ...settings.cloud,
          driver,
          baseUrl: resolvedBaseUrl,
          machineName: machineName.trim(),
          templateId: driver === 'e2b' ? 'desktop' : 'agent-browser',
          ...(driver === 'e2b' ? { remoteWorkspaceDir: '/home/user/moyubot' } : {}),
        }, key.trim() || undefined);
        setKey('');
      }
      setSkipCloud(skip);
      await saveSettings({ onboarding: { step: 2, cloudSkipped: skip } });
      setStep(2);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };
  const pickDataDir = async () => {
    setBusy(true); setError('');
    try {
      const picked = await moyu().pickDirectory('选择数据与记忆存放位置', dataDir || dataFallback);
      if (picked) setDataDir(picked);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };
  const choose = async () => {
    setBusy(true); setError('');
    try {
      await chooseLocalDirectory();
      const boot = await moyu().bootstrap();
      setDirectory(boot.settings.workspaces.find((workspace) => workspace.kind === 'local')?.directory ?? directory);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };
  const finish = async () => {
    setBusy(true); setError('');
    try {
      await moyu().setupDirectory(directory);
      // 数据目录在进程启动时确定，改动后需要重启才生效；未改动时这里不写引导文件。
      if (dataDir.trim() && dataDir.trim() !== initialDataDir) {
        try {
          const saved = await moyu().setDataDir(dataDir.trim());
          if (saved.restartRequired) toast('数据目录已保存，重启 MoyuBot 后生效', 'info');
        } catch { /* 目录不可写时保持默认位置 */ }
      }
      await completeSetup(skipCloud);
    } catch (reason) { setError((reason as Error).message); setBusy(false); }
  };
  const uploadAvatar = async (file: File) => {
    setBusy(true); setError('');
    try { setAvatar({ ...avatar, imageDataUrl: await readAvatar(file) }); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  return <div className="setup-backdrop">
    <div className="setup-window-drag" aria-hidden="true" />
    {platform !== 'darwin' ? <div className="setup-window-controls win-controls">
      <button type="button" className="win-btn" aria-label="最小化引导窗口" onClick={() => void moyu().win('minimize')}><Icon name="minimize" size={14} /></button>
      <button type="button" className="win-btn win-btn--close" aria-label="关闭引导窗口" onClick={() => void moyu().win('close')}><Icon name="close" size={14} /></button>
    </div> : null}
    <div ref={dialog} className="setup-dialog" role="dialog" aria-modal="true" aria-labelledby="setup-title">
    <aside className="setup-sidebar"><div className="setup-brand"><img src={logo} alt="" /><span>MoyuBot<small>你的长期 AI 工作空间</small></span></div><div className="setup-steps">{STEPS.map((item, index) => <div key={item.label} className={`setup-step ${step === index ? 'is-current' : ''} ${step > index ? 'is-done' : ''}`} aria-current={step === index ? 'step' : undefined}><span><Icon name={step > index ? 'check' : item.icon} size={16} /></span><div><small>0{index + 1}</small><strong>{item.label}</strong></div></div>)}</div><p>几步简单设置，<br />让 Bot 从认识你开始。</p></aside>
    <main className="setup-main"><header><span>开始之前 · {step + 1} / 3</span><h1 id="setup-title">{step === 0 ? '我们该怎么称呼你？' : step === 1 ? '给 Bot 一台云电脑' : '选择文件与数据的存放位置'}</h1><p>{step === 0 ? '所有 Bot 都会知道你的名字，之后也可以在设置里修改。' : step === 1 ? 'InstaBox 或 E2B 提供桌面、浏览器和终端，工作区内的 Bot 共同使用。' : 'Bot 在这里整理文件、执行命令；会话、记忆与密钥也存在本机。'}</p></header>
    <div key={step} className="setup-content">
      {step === 0 ? <><div className="setup-profile"><UserAvatar value={avatar} className="setup-avatar" /><div><strong>{name.trim() || '你好，新朋友'}</strong><Button size="sm" variant="glass" icon="image" disabled={busy} onClick={() => upload.current?.click()}>上传头像</Button></div></div><label className="setup-field"><span>用户名</span><input className="input" aria-label="首次设置用户名" value={name} maxLength={40} disabled={busy} autoComplete="nickname" placeholder="你希望 Bot 怎么称呼你？" onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !busy && !event.nativeEvent.isComposing) void nextProfile(); }} /></label><fieldset disabled={busy} className="setup-avatar-choices"><legend>或者选一个喜欢的头像</legend><AvatarPicker value={avatar} onChange={setAvatar} /></fieldset><input type="file" ref={upload} hidden aria-label="首次设置上传头像" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void uploadAvatar(file); }} /></> : null}
      {step === 1 ? <><div className="setup-feature"><Icon name="cloud" size={27} /><div><strong>一个桌面，所有 Bot 协作</strong><p>需要时唤醒，空闲时休眠。支持实时观看与手动接管。</p></div></div><fieldset className="setup-driver" disabled={busy}><legend>云电脑驱动</legend><div className="setup-driver__options">{DRIVERS.map((item) => <button type="button" key={item.value} className={driver === item.value ? 'is-active' : ''} aria-pressed={driver === item.value} disabled={busy} onClick={() => changeDriver(item.value)}><strong>{item.label}</strong><small>{item.hint}</small></button>)}</div></fieldset><label className="setup-field"><span>云电脑名称</span><input className="input" aria-label="首次设置云电脑名称" value={machineName} disabled={busy} onChange={(event) => setMachineName(event.target.value)} /></label>{driver === 'e2b' ? <label className="setup-field"><span>API 地址（留空 = E2B 官方云）</span><input className="input mono" aria-label="首次设置云电脑 API 地址" value={baseUrl} disabled={busy} spellCheck={false} placeholder="留空使用 E2B 官方云；自建填你的地址" onChange={(event) => setBaseUrl(event.target.value)} /></label> : <label className="setup-field"><span>API 地址</span><input className="input mono" aria-label="首次设置云电脑 API 地址" value={baseUrl} disabled={busy} spellCheck={false} onChange={(event) => setBaseUrl(event.target.value)} /></label>}<label className="setup-field"><span>{driver === 'e2b' ? 'E2B' : 'InstaBox'} API Key</span><input className="input mono" aria-label="首次设置云电脑 API Key" type="password" value={key} disabled={busy} autoComplete="new-password" placeholder={secrets.cloudKey ? '已保存，留空保留' : driver === 'e2b' ? '粘贴你的 E2B 密钥（e2b_…）' : '粘贴你的 InstaBox 密钥'} onChange={(event) => setKey(event.target.value)} /></label><p className="setup-note"><Icon name="shield" size={13} />密钥仅保存在本机。此步骤保存配置，不会创建或唤醒云电脑。</p><div className="setup-skip"><strong>还没有云电脑？</strong><p>可以先用本机工作，随时在设置中连接。</p></div></> : null}
      {step === 2 ? <><div className="setup-feature"><Icon name="folder" size={27} /><div><strong>本地工作目录与数据</strong><p>工作目录放 Bot 的文件；数据目录存会话、记忆与密钥。</p></div></div><label className="setup-field"><span>本地工作目录</span><div className="setup-directory"><input className="input mono" aria-label="首次设置本地工作目录" value={directory} disabled={busy} spellCheck={false} onChange={(event) => setDirectory(event.target.value)} /><Button size="sm" icon="folder" disabled={busy} onClick={() => void choose()}>选择目录</Button></div></label><label className="setup-field"><span>数据与记忆存放位置</span><div className="setup-directory"><input className="input mono" aria-label="首次设置数据目录" value={dataDir} disabled={busy} spellCheck={false} placeholder={dataFallback || '默认安装目录下 data'} onChange={(event) => setDataDir(event.target.value)} /><Button size="sm" icon="folder" disabled={busy} onClick={() => void pickDataDir()}>选择目录</Button></div></label><p className="setup-note"><Icon name="check" size={13} />默认保存在安装目录下的 data 文件夹；会话、记忆、密钥都放在这里，更换后需重启生效。</p><div className="setup-summary"><div><span>你的称呼</span><strong>{settings.userName || name}</strong></div><div><span>云电脑</span><strong>{skipCloud ? '稍后连接' : `${driver === 'e2b' ? 'E2B' : 'InstaBox'} · 已保存`}</strong></div><div><span>开始使用</span><strong>{skipCloud ? '本地工作区' : '云电脑工作区'}</strong></div></div></> : null}
    </div>
    {error ? <p className="setup-error" role="alert"><Icon name="alert" size={14} />{error}</p> : null}
    <footer className="setup-footer">{step > 0 ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setStep(step === 2 ? 1 : 0); setError(''); }}>上一步</Button> : <span>之后可在设置中随时修改</span>}<div>{step === 1 ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => void nextCloud(true)}>暂时跳过</Button> : null}<Button variant="primary" size="sm" loading={busy} disabled={busy || step === 0 && !name.trim()} onClick={() => void (step === 0 ? nextProfile() : step === 1 ? nextCloud(false) : finish())}>{step === 2 ? '开启工作空间' : step === 1 ? '保存并继续' : '下一步'}</Button></div></footer>
    </main></div></div>;
}
