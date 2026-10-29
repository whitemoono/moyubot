/* Capture the current built application with an isolated, non-executing demo bridge. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{once}=require('node:events');
const repo=path.resolve(__dirname,'../..'),out=path.join(__dirname,'output','ui');fs.mkdirSync(out,{recursive:true});
const {defaultSettings}=require(path.join(repo,'packages/core/dist'));
const {chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const server=require('../moyubot-film/serve.cjs');
const portraits=[['chibi','大肥鱼','#5890f0'],['nemu','千金','#a8b8fd'],['shiro','小龙娘','#cdbfef'],['mikan','大小姐','#f7844c'],['neko','小猫娘','#91a7f7'],['tsuki','雌小鬼','#f6d7b4'],['zeta','夜猫','#343542']];
let browser;
(async()=>{
 const settings=defaultSettings(path.join(repo,'.work/film-demo'));
 settings.ui={...settings.ui,appearance:'light',accent:'#5890f0',reduceMotion:true};
 settings.providers=[{id:'deepseek',name:'DeepSeek',kind:'openai',baseUrl:'https://api.deepseek.com/v1',defaultModel:'deepseek-chat',models:['deepseek-chat','deepseek-reasoner'],createdAt:1},{id:'openai',name:'OpenAI',kind:'openai',baseUrl:'https://api.openai.com/v1',defaultModel:'gpt-4.1',models:['gpt-4.1'],createdAt:1}];
 const base=settings.bots[0];
 settings.bots=['local','cloud'].flatMap(kind=>portraits.map(([shape,name,color],i)=>({...base,id:`${kind}-${i}`,workspaceId:`workspace_${kind}`,name,handle:`${kind}-${shape}`,providerId:i%2?'openai':'deepseek',model:i%2?'gpt-4.1':'deepseek-chat',avatar:{shape,from:color,to:color,glyph:name[0]},approvalPolicy:kind==='local'?'ask':'never',tools:['cloud_exec','cloud_read','cloud_write','remember','recall','schedule_task','web_fetch','generate_image'],sidebar:{pinned:i===0,hidden:i===6,group:i===1?'常用':''}})));
 settings.workspaces=[{id:'workspace_local',name:'本地工作区',kind:'local',computerName:'本机 Windows',rootDir:'D:\\MoyuWorkspace',createdAt:1,activeBotId:'local-1'},{id:'workspace_cloud',name:'云电脑工作区',kind:'cloud',computerName:'共享云电脑',rootDir:'/data/moyubot',createdAt:1,activeBotId:'cloud-0'}];
 settings.activeWorkspaceId='workspace_local';settings.activeBotId='local-1';settings.activeView='chat';settings.cloud={...settings.cloud,workspaceDir:'/data/moyubot',driver:'mock'};
 const conversations=settings.bots.map(bot=>({id:`conv-${bot.id}`,botId:bot.id,workspaceId:bot.workspaceId,title:bot.name,createdAt:1,updatedAt:1,messages:[],context:undefined}));
 const memories=[{id:'memory-1',botId:'local-1',text:'报告用中文，先给结论，再给依据。',createdAt:1,updatedAt:1},{id:'memory-2',botId:'local-1',text:'每周整理项目进展，关注下一步待办。',createdAt:1,updatedAt:1}];
 const schedules=[{id:'routine-1',botId:'local-1',cron:'0 9 * * 1-5',prompt:'整理工作区中的项目进展并汇报。',enabled:true,status:'active',nextRunAt:Date.now()+86400000,createdAt:1,updatedAt:1},{id:'routine-2',botId:'local-1',cron:'0 18 * * 5',prompt:'汇总本周待办和下周计划。',enabled:true,status:'active',nextRunAt:Date.now()+86400000*2,createdAt:1,updatedAt:1}];
 server.listen(0,'localhost');await once(server,'listening');
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1120,height:1000},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(({settings,conversations,memories,schedules})=>{
  const clone=x=>structuredClone(x),listeners={event:[],cloud:[],local:[]};let state=settings;
  let cloud={state:'suspended',awakeMs:0,wakeCount:0,lastTransitionAt:Date.now()};const local={state:'ready',awakeMs:0,wakeCount:0,lastTransitionAt:Date.now()};
  const list=()=>conversations.map(({messages,...rest})=>({...rest,preview:''}));
  window.moyu={platform:'win32',isElectron:true,
   bootstrap:async()=>clone({settings:state,cloud,conversations:list(),schedules,memories,runningConversations:[],platform:'win32',version:'0.1.0',secrets:{providerKeys:{},cloudKey:false,telegramToken:false,encrypted:true}}),
   local:async()=>clone(local),cloud:async()=>clone(cloud),saveSettings:async patch=>{state={...state,...patch};return clone(state);},
   conversations:async()=>clone(list()),botConversation:async id=>clone(conversations.find(c=>c.botId===id)),conversation:async id=>clone(conversations.find(c=>c.id===id)),
   schedules:async()=>clone(schedules),memories:async id=>clone(memories.filter(m=>!id||m.botId===id)),
   onEvent:fn=>{listeners.event.push(fn);return()=>{};},onCloud:fn=>{listeners.cloud.push(fn);return()=>{};},onLocal:fn=>{listeners.local.push(fn);return()=>{};},
   localExec:async()=>({stdout:'演示输出 · 文件目录已就绪\nweekly\nreports',stderr:'',exitCode:0}),cloudExec:async()=>({stdout:'演示输出 · /data/moyubot\nweekly  reports',stderr:'',exitCode:0}),
   cloudAction:async action=>{cloud={...cloud,state:action==='sleep'?'suspended':'ready'};listeners.cloud.forEach(fn=>fn(clone(cloud)));return clone(cloud);},
   win:async()=>{},openExternal:async()=>{},checkForUpdates:async()=>({status:'unpublished'}),
   usage:async()=>({totals:{promptTokens:0,completionTokens:0,totalTokens:0,cachedTokens:0,cacheInputTokens:0,cacheReportedCalls:0,calls:0,reportedCalls:0,compactionCalls:0,historicalCalls:0},bots:[],models:[],options:{bots:[],models:[]},buckets:[]}),
  };
 },{settings,conversations,memories,schedules});
 await page.goto(`http://localhost:${server.address().port}/apps/desktop/dist/`);
 await page.waitForSelector('.workspace-switcher');await page.waitForFunction(()=>getComputedStyle(document.querySelector('.app')).display==='flex');await page.waitForTimeout(500);await page.screenshot({path:path.join(out,'local.png')});
 await page.getByRole('button',{name:'工作区终端',exact:true}).click();
 await page.getByRole('textbox',{name:'工作区终端命令',exact:true}).fill('Get-ChildItem');await page.getByRole('textbox',{name:'工作区终端命令',exact:true}).press('Enter');await page.waitForTimeout(200);
 await page.screenshot({path:path.join(out,'local-terminal.png')});
 await page.getByRole('button',{name:'对话详情与记忆',exact:true}).click();await page.waitForTimeout(150);
 await page.getByRole('tab',{name:'资料库',exact:true}).click();await page.waitForTimeout(150);await page.screenshot({path:path.join(out,'memory.png')});
 await page.getByRole('tab',{name:'详情',exact:true}).click();await page.waitForTimeout(150);await page.screenshot({path:path.join(out,'tasks.png')});
 await page.getByRole('button',{name:'关闭详情',exact:true}).click();
 await page.locator('.workspace-switcher').getByRole('button',{name:'云电脑',exact:true}).click();await page.waitForTimeout(250);await page.screenshot({path:path.join(out,'cloud-sleep.png')});
 if(errors.length)throw new Error(errors.join('\n'));
 fs.writeFileSync(path.join(out,'capture-report.json'),JSON.stringify({source:'apps/desktop/dist',capturedAt:new Date().toISOString(),bridge:'isolated mock; no commands, secrets or user data accessed',files:['local.png','local-terminal.png','memory.png','tasks.png','cloud-sleep.png']},null,2));
 console.log('Captured current local/cloud workspace, command panel, memory and routines UI.');
 await browser.close();server.close();
})().catch(async e=>{console.error(e);await browser?.close();server.close();process.exitCode=1;});
