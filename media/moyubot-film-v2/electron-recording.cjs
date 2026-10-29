/* Isolated recording instance: real application backend, real InstaBox and model APIs.
 * Only the existing encrypted credentials are reused; personal conversations are excluded.
 */
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const repo=path.resolve(__dirname,'../..'),work=path.join(repo,'.work','film-v2');
app.setPath('userData',path.join(work,'electron'));
app.disableHardwareAcceleration();
let backend,server;
app.whenReady().then(async()=>{
 const {defaultSettings}=require(path.join(repo,'packages/core/dist'));
 const original=JSON.parse(fs.readFileSync(path.join(repo,'.work/demo-data/settings.json'),'utf8'));
 const data=path.join(work,'data');fs.mkdirSync(data,{recursive:true});
 if(!fs.existsSync(path.join(data,'settings.json'))){
  const s=defaultSettings(data);s.onboarding={step:2,completedAt:Date.now()};s.userName='Moyu';
  s.providers=original.providers.map(p=>({...p}));s.ui={...s.ui,appearance:'light',reduceMotion:false,accent:'#5890f0'};
  s.cloud={...original.cloud,workspaceDir:path.join(data,'workspace'),idleSuspendMinutes:30};
  const shapes=[['chibi','大肥鱼','#5890f0'],['nemu','千金','#a8b8fd'],['shiro','小龙娘','#cdbfef'],['mikan','大小姐','#f7844c'],['neko','小猫娘','#91a7f7'],['tsuki','雌小鬼','#f6d7b4'],['zeta','夜猫','#343542']];
  const base=s.bots[0];s.bots=['cloud','local'].flatMap(kind=>shapes.map(([shape,name,color],i)=>({...base,id:`film-${kind}-${i}`,workspaceId:`workspace_${kind}`,name,handle:`${kind}-${shape}`,providerId:'rightai',model:s.providers.find(p=>p.id==='rightai').defaultModel,systemPrompt:'你是 {bot_name}，MoyuBot 产品演示助手。用简短中文回复。用户指定的工具任务应真实执行后汇报。只访问本次演示明确指定的文件和网页，不列出其他目录，不读个人文件。不要安装依赖。每次工具执行前遵循确认设置。',approvalPolicy:'ask',avatar:{shape,from:color,to:color,glyph:name[0]},sidebar:{pinned:i===0,hidden:false,group:''},tools:['cloud_exec','cloud_read','cloud_write','web_fetch','remember','recall','schedule_task'],image:{...base.image,wakeHost:false}})));
  s.activeWorkspaceId='workspace_cloud';s.activeBotId='film-cloud-0';s.activeView='chat';
  s.workspaces=s.workspaces.map(w=>({...w,activeBotId:`film-${w.kind}-0`,...(w.kind==='local'?{directory:path.join(work,'local-demo')}:{})}));
  fs.writeFileSync(path.join(data,'settings.json'),JSON.stringify(s,null,2));
  fs.copyFileSync(path.join(repo,'.work/demo-data/secrets.bin.json'),path.join(data,'secrets.bin.json'));
 }
 const {MoyuApp}=require(path.join(repo,'apps/desktop/dist-electron/app.js'));
 const {startRendererServer}=require(path.join(repo,'apps/desktop/dist-electron/renderer-server.js'));
 backend=new MoyuApp(data,'0.1.0');global.filmBackend=backend;backend.start();
 server=await startRendererServer(path.join(repo,'apps/desktop/dist'));
 const win=new BrowserWindow({width:1600,height:900,show:true,frame:false,webPreferences:{preload:path.join(repo,'apps/desktop/dist-electron/preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
 backend.setWindow(win);await win.loadURL(server.url);
});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{backend?.dispose();server?.close();});
