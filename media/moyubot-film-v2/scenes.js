// All product scenes are Canvas vectors; no screenshot or captured interface is used.
(() => {
 const W=1920,H=1080,TAU=Math.PI*2,ink='#17263f',blue='#3270ea',paper='#f5f6f8',muted='#79869b';
 const bots=[['chibi','大肥鱼','#5890f0'],['nemu','千金','#a8b8fd'],['shiro','小龙娘','#cdbfef'],['mikan','大小姐','#f7844c'],['neko','小猫娘','#91a7f7'],['tsuki','雌小鬼','#f6d7b4'],['zeta','夜猫','#343542']];
 const canvas=document.querySelector('#film'),c=canvas.getContext('2d');let geo={},images={},story;
 const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n)),ease=n=>1-Math.pow(1-clamp(n),3),smooth=n=>{n=clamp(n);return n*n*(3-2*n);},mix=(a,b,p)=>a+(b-a)*p;
 function rr(x,y,w,h,r=14,fill,stroke){c.beginPath();c.roundRect(x,y,w,h,r);if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=1.5;c.stroke();}}
 function txt(s,x,y,size=26,color=ink,weight=500,align='left',font='"Microsoft YaHei",sans-serif'){c.font=`${weight} ${size}px ${font}`;c.fillStyle=color;c.textAlign=align;c.textBaseline='alphabetic';c.fillText(s,x,y);}
 function center(s,x,y,size=26,color=ink,weight=500){txt(s,x,y,size,color,weight,'center');}
 function dot(x,y,r,color){c.beginPath();c.arc(x,y,r,0,TAU);c.fillStyle=color;c.fill();}
 function line(x,y,X,Y,color='#dce1e8',width=1){c.beginPath();c.moveTo(x,y);c.lineTo(X,Y);c.strokeStyle=color;c.lineWidth=width;c.stroke();}
 function pill(s,x,y,fill='#ebf0fb',color='#5676ad',size=18){c.font=`600 ${size}px "Microsoft YaHei",sans-serif`;const w=c.measureText(s).width+30;rr(x,y,w,38,19,fill);center(s,x+w/2,y+25,size,color,600);return w;}
 function cover(t,dark=false,accent=0){c.fillStyle=dark?'#111c30':paper;c.fillRect(0,0,W,H);const g=c.createRadialGradient(1250+Math.sin(t*.23)*40,260,20,1140,410,1150);g.addColorStop(0,dark?'#29457172':['#e1eaff','#fce8da','#e4defb'][accent%3]);g.addColorStop(1,dark?'#111c3000':paper+'00');c.fillStyle=g;c.fillRect(0,0,W,H);c.fillStyle=dark?'#ffffff12':'#263a5412';for(let x=54;x<W;x+=42)for(let y=45;y<H;y+=42)c.fillRect(x,y,1.2,1.2);}
 function top(t,dark=false,label='YOUR AI WORKSPACE'){c.drawImage(images.logo,78,43,46,46);txt('MoyuBot',138,76,28,dark?'#f2f5fa':ink,700);txt(label,1840,73,16,dark?'#96a8c3':muted,600,'right');line(78,108,1842,108,dark?'#ffffff20':'#20334b22');}
 function group(t,start,fn){let p=ease((t-start)/.48);if(!p)return;c.save();c.globalAlpha*=p;c.translate(0,(1-p)*26);fn(p);c.restore();}
 function card(x,y,w,h,fill='#fff',stroke='#e4e8ee'){c.save();c.shadowColor='#1c335018';c.shadowBlur=32;c.shadowOffsetY=12;rr(x,y,w,h,18,fill,stroke);c.restore();}
 function avatar(i,x,y,size,t,expression='idle'){
  const [shape,,color]=bots[i],g=geo[shape];if(!g)return;
  const ph=t*2.7+i*1.2,bob=Math.sin(ph)*2.4,blink=(t+i*.71)%4.1<.14?Math.max(.08,Math.abs((t+i*.71)%4.1-.07)/.07):1;
  c.save();c.globalAlpha*=1;c.translate(x,y+bob);c.rotate(Math.sin(ph*.42)*.024);c.scale(size/245,size/245);c.translate(-114.5,-114.5);c.fillStyle=color;c.fill(g.path);g.decals.forEach(d=>{c.fillStyle=d.fill;c.fill(d.path,d.rule||'nonzero');});
  const f=g.face;if(f)f.anchors.forEach(([ex,ey],j)=>{c.save();c.translate(ex,ey);c.fillStyle=f.ink||'#1a1a1f';c.strokeStyle=f.ink||'#1a1a1f';if(expression==='happy'){c.beginPath();c.moveTo(-f.rx,2);c.quadraticCurveTo(0,-f.ry*.55,f.rx,2);c.stroke();}else if(expression==='sleepy'){c.beginPath();c.moveTo(-f.rx,1);c.quadraticCurveTo(0,5,f.rx,1);c.stroke();}else{c.scale(1,blink);rr(-f.rx,-f.ry,f.rx*2,f.ry*2,Math.min(4,f.rx),f.ink||'#1a1a1f');}c.restore();});
  if(f&&expression==='happy'){const x=(f.anchors[0][0]+f.anchors[1][0])/2,y=f.anchors[0][1]+26;c.beginPath();c.moveTo(x-4,y);c.quadraticCurveTo(x,y+5,x+4,y);c.strokeStyle=f.ink;c.lineWidth=2;c.stroke();}c.restore();
 }
 function avatarCard(i,x,y,t,sz=125){card(x,y,207,220);rr(x+18,y+18,171,150,14,bots[i][2]+'22');avatar(i,x+103.5,y+100,sz,t,i===1?'sleepy':'happy');center(bots[i][1],x+103,y+199,20,ink,600);}
 function baseWindow(){rr(170,145,1580,776,16,'#fbfcfd','#cad1dc');rr(170,145,1580,47,16,'#f1f3f6');c.fillStyle='#f1f3f6';c.fillRect(170,172,1580,20);['#ff695f','#ffbf46','#39c756'].forEach((q,i)=>dot(198+i*24,169,6,q));txt('MoyuBot Desktop',274,175,16,'#566176');dot(905,169,4,'#53bd91');txt('云电脑已就绪',919,175,14,'#6e809a');['—','□','×'].forEach((q,i)=>center(q,1687+i*24,175,17,'#778399'));
  c.fillStyle='#f5f6f8';c.fillRect(170,192,278,729);line(448,192,448,921);txt('⌕',195,239,24,'#8793a5');txt('＋',405,239,22,'#8793a5');rr(189,260,242,39,10,'#e9eef7');txt('▱  本地',204,286,15,'#77859a');txt('☁  云电脑',309,286,15,blue,600);
  bots.forEach((b,i)=>{const y=326+i*77;avatar(i,220,y+19,45,t);txt(b[1],255,y+16,16,ink,i===0?600:500);txt(i===0?'等你安排任务':'还没有消息，和我聊聊吧',255,y+39,12,'#8792a3');});
  txt('◎',201,880,18,'#8390a3');txt('本地用户',229,880,14,'#718099');}
 function topChat(name='大肥鱼',model='deepseek-flash'){
  card(905,207,215,47,'#fff','#e4e8ee');avatar(0,933,231,34,0);txt(name,962,237,15,ink,600);
  center('☾',960,375,24,'#5380df',600);center('一点灵感，无限可能',960,412,14,'#929aaa');center('今天，想做点什么？',960,488,34,'#303c50',500);center(`我是 ${name}。陪你思考，也替你动手。`,960,530,17,'#929aaa');
  rr(585,589,750,52,26,'#fff','#d6dce5');txt('＋',606,623,22,'#8793a5');txt(`和 ${name} 说点什么…`,659,622,17,'#8893a3');txt(model,1250,621,14,'#62718a');dot(1302,615,17,blue);center('↑',1302,622,19,'#fff');
  ['创作一张图','运行一段代码','整理工作文件','安排定时任务'].forEach((s,i)=>{rr(635+i*165,663,153,39,20,'#fff','#dce2e9');center(s,711+i*165,688,12,'#79879c');});center('Enter 发送 · Shift + Enter 换行 · 支持粘贴或拖入图片',960,739,12,'#9aa3b2');
  txt('☁',777,860,15,'#8793a4');txt('工作区内的 Bot 共用一台云电脑 · 需要时唤醒，空闲时休眠',800,860,12,'#8894a5');}
 function brand(t,end=false){cover(t);top(t,false,'OPEN SOURCE / MOYUBOT v0.1.0');
  group(t,.15,()=>{c.drawImage(images.logo,830,142,150,150);center('MoyuBot',960,355,79,ink,700);center('让 AI 上班，你负责摸鱼。',960,412,34,blue,600);});
  bots.forEach((b,i)=>group(t,.52+i*.11,()=>avatarCard(i,176+i*224,468,t)));
  group(t,1.30,()=>{
   rr(240,742,1440,77,17,'#182842');txt('官网',277,790,18,'#a8b8d4',600);center('moyubot.net',960,791,38,'#fff',650);
   rr(240,834,1440,57,15,'#fff','#dce2ea');txt('GitHub',276,870,15,muted,600);center('github.com/whitemoono/moyubot',983,872,27,ink,600);
  });
 }
 function titleBlock(kicker,a,b,t,dark=false){group(t,.08,()=>txt(kicker,84,195,19,dark?'#97b8f8':blue,600));group(t,.22,()=>txt(a,84,294,61,dark?'#f7f9fc':ink,700));if(b)group(t,.37,()=>txt(b,84,369,61,dark?'#a7c4ff':blue,700));}
 function hook(t){cover(t,true);top(t,true,'OPEN SOURCE / 2026');
  const p=ease(t/1.5),scan=(t*.22)%1;c.save();c.globalAlpha=.12;c.fillStyle='#a9c5ff';c.fillRect(0,170+scan*690,W,80);c.restore();
  group(t,.2,()=>pill('GROK-INSPIRED · OPEN SOURCE',85,216,'#283d63','#bfd1f1',19));
  group(t,.55,()=>txt('Grok？',81,415,104,'#fff',700));group(t,1.0,()=>txt('开源复刻项目',83,530,83,'#a9c6ff',700));
  group(t,1.45,()=>{txt('MoyuBot',87,648,55,'#fff',700);pill('v0.1.0  正式上线',87,686,'#263a5d','#d1dff9',20);});
  bots.forEach((b,i)=>group(t,1.1+i*.09,()=>{const x=1330+i*70,y=570+Math.sin(t*2+i)*9;avatar(i,x,y,120,t,'happy');}));
 }
 function product(t){cover(t,false,0);top(t);titleBlock('01 / YOUR AI WORKSPACE','本地 Windows，或 InstaBox','一群 Bot，共用自己的电脑。',t);
  baseWindow();
  group(t,.45,()=>{rr(1332,212,354,675,15,'#fff','#e1e5eb');center('当前工作区 · 云电脑',1509,255,17,ink,600);line(1357,280,1662,280);center('Bot 管理',1509,324,15,muted,600);
   bots.forEach((b,i)=>{const y=366+i*70;avatar(i,1395,y,48,t);txt(b[1],1436,y+6,17,ink,600);pill(i===0?'对话中':'已就绪',1523,y-14,'#edf4ff','#6683bd',13);line(1362,y+32,1658,y+32,'#e9edf2');});
  });
  group(t,.65,()=>{pill('本地工作区',144,841);pill('云电脑工作区',299,841,'#e7ecfa',blue);});
 }
 function conversation(t){cover(t,true,1);top(t,true,'02 / ASK. ACT. VERIFY.');titleBlock('一句话，开始动手。','接入你选择的模型','命令 · 文件 · 网页工具',t,true);baseWindow();
  rr(550,750,1110,152,14,'#101b2d','#34445d');txt('和 大肥鱼 说点什么…',581,780,15,'#b3bfd1');
  const msg='请整理本周项目文件，并生成一份简报。';const n=Math.floor(clamp((t-.5)/1.2)*[...msg].length);rr(771,285,724,66,16,'#edf3ff');txt([...msg].slice(0,n).join(''),804,328,23,ink,500);
  if(t>1.9){rr(540,375,831,128,17,'#fff','#e2e7ee');avatar(0,582,423,52,t,'happy');txt('收到。我先检查当前工作区，然后整理文件并生成简报。',623,422,19,ink);txt('正在调用工作区工具…',623,460,15,blue);}
  if(t>2.8){rr(570,523,712,136,13,'#111c30','#2f405e');txt('$ mkdir -p weekly/reports',596,563,18,'#b3c3da',500,'left','Consolas,monospace');txt('$ python3 report.py --week current',596,594,18,'#a9c6ff',500,'left','Consolas,monospace');const n2=Math.floor(clamp((t-3)/1.1)*37);txt('✓ 已创建 weekly/reports/summary.md'.slice(0,n2),596,628,16,'#8ddcb8',600,'left','Consolas,monospace');}
  if(t>5.8){rr(1294,523,322,136,12,'#eff8f3','#d4ebdf');center('任务完成',1455,562,19,'#34895d',600);center('文件已写入云电脑工作区',1455,598,15,'#526a60');center('在对话中可查看结果',1455,628,14,'#829187');}
 }
 function settingsSidebar(active){rr(170,145,1580,776,16,'#fbfcfd','#cad1dc');rr(170,145,1580,47,16,'#f1f3f6');c.fillStyle='#f1f3f6';c.fillRect(170,172,1580,20);['#ff695f','#ffbf46','#39c756'].forEach((q,i)=>dot(198+i*24,169,6,q));txt('MoyuBot Desktop · 设置',274,175,16,'#566176');c.fillStyle='#f7f8fa';c.fillRect(170,192,299,729);['通用','个人资料','Bot 管理','模型供应商','共享云电脑','用量','反馈与帮助'].forEach((s,i)=>{const y=255+i*56;if(s===active)rr(186,y-27,267,44,9,'#e8eefb');txt(['⚙','◉','◫','◇','☁','▥','?'][i],202,y+1,16,s===active?blue:muted);txt(s,235,y+1,16,s===active?blue:'#69778d',s===active?600:400);});
 }
 function connect(t){cover(t,false,2);top(t);titleBlock('03 / THREE QUICK STEPS','InstaBox，几步接好','注册 · 创建云电脑 · 连接 MoyuBot',t);baseWindow();
  // Browser window starts on the InstaBox account page and moves to machine creation.
  group(t,.08,()=>{rr(478,225,1190,607,15,'#fff','#cbd3df');rr(478,225,1190,44,15,'#eff2f6');c.fillStyle='#eff2f6';c.fillRect(478,251,1190,18);dot(502,247,6,'#ff655e');dot(522,247,6,'#ffc04d');dot(542,247,6,'#40c967');rr(570,235,820,25,12,'#fff');txt('https://instabox.sh/dashboard',590,253,12,'#657189',400,'left','Consolas,monospace');
   txt('InstaBox',519,316,22,ink,700);pill('Cloud machines',1408,291,'#eaf0fc',blue,14);line(519,341,1628,341);txt('Create your first machine',550,402,29,ink,650);txt('Choose a template to get started',550,436,15,muted);rr(550,465,506,112,15,'#eef4ff','#7ba0ed');txt('agent-browser',579,509,21,ink,600);txt('Desktop · Chromium · Browser tools',579,541,15,muted);rr(1119,693,182,51,12,blue);center('Create machine',1210,726,16,'#fff',600);
  });
  if(t>2.2){group(t,2.0,()=>{rr(1111,687,197,64,14,'#5991fa36');rr(1119,693,182,51,12,blue);center('Create machine',1210,726,16,'#fff',600);mouse(1194,719,t);});}
  if(t>3.1){rr(1542,365,104,115,12,'#eef6f0','#dbe9dd');center('RUNNING',1594,408,13,'#328251',600);center('4 vCPU',1594,440,15,ink,600);center('8 GB',1594,460,14,muted);}
  if(t>4){const k=t-4;settingsPanel(k);}
  if(t>8.8){group(t,8.8,()=>{rr(1162,331,316,50,12,'#e8f7ee','#b6dfc3');dot(1188,356,6,'#33a260');txt('InstaBox 云电脑 · 在线',1206,362,16,'#347b4d',600);});}
  if(t>9.9){const arr=[[100,'注册 InstaBox','创建账户并新建 agent-browser 云电脑'],[186,'获取 API Key','从 InstaBox 账户安全地复制密钥'],[272,'设置 → 共享云电脑','粘贴密钥、保存，再刷新机器列表']];arr.forEach(([y,a,b],i)=>{dot(121,y,20,'#e8eefb');center(String(i+1),121,y+6,17,blue,700);txt(a,160,y+4,20,ink,600);txt(b,430,y+4,15,'#718198');});}
 }
 function settingsPanel(t){
  rr(508,277,1080,505,17,'#fff','#dce2e9');txt('共享云电脑',550,329,26,ink,650);txt('工作区内的 Bot 共用一台云电脑',550,359,15,muted);line(548,383,1550,383);
  txt('运行环境',551,421,14,muted);rr(550,437,454,44,9,'#fff','#dce2ea');txt('InstaBox',569,466,16,ink,500);txt('⌄',974,466,16,muted);
  txt('环境模板',1051,421,14,muted);rr(1048,437,491,44,9,'#fff','#dce2ea');txt('agent-browser',1067,466,16,ink,500);txt('⌄',1508,466,16,muted);
  txt('InstaBox API Key',552,518,14,muted);rr(550,534,989,47,9,'#fff','#dce2ea');const shown=t>.8?Math.min(30,Math.floor((t-.8)*23)):0;txt('•'.repeat(shown),572,564,19,'#354158',500,'left','Consolas,monospace');txt('眼睛已隐藏',1474,562,12,'#919bad');
  txt('云端工作目录',552,618,14,muted);rr(550,634,989,42,9,'#fff','#dce2ea');txt('/data/home/moyubot',570,661,14,'#546278',400,'left','Consolas,monospace');
  pill('密钥只在本机加密保存',550,698,'#eff5ef','#3e875b',13);rr(1354,701,185,47,10,blue);center(t<7.7?'保存设置':'刷新机器列表',1446,731,15,'#fff',600);if(t>7){mouse(1429,725,t);}
 }
 function mouse(x,y,t){c.save();c.translate(x+Math.sin(t*2)*7,y+Math.cos(t*1.8)*5);c.beginPath();c.moveTo(0,0);c.lineTo(0,29);c.lineTo(8,22);c.lineTo(13,34);c.lineTo(19,31);c.lineTo(14,20);c.lineTo(26,20);c.closePath();c.fillStyle='#fff';c.fill();c.strokeStyle='#25334b';c.lineWidth=2;c.stroke();c.restore();}
 function bot(t){cover(t,true,0);top(t,true,'04 / YOUR BOT, YOUR RULES');titleBlock('配置模型、权限和工具','再开始对话。','模型供应商需要单独配置。',t,true);baseWindow();
  rr(497,207,1113,655,16,'#fff','#d6deea');txt('Bot 管理',537,256,24,ink,650);pill('保存更改',1472,224,blue,'#fff',15);line(531,278,1574,278);
  avatar(0,588,347,118,t,'happy');center('大肥鱼',588,433,17,ink,600);txt('身份',759,324,14,muted);rr(759,340,690,42,9,'#fff','#dce2e8');txt('大肥鱼',778,367,16,ink);
  txt('模型供应商',759,422,14,muted);rr(759,437,338,43,9,'#fff','#dce2e8');txt(t<2.6?'RightAI':'DeepSeek',779,465,16,ink,500);txt('⌄',1064,464,15,muted);
  txt('模型',1125,422,14,muted);rr(1123,437,326,43,9,'#fff','#dce2e8');txt(t<3.4?'deepseek-flash':'deepseek-chat',1143,465,15,ink,500);txt('⌄',1417,464,15,muted);
  txt('执行权限',759,518,14,muted);['自动执行','每次确认','全部允许'].forEach((s,i)=>{rr(759+i*230,535,218,44,12,(t>4.1&&i===1)||t<4&&i===0?'#e8efff':'#f5f6f8');center(s,868+i*230,563,15,(t>4.1&&i===1)||t<4&&i===0?blue:muted,500);});
  txt('工具',759,624,14,muted);[['运行命令',true],['读写文件',true],['网页访问',true],['长期记忆',true]].forEach(([s,on],i)=>{const x=759+(i%2)*338,y=642+Math.floor(i/2)*52;rr(x,y,324,43,10,'#f7f8fa','#e4e7eb');txt(s,x+16,y+27,15,ink);rr(x+271,y+11,36,20,10,on?'#66bb81':'#ccd2dc');dot(on?x+293:x+283,y+21,8,'#fff');});
  if(t>6){rr(592,750,856,63,12,'#eef7f1');txt('保存成功 · Bot 已就绪',620,789,16,'#367b52',600);mouse(1530,242,t);}
 }
 function operation(t){cover(t,true,1);top(t,true,'05 / REAL TOOLS. VISIBLE RESULTS.');titleBlock('在云电脑里，','真正开始工作。','云终端 · 文件读写 · 实时桌面',t,true);baseWindow();
  const open=t>1.2?1:0;rr(570,555,1070,295,14,'#101a2b','#314361');rr(570,555,1070,42,14,'#18243a');c.fillStyle='#18243a';c.fillRect(570,580,1070,17);dot(593,576,5,'#ed7569');dot(612,576,5,'#edb94f');dot(631,576,5,'#56bd83');txt('云电脑终端 · /data/home/moyubot',655,581,14,'#b7c5da');
  const rows=[['$ pwd','/data/home/moyubot'],['$ mkdir -p film-demo-20261029',''],['$ cat > film-demo-20261029/report.md',''],['$ cat film-demo-20261029/report.md','MoyuBot v0.1.0  ·  云电脑连接成功  ·  下一步：让 AI 上班']];let y=636;rows.forEach(([a,b],i)=>{if(t>i*.65+.2){txt(a,607,y,15,'#a9c8ff',500,'left','Consolas,monospace');y+=27;if(b&&t>i*.65+.7){txt(b,627,y,15,'#9adbb7',500,'left','Consolas,monospace');y+=31;}}});
  if(t>6.1){rr(568,866,1074,42,10,'#edf7f0');dot(590,887,5,'#47a86a');txt('退出码 0 · 已读回文件 · 操作结果已验证',608,893,15,'#42855a',500);}
  if(t>8.2){rr(1240,279,385,248,14,'#fff','#d3dce8');rr(1240,279,385,39,14,'#eff2f7');c.fillStyle='#eff2f7';c.fillRect(1240,300,385,18);dot(1261,298,5,'#ee6b62');dot(1279,298,5,'#efbd50');dot(1297,298,5,'#54bd74');txt('https://moyubot.net',1320,303,12,muted,400,'left','Consolas,monospace');
   txt('MoyuBot',1260,349,15,ink,700);line(1260,362,1605,362);txt('让 AI 上班',1272,411,25,ink,650);txt('你负责摸鱼。',1272,448,22,blue,650);rr(1270,472,139,35,8,blue);center('了解项目',1340,496,12,'#fff',600);mouse(1355,489,t);
  }
  if(t>12){pill('云电脑桌面 · 实时预览',1199,542,'#e9effd',blue,14);pill('默认只读 · 可主动接管',1470,542,'#f0f3f7','#627087',13);}
 }
 function terms(t){cover(t);top(t);center('InstaBox 免费试用，欢迎体验 MoyuBot 云电脑',960,339,39,ink,650);center('云电脑费用与试用规则，以 InstaBox 账户及官方说明为准。',960,411,25,muted,400);
  const xx=[200,681,1162];[['云电脑运行费用','由你的 InstaBox 账户承担'],['免费试用','以账户及官方规则为准'],['模型供应商','需要另行选择与配置']].forEach(([a,b],i)=>group(t,.2+i*.16,()=>{card(xx[i],498,437,184);dot(xx[i]+55,553,17,['#69ad82','#5380e3','#df9566'][i]);center(String(i+1).padStart(2,'0'),xx[i]+55,560,14,'#fff',700);txt(a,xx[i]+28,612,21,ink,600);txt(b,xx[i]+28,652,16,muted);}));
  group(t,.7,()=>pill('开源项目  ·  自主选择模型  ·  云电脑按需唤醒',641,742,'#eaf0fc',blue,17));
 }
 function ending(t){brand(t,true);c.save();c.fillStyle='#182842ee';c.fillRect(0,0,W,H);c.restore();top(t,true,'JOIN THE COMMUNITY');group(t,.08,()=>{c.drawImage(images.logo,866,147,112,112);center('MoyuBot',960,326,76,'#fff',700);center('让 AI 上班，你负责摸鱼。',960,380,30,'#a8c5ff',600);});bots.forEach((b,i)=>group(t,.28+i*.08,()=>avatar(i,628+i*111,503,95,t,'happy')));
  group(t,.45,()=>{rr(434,627,1052,57,13,'#294061');center('moyubot.net',960,665,29,'#fff',650);rr(352,698,1216,47,12,'#f2f5fa');center('github.com/whitemoono/moyubot',960,730,22,ink,600);});
  group(t,.65,()=>{rr(539,777,386,45,11,'#fff');txt('Telegram',558,806,14,'#687890',600);txt('t.me/moyubotnya',663,806,17,ink,600);rr(995,777,386,45,11,'#fff');txt('QQ群',1016,806,14,'#687890',600);txt('2162036353',1110,806,18,ink,600);});
 }
 const draw=[hook,brand,product,conversation,connect,bot,operation,terms,ending];
 function render(t){t=clamp(t,0,89.999);const i=story.scenes.findIndex(s=>t>=s.start&&t<s.end),s=story.scenes[i],local=t-s.start;c.clearRect(0,0,W,H);draw[i](local);if(i>0&&local<.22){c.save();c.globalAlpha=1-ease(local/.22);c.fillStyle=i===3||i===6?'#111c30':'#f5f6f8';c.fillRect(0,110,W,H-110);c.restore();}
  const q=story.cues.find(q=>t>=q.start&&t<q.end);if(q){rr(335,945,1250,64,14,(i===3||i===6)?'#0a1425e8':'#192840e9');center(q.text,960,987,24,'#fff',500);}
  line(78,1024,1842,1024,'#cad2df',2);c.fillStyle=blue;c.fillRect(78,1022,1764*t/90,4);txt('MOYUBOT · v0.1.0',78,1054,14,'#8390a4',500);txt(`${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')} / 01:30`,1842,1054,14,'#8390a4',500,'right');return canvas;}
 async function init(){story=await(await fetch('story.json')).json();for(const [shape] of bots){const g=window.GROK_GEO.shapes[shape];geo[shape]={path:new Path2D(g.path),decals:(g.decals||[]).map(d=>({...d,path:new Path2D(d.d)})),face:g.iconFace};}images.logo=await new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src='../../apps/desktop/src/assets/brand/logo.png';});window.film={render,canvas,story,bots};if(new URLSearchParams(location.search).has('render')){document.body.classList.add('render');render(0);window.FILM_READY=true;return;}const audio=document.querySelector('#audio'),play=document.querySelector('#play'),seek=document.querySelector('#seek');let t=0,base=0,start=0,active=false;function tick(){if(active){t=Math.min(90,base+(performance.now()-start)/1000);if(t===90){active=false;audio.pause();play.textContent='重播';}}render(t);seek.value=t;requestAnimationFrame(tick);}play.onclick=()=>{if(active){active=false;audio.pause();play.textContent='播放';}else{if(t>=90)t=0;start=performance.now();base=t;audio.currentTime=t;void audio.play();active=true;play.textContent='暂停';}};seek.oninput=()=>{t=base=+seek.value;start=performance.now();audio.currentTime=t;};document.querySelector('#mute').onclick=e=>{audio.muted=!audio.muted;e.target.textContent=audio.muted?'开启声音':'静音';};tick();window.FILM_READY=true;}
 init().catch(e=>{window.FILM_ERROR=String(e);console.error(e);});
})();
