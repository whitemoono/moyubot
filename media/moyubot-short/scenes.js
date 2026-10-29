 // Six compositions designed for a phone screen; all animation depends only on time.
 function label(s,x,y,dark=false){en(s,x,y,22,dark?'#a7b9e4':'#7386a5','left');}
 function heading(a,b,sub,dark=false){const col=dark?'#fff':ink;text(a,68,334,86,col,700,'left');text(b,68,446,86,dark?'#acc3ff':'#587ee7',700,'left');if(sub)text(sub,72,520,29,dark?'#aebbd5':'#8290a8',400,'left');}
 function card(x,y,w,h,fill='#fff',stroke='#e1e6ef'){c.save();c.shadowColor='#162b4c12';c.shadowBlur=36;c.shadowOffsetY=15;rect(x,y,w,h,30,fill,stroke);c.restore();}
 function crop(name,sx,sy,sw,sh,x,y,w,h,r=25){c.save();c.beginPath();c.roundRect(x,y,w,h,r);c.clip();c.drawImage(images[name],sx,sy,sw,sh,x,y,w,h);c.restore();}
 function bullet(s,x,y,color='#587ee7',dark=false){circle(x,y-9,5,color);text(s,x+21,y,27,dark?'#c2cde1':'#6c7d97',500,'left');}
 function tag(s,x,y,w,dark=false){rect(x,y,w,53,26,dark?'#ffffff0c':'#eaf0fd',dark?'#ffffff20':null);text(s,x+w/2,y+36,24,dark?'#c1d2fc':'#5d79bc',600);}
 function intro(t){
  background(t,0);header(t);label('YOUR NEW WAY TO WORK',72,233);
  appear(t,.05,()=>heading('让 AI 上班。','你负责摸鱼。','七个伙伴，一个智能体工作空间。'));
  const places=[[320,765],[760,765],[202,1075],[540,1075],[878,1075],[335,1380],[745,1380]];
  bots.forEach((b,i)=>appear(t,.2+i*.12,()=>{const [x,y]=places[i];circle(x,y,108,b.pale);avatar(i,x,y,225,i===1?'sleepy':i%2?'wink':'happy',t);text(b.name,x,y+144,27,ink,600);}));
  appear(t,1.6,()=>{tag('OPEN SOURCE · WINDOWS',330,1570,420);});
 }
 function workspaces(t,g){
  const cloud=t>2.5; background(g,cloud?1:0);header(g);label('01 / CHOOSE YOUR WORKSPACE',72,233);
  heading('本地，或云端。','你来选。','Bot、对话、记忆和任务，各自保存。');
  const active=cloud?1:0;
  ['本地 Windows','云电脑'].forEach((s,i)=>{rect(72+i*477,590,459,92,24,i===active?ink:'#ffffff',i===active?null:'#dfe5ee');text(s,301+i*477,651,35,i===active?'#fff':'#8b98ad',600);});
  card(72,721,936,658);crop(cloud?'cloud-sleep':'local',0,35,1120,720,89,745,902,580,17);
  rect(99,1294,882,59,19,'#edf2fd');text('新版界面 · 演示数据',540,1334,23,'#6c7e9d');
  appear(t,.35,()=>{bullet('同一工作区的 Bot，共用对应电脑',83,1457);bullet(cloud?'云电脑：按需唤醒，空闲时休眠':'本地：在自己的 Windows 上执行',83,1522);});
  avatar(cloud?0:1,900,1540,130,cloud?'happy':'idle',g);
 }
 function tools(t,g){
  background(g,0,true);header(g,true);label('02 / FROM WORDS TO ACTION',72,233,true);
  heading('一句话，','开始动手。','接入喜欢的模型，调用命令与文件工具。',true);
  appear(t,.06,()=>{card(72,600,936,142,'#f7f9ff');avatar(0,142,669,95,'thinking',g);text('帮我整理本周项目文件。',220,683,34,ink,600,'left');});
  appear(t,.3,()=>{card(72,789,936,457,'#fff');text('新版底部命令面板',111,852,28,ink,600,'left');crop('local-terminal',228,720,892,280,94,891,892,280,14);text('新版界面 · 演示输出',540,1221,22,'#7b8ba4');});
  appear(t,.65,()=>{tag('执行命令',72,1305,284,true);tag('读取文件',398,1305,284,true);tag('写入文件',724,1305,284,true);});
  bullet('本地 PowerShell / 云电脑，按工作区执行',83,1484,'#a9c1ff',true);text('命令面板逐条执行，完成后显示输出',83,1550,26,'#8fa3c6',400,'left');
 }
 function continuity(t,g){
  background(g,1);header(g);label('03 / LESS REPEATING. MORE DOING.',72,233);
  heading('记住你，','继续做。','长期记忆与定时任务，让工作接着走。');
  appear(t,.1,()=>{card(72,601,936,435);tag('长期记忆',102,625,182);crop('memory',840,340,256,96,128,701,824,309,16);});
  appear(t,.3,()=>{card(72,1065,936,470);tag('定时任务',102,1085,182);crop('tasks',840,345,256,112,128,1150,824,360.5,16);});
  appear(t,.55,()=>{tag('执行前确认',72,1570,287);tag('用量可查',389,1570,252);tag('群聊协作',671,1570,337);});
  text('定时任务需桌面端保持运行；本地任务需本机在线',540,1635,23,'#8997ac');
 }
 function roadmap(t,g){
  background(g,6,true);header(g,true);label('04 / WHAT COMES NEXT',72,233,true);
  heading('下一站，','随处连接。','以下功能正在规划，尚未上线。',true);
  const items=[['01','跨设备连接','连接自己的多台电脑'],['02','手机 PWA','从手机访问工作区'],['03','MCP','扩展更多工具与服务'],['04','MoyuChain','模型额度互助市场 · 设计中']];
  items.forEach(([n,title,sub],i)=>appear(t,.1+i*.12,()=>{const y=610+i*245;card(72,y,936,207,'#ffffff09','#ffffff18');en(n,115,y+65,22,'#8ca6db','left');text(title,197,y+71,40,'#fff',600,'left');text(sub,197,y+133,28,'#9faecc',400,'left');rect(823,y+41,138,48,24,'#d4b88920');text('待开发',892,y+73,23,'#e8d1ae',600);}));
 }
 function ending(t,g){
  background(g,0);header(g);label('MEET YOUR SEVEN NEW TEAMMATES',72,233);
  appear(t,.03,()=>{c.drawImage(logo,425,293,230,230);text('MoyuBot',540,640,111,ink,700);text('开源的智能体工作空间',540,719,35,'#798aa5',500);});
  bots.forEach((b,i)=>appear(t,.07+i*.06,()=>{let x,y;if(i<4){x=201+i*226;y=930;}else{x=314+(i-4)*226;y=1180;}circle(x,y,85,b.pale);avatar(i,x,y,178,i===1?'sleepy':'happy',g);text(b.name,x,y+113,25,ink,600);}));
  appear(t,.35,()=>{card(72,1386,936,218,ink,null);text('moyubot.net',540,1474,59,'#fff',700);en('github.com/whitemoono/moyubot',540,1552,31,'#bccbf0');});
 }
 function captions(t,dark){const q=story.cues.find(q=>t>=q.start&&t<q.end);if(!q)return;const chars=[...q.text];let lines=[];if(chars.length>27){const at=Math.ceil(chars.length/2);lines=[chars.slice(0,at).join(''),chars.slice(at).join('')];}else lines=[q.text];rect(62,1674,956,lines.length===1?74:104,20,dark?'#121e36dd':'#ffffffdf');lines.forEach((s,i)=>text(s,540,lines.length===1?1723:1716+i*37,28,dark?'#edf2ff':ink,500));}
 function render(t){t=Math.max(0,Math.min(29.999,t));c.clearRect(0,0,W,H);let local,dark=false;
  if(t<4){local=t;intro(local);}else if(t<9){local=t-4;workspaces(local,t);}else if(t<14){local=t-9;dark=true;tools(local,t);}else if(t<19){local=t-14;continuity(local,t);}else if(t<24){local=t-19;dark=true;roadmap(local,t);}else{local=t-24;ending(local,t);}
  if(t>=4&&local<.16){c.fillStyle=dark?'#202940':'#faf8f3';c.globalAlpha=1-smooth(local/.16);c.fillRect(0,190,W,1460);c.globalAlpha=1;}
  captions(t,dark);return canvas;
 }
