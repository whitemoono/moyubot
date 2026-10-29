import { useRef, useState } from 'react';
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

const STEPS = [{ label: '认识你', icon: 'users' }, { label: '云电脑', icon: 'cloud' }, { label: '本地目录', icon: 'folder' }] as const;

export function Onboarding() {
  const { settings, secrets, saveSettings, saveCloud, chooseLocalDirectory } = useMoyu();
  const [step, setStep] = useState<number>(settings.onboarding?.step ?? 0);
  const [name, setName] = useState(settings.userName ?? '');
  const [avatar, setAvatar] = useState<Avatar>(settings.ui.userAvatar ?? DEFAULT_USER_AVATAR);
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(settings.cloud.baseUrl);
  const [machineName, setMachineName] = useState(settings.cloud.machineName);
  const [skipCloud, setSkipCloud] = useState(!secrets.cloudKey);
  const [directory, setDirectory] = useState(settings.workspaces.find((workspace) => workspace.kind === 'local')?.directory ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  useDialogFocus(dialog, () => {});

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
        if (!key.trim() && !secrets.cloudKey) throw new Error('填写 InstaBox API Key，或选择暂时跳过');
        const url = new URL(baseUrl.trim());
        if (url.protocol !== 'https:') throw new Error('云电脑 API 地址需要使用 HTTPS');
        if (!machineName.trim()) throw new Error('请填写云电脑名称');
        await saveCloud({ ...settings.cloud, driver: 'instabox', baseUrl: url.href.replace(/\/+$/, ''), machineName: machineName.trim(), templateId: 'agent-browser' }, key.trim() || undefined);
        setKey('');
      }
      setSkipCloud(skip);
      await saveSettings({ onboarding: { step: 2 } });
      setStep(2);
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
      await moyu().finishSetup(skipCloud);
      window.location.reload();
    } catch (reason) { setError((reason as Error).message); setBusy(false); }
  };
  const uploadAvatar = async (file: File) => {
    setBusy(true); setError('');
    try { setAvatar({ ...avatar, imageDataUrl: await readAvatar(file) }); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  return <div className="setup-backdrop"><div ref={dialog} className="setup-dialog" role="dialog" aria-modal="true" aria-labelledby="setup-title">
    <aside className="setup-sidebar"><div className="setup-brand"><img src={logo} alt="" /><span>MoyuBot<small>你的长期 AI 工作空间</small></span></div><div className="setup-steps">{STEPS.map((item, index) => <div key={item.label} className={`setup-step ${step === index ? 'is-current' : ''} ${step > index ? 'is-done' : ''}`} aria-current={step === index ? 'step' : undefined}><span><Icon name={step > index ? 'check' : item.icon} size={16} /></span><div><small>0{index + 1}</small><strong>{item.label}</strong></div></div>)}</div><p>几步简单设置，<br />让 Bot 从认识你开始。</p></aside>
    <main className="setup-main"><header><span>开始之前 · {step + 1} / 3</span><h1 id="setup-title">{step === 0 ? '我们该怎么称呼你？' : step === 1 ? '给 Bot 一台云电脑' : '为本地工作选个位置'}</h1><p>{step === 0 ? '所有 Bot 都会知道你的名字，之后也可以在设置里修改。' : step === 1 ? '用 InstaBox 提供桌面、浏览器和终端，工作区内的 Bot 共同使用。' : 'Bot 在这里整理文件、执行命令。你的工作留在自己电脑上。'}</p></header>
    <div key={step} className="setup-content">
      {step === 0 ? <><div className="setup-profile"><UserAvatar value={avatar} className="setup-avatar" /><div><strong>{name.trim() || '你好，新朋友'}</strong><Button size="sm" variant="glass" icon="image" disabled={busy} onClick={() => upload.current?.click()}>上传头像</Button></div></div><label className="setup-field"><span>用户名</span><input className="input" aria-label="首次设置用户名" value={name} maxLength={40} disabled={busy} autoComplete="nickname" placeholder="你希望 Bot 怎么称呼你？" onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !busy && !event.nativeEvent.isComposing) void nextProfile(); }} /></label><fieldset disabled={busy} className="setup-avatar-choices"><legend>或者选一个喜欢的头像</legend><AvatarPicker value={avatar} onChange={setAvatar} /></fieldset><input type="file" ref={upload} hidden aria-label="首次设置上传头像" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void uploadAvatar(file); }} /></> : null}
      {step === 1 ? <><div className="setup-feature"><Icon name="cloud" size={27} /><div><strong>一个桌面，所有 Bot 协作</strong><p>需要时唤醒，空闲时休眠。支持实时观看与手动接管。</p></div></div><label className="setup-field"><span>云电脑名称</span><input className="input" aria-label="首次设置云电脑名称" value={machineName} disabled={busy} onChange={(event) => setMachineName(event.target.value)} /></label><label className="setup-field"><span>API 地址</span><input className="input mono" aria-label="首次设置云电脑 API 地址" value={baseUrl} disabled={busy} spellCheck={false} onChange={(event) => setBaseUrl(event.target.value)} /></label><label className="setup-field"><span>InstaBox API Key</span><input className="input mono" aria-label="首次设置云电脑 API Key" type="password" value={key} disabled={busy} autoComplete="new-password" placeholder={secrets.cloudKey ? '已保存，留空保留' : '粘贴你的 InstaBox 密钥'} onChange={(event) => setKey(event.target.value)} /></label><p className="setup-note"><Icon name="shield" size={13} />密钥仅保存在本机。此步骤保存配置，不会创建或唤醒云电脑。</p><div className="setup-skip"><strong>还没有云电脑？</strong><p>可以先用本机工作，随时在设置中连接。</p></div></> : null}
      {step === 2 ? <><div className="setup-feature"><Icon name="folder" size={27} /><div><strong>本地工作目录</strong><p>默认位于安装目录下的 workspace 子文件夹，也可以自行选择。</p></div></div><label className="setup-field"><span>文件保存位置</span><div className="setup-directory"><input className="input mono" aria-label="首次设置本地工作目录" value={directory} disabled={busy} spellCheck={false} onChange={(event) => setDirectory(event.target.value)} /><Button size="sm" icon="folder" disabled={busy} onClick={() => void choose()}>选择目录</Button></div></label><p className="setup-note"><Icon name="check" size={13} />完成后会检查写入权限，并自动创建文件夹。</p><div className="setup-summary"><div><span>你的称呼</span><strong>{settings.userName || name}</strong></div><div><span>云电脑</span><strong>{skipCloud ? '稍后连接' : '已保存配置'}</strong></div><div><span>开始使用</span><strong>{skipCloud ? '本地工作区' : '云电脑工作区'}</strong></div></div></> : null}
    </div>
    {error ? <p className="setup-error" role="alert"><Icon name="alert" size={14} />{error}</p> : null}
    <footer className="setup-footer">{step > 0 ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setStep(step === 2 ? 1 : 0); setError(''); }}>上一步</Button> : <span>之后可在设置中随时修改</span>}<div>{step === 1 ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => void nextCloud(true)}>暂时跳过</Button> : null}<Button variant="primary" size="sm" loading={busy} disabled={busy || step === 0 && !name.trim()} onClick={() => void (step === 0 ? nextProfile() : step === 1 ? nextCloud(false) : finish())}>{step === 2 ? '开启工作空间' : step === 1 ? '保存并继续' : '下一步'}</Button></div></footer>
    </main></div></div>;
}
