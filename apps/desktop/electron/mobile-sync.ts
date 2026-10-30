import fs from 'node:fs';
import path from 'node:path';
import { SyncClient, emptySyncState, syncKey, type Store, type CloudHost } from '@moyu/core';

import { normalizeSyncServer } from './sync-server';
export class MobileSync {
  client!: SyncClient;
  private timer?: ReturnType<typeof setInterval>;
  private seen = new Map<string, string>();
  private file: string;
  private configFile: string;
  private server = '';
  private running = false;
  private generation = 0;
  private setupKey = 'mobile:sync-setup-key';
  private secretKey = 'mobile:sync-session';
  constructor(private store: Store, private changed: () => void, private currentCloud?: () => Pick<CloudHost, 'getSettings' | 'refresh'> | undefined) {
    this.file = path.join(store.dataDir, 'mobile-sync.json');
    this.configFile = path.join(store.dataDir, 'mobile-sync-server.json');
    try { this.server = normalizeSyncServer(JSON.parse(fs.readFileSync(this.configFile,'utf8')).server); } catch { /* No default server. */ }
    let state = emptySyncState();
    try { state = { ...state, ...JSON.parse(fs.readFileSync(this.file,'utf8')) }; } catch { /* first run */ }
    // Never resume credentials from older builds that used an implicit hosted server.
    if (!this.server) { this.archive(); state = emptySyncState(); this.store.secrets.delete(this.secretKey); }
    this.createClient(state);
  }
  private archive() { if (fs.existsSync(this.file)) fs.copyFileSync(this.file,`${this.file}.backup-${Date.now()}`); }
  private createClient(state: ReturnType<typeof emptySyncState>) {
    const generation = ++this.generation;
    this.client?.stop(); this.seen.clear();
    const server = this.server;
    this.client = new SyncClient(state, {
      url: server, token: () => generation === this.generation && server ? this.session()?.token : undefined,
      save: data => { if (generation !== this.generation) return; const tmp = `${this.file}.tmp`; fs.writeFileSync(tmp, JSON.stringify(data)); fs.renameSync(tmp,this.file); },
      changed: () => {
        if (generation !== this.generation) return;
        this.capture();
        const records = Object.values(this.client.state.records).filter(r => !this.client.state.outbox[syncKey(r.collection,r.id)]);
        this.store.applySyncRecords(records);
        for (const r of records) this.seen.set(syncKey(r.collection,r.id),JSON.stringify(r.value));
        this.changed();
      },
    });
    for (const record of Object.values({ ...state.records, ...state.outbox })) this.seen.set(syncKey(record.collection, record.id),JSON.stringify(record.value));
    if (this.running && this.server) this.client.start();
  }
  private session(): { token: string; deviceId: string; workspace: string; server: string } | undefined {
    try { const session = JSON.parse(this.store.secrets.get(this.secretKey) || 'null'); return session?.server === this.server ? session : undefined; } catch { return undefined; }
  }
  private capture() {
    if (!this.server || !this.session()) return;
    const current = new Set<string>();
    for (const record of this.store.syncSnapshot()) {
      const key = syncKey(record.collection,record.id), json = JSON.stringify(record.value); current.add(key);
      if (this.seen.get(key) !== json) { this.client.put(record.collection,record.id,record.value); this.seen.set(key,json); }
    }
    for (const [key] of this.seen) {
      if (current.has(key)) continue;
      const split = key.indexOf('/'); this.client.put(key.slice(0,split),key.slice(split+1),null); this.seen.delete(key);
    }
  }
  start() { this.running = true; this.capture(); if (this.server) this.client.start(); this.timer = setInterval(() => this.capture(),1000); }
  stop() { this.running = false; if (this.timer) clearInterval(this.timer); this.capture(); this.client.stop(); }
  status() { return { server: this.server, configured: !!this.server, hasSetupKey: !!this.store.secrets.get(this.setupKey), connected: !!this.session(), enabled: this.client.state.enabled, pending: Object.keys(this.client.state.outbox).length, conflicts: this.client.state.conflicts.length, lastSync: this.client.state.lastSync, error: this.client.error, deviceId: this.session()?.deviceId }; }
  private async check(server: string) {
    const response = await fetch(`${server}/api/health`,{redirect:'error',signal:AbortSignal.timeout(10000)});
    const info = await response.json();
    if (!response.ok || info.service !== 'moyubot-sync' || !info.syncEnabled) throw new Error('服务器未开启私有同步服务，请检查部署配置');
    return {ok:true,server};
  }
  async configure(payload: {server: string; setupKey?: string}) {
    const server = normalizeSyncServer(payload.server || '');
    await this.check(server);
    if (server !== this.server) {
      this.client.setEnabled(false); this.archive();
      this.store.secrets.delete(this.secretKey); this.store.secrets.delete(this.setupKey);
      this.server = server;
      fs.writeFileSync(this.configFile,JSON.stringify({server}));
      this.createClient(emptySyncState());
    }
    if (payload.setupKey?.trim()) this.store.secrets.set(this.setupKey,payload.setupKey.trim());
    return this.status();
  }
  async pair() {
    if (!this.server) throw new Error('请先填写并保存你自己的服务器地址');
    if (!this.session()) {
      const key = this.store.secrets.get(this.setupKey);
      if (!key) throw new Error('请填写部署时设置的服务器连接密钥');
      const session = await this.client.api('/api/workspaces',{name:'MoyuBot 桌面端'},{'X-Setup-Key':key});
      this.store.secrets.set(this.secretKey,JSON.stringify({...session,server:this.server}));
    }
    const pair = await this.client.api('/api/pair',{});
    if (new URL(pair.url).origin !== this.server) throw new Error('服务器返回的二维码域名不一致，请检查 PUBLIC_ORIGIN');
    return pair;
  }
  async enable(enabled: boolean) { if (enabled && (!this.server || !this.session())) throw new Error('请先配置自己的服务器并生成连接二维码'); this.capture(); this.client.setEnabled(enabled); if (enabled) await this.client.sync(true); return this.status(); }
  private cloudSettings() { return this.currentCloud?.()?.getSettings() || this.store.getSettings().cloud; }
  private executionLocal() {
    const cloud = this.cloudSettings();
    const hasCredential = !!this.store.secrets.get('cloud:instabox');
    return {providers:this.store.getSettings().providers.map(p=>({id:p.id,name:p.name,models:p.models})),
      cloudConfigured:cloud.driver==='instabox' && hasCredential,
      cloudMachineName:cloud.machineName, cloudMachineId:cloud.machineId,
      cloudHint:cloud.driver!=='instabox'?'当前使用演示云电脑，请配置 InstaBox':!hasCredential?'请先在云电脑设置中保存 InstaBox 凭据':!cloud.machineId?'凭据已保存，授权时将识别当前云电脑':`已识别：${cloud.machineName}（${cloud.machineId}）`};
  }
  private async authorizeExecution(payload: {authorized?: boolean; providerIds?: string[]; cloud?: boolean}) {
    if (!this.server || !this.session()) throw new Error('请先保存服务器并生成连接二维码');
    if (payload.authorized !== true || !Array.isArray(payload.providerIds)) throw new Error('请选择并明确授权上传到当前服务器');
    const settings = this.store.getSettings();
    const providers = settings.providers.filter(p => payload.providerIds!.includes(p.id)).map(p => {
      const { networkMode: _localNetwork, ...config } = p;
      return {...config,credential:this.store.secrets.get(this.store.providerSecretKey(p.id)) || ''};
    });
    let cloud;
    if (payload.cloud) {
      const credential = this.store.secrets.get('cloud:instabox');
      let current = this.cloudSettings();
      if (current.driver !== 'instabox' || !credential) throw new Error('请先在云电脑设置中保存 InstaBox 凭据');
      if (!current.machineId) {
        const host = this.currentCloud?.();
        const status = await host?.refresh();
        current = this.cloudSettings();
        if (!current.machineId) throw new Error(status?.lastError || '尚未识别到云电脑，请先在云电脑页面刷新或创建机器');
      }
      const { workspaceDir: _localPath, ...remote } = current;
      cloud = {settings:remote,credential};
    }
    return this.client.api('/api/execution/config',{authorized:true,providers,cloud:cloud || null,bots:settings.bots.map(b=>({id:b.id,tools:b.tools,workspaceId:b.workspaceId}))});
  }
  async action(action: string, payload?: any) {
    if (action === 'status') return this.status();
    if (action === 'configure') return this.configure(payload);
    if (action === 'test') return this.check(normalizeSyncServer(payload?.server || ''));
    if (action === 'execution-local') return this.executionLocal();
    if (action === 'execution-status') return this.session() ? this.client.api('/api/execution/config') : {providers:[],cloud:null};
    if (action === 'execution-authorize') return this.authorizeExecution(payload);
    if (action === 'execution-revoke') return this.client.api('/api/execution/revoke',{});
    if (action === 'pair') return this.pair();
    if (action === 'pending') return this.session() ? this.client.api('/api/pair/pending') : {pairs:[]};
    if (action === 'confirm') { await this.client.api('/api/pair/confirm',{id:payload.id}); return {ok:true}; }
    if (action === 'enable') return this.enable(payload.enabled === true);
    if (action === 'devices') return this.session() ? this.client.api('/api/devices') : {devices:[]};
    if (action === 'revoke') return this.client.api('/api/devices/revoke',{id:payload.id});
    if (action === 'sync') { this.capture(); await this.client.sync(true); return this.status(); }
    if (action === 'conflicts') return this.client.state.conflicts;
    if (action === 'restore') { this.client.restoreConflict(payload.index); return this.status(); }
    throw new Error('未知的设备连接操作');
  }
}
