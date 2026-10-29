// Seven landscape slides: product-native vector cover + original landing-page screenshots.
(async()=>{
 const canvas=document.querySelector('#art'),c=canvas.getContext('2d'),W=1920,H=1080;
 const bots=[['chibi','大肥鱼','#5890f0'],['nemu','千金','#a8b8fd'],['shiro','小龙娘','#cdbfef'],['mikan','大小姐','#f7844c'],['neko','小猫娘','#91a7f7'],['tsuki','雌小鬼','#f6d7b4'],['zeta','夜猫','#343542']];
 const pages=[
  {id:'cover',name:'01-首图-官网仓库反馈群'},
  {id:'chat',name:'02-专属Bot',tag:'YOUR AI COMPANION',title:['七个角色','你的 AI 搭子'],desc:['各自的模型与人格','各自的上下文','随时回来继续聊'],note:['自定义头像与名字','模型、工具权限独立配置']},
  {id:'group',name:'03-多Bot群聊',tag:'THINK TOGETHER',title:['一个问题','一起想'],desc:['邀请 2–12 个 Bot','按成员顺序发言','参考彼此的想法'],note:['群聊与私聊分别保存','每个成员保留自己的配置']},
  {id:'tasks',name:'04-例行任务',tag:'SET IT IN CHAT',title:['日常任务','聊着安排'],desc:['一次性提醒','重复任务','暂停、改期与恢复'],note:['执行需保持应用运行','本地任务还需电脑在线']},
  {id:'cloud-desktop',name:'05-云电脑桌面',tag:'WATCH AI WORK',title:['云端动手','实时看见'],desc:['运行命令、读写文件','查看实时桌面','接管电脑，再交还 Bot'],note:['InstaBox 注册需邀请码','无账户暂不能用云电脑'],extra:'模型供应商需另配；云电脑费用与试用规则以 InstaBox 账户及官方说明为准。'},
  {id:'library',name:'06-记忆与资料库',tag:'REMEMBER WHAT MATTERS',title:['重要的事','替你记住'],desc:['长期记忆可增删','整理早期上下文','查看对话文件与图片'],note:['按 Bot 独立保存','记录与摘要保留在本地']},
  {id:'usage',name:'07-用量统计',tag:'KNOW YOUR USAGE',title:['谁用多少','一眼看清'],desc:['Token 用量趋势','Bot 与模型排行','日期筛选与缓存命中'],note:['截图中的数据为示例','以供应商实际报告为准']}
 ];
 const load=src=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error('Cannot load '+src));im.src=src;});
 const [logo,...shots]=await Promise.all([load('../../apps/desktop/src/assets/brand/logo.png'),...pages.slice(1).map(p=>load('../../moyubot-landing/site/screenshots/'+p.id+'.png'))]);
 await document.fonts.ready;
 function rr(x,y,w,h,r,fill,stroke){c.beginPath();c.roundRect(x,y,w,h,r);if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=2;c.stroke();}}
 function text(s,x,y,size=28,color='#fff',weight=600,align='left',font='"Microsoft YaHei",sans-serif'){c.font=`${weight} ${size}px ${font}`;c.fillStyle=color;c.textAlign=align;c.textBaseline='alphabetic';c.fillText(s,x,y);}
 function line(x,y,X,Y,color,width=2){c.beginPath();c.moveTo(x,y);c.lineTo(X,Y);c.lineWidth=width;c.strokeStyle=color;c.stroke();}
 function pill(s,x,y,fill='#273e62',color='#bfd2f3',size=23){c.font=`650 ${size}px "Microsoft YaHei",sans-serif`;const w=c.measureText(s).width+34;rr(x,y,w,44,22,fill);text(s,x+17,y+30,size,color,650);}
 function base(i){const g=c.createLinearGradient(0,0,W,H);g.addColorStop(0,'#081a31');g.addColorStop(.55,'#183663');g.addColorStop(1,'#294cb9');c.fillStyle=g;c.fillRect(0,0,W,H);const glow=c.createRadialGradient(1520,430,20,1520,430,1050);glow.addColorStop(0,'#417bff44');glow.addColorStop(1,'#417bff00');c.fillStyle=glow;c.fillRect(0,0,W,H);for(let x=0;x<W;x+=80)line(x,0,x,H,'#abc9ff0b',1);for(let y=0;y<H;y+=80)line(0,y,W,y,'#abc9ff0b',1);c.drawImage(logo,76,58,54,54);text('MoyuBot',147,99,34,'#fff',750);text(`${String(i+1).padStart(2,'0')} / 07`,1844,99,26,'#a5bfe9',600,'right');}
 function avatar(i,x,y,size){const g=window.GROK_GEO.shapes[bots[i][0]],f=g.iconFace;c.save();c.translate(x,y);c.scale(size/245,size/245);c.translate(-114.5,-114.5);c.fillStyle=bots[i][2];c.fill(new Path2D(g.path));for(const d of g.decals||[]){c.fillStyle=d.fill;c.fill(new Path2D(d.d),d.rule||'nonzero');}if(f){c.strokeStyle=f.ink||'#191c26';c.lineWidth=2.5;for(const [ex,ey] of f.anchors){c.beginPath();c.moveTo(ex-f.rx,ey+1);c.quadraticCurveTo(ex,ey+(i===1?3:-f.ry*.6),ex+f.rx,ey+1);c.stroke();}}c.restore();}
 function cover(){base(0);pill('v0.1.0 已上线 · 开源 AI 桌面助手',337,66,'#ddff7920','#e0ff87',24);text('Grok？',73,259,100,'#fff',800);text('让 AI 上班',73,399,105,'#fff',850);text('你负责摸鱼',73,531,105,'#dfff72',850);text('七个伙伴，把想法变成行动。',81,601,34,'#b7cfef',600);
  bots.forEach((b,i)=>{const row=i<4?0:1,col=i<4?i:i-4,x=(row?1047:941)+col*221,y=row?398:164;rr(x,y,195,211,24,'#f0f5ff');rr(x+12,y+12,171,143,17,b[2]+'22');avatar(i,x+97.5,y+87,136);text(b[1],x+97.5,y+189,27,'#1b3052',700,'center');});
  rr(78,676,514,124,20,'#f1f6ff');text('官网',105,715,23,'#758aa8',700);text('moyubot.net',105,771,46,'#183254',750);rr(614,676,1228,124,20,'#f1f6ff');text('完整 GitHub 仓库',643,715,23,'#758aa8',700);text('https://github.com/whitemoono/moyubot',643,770,42,'#183254',700);
  rr(78,823,996,118,20,'#233e65','#5578b7');text('Telegram 反馈群',105,863,25,'#a7c3ed',650);text('https://t.me/moyubotnya',105,912,40,'#fff',700);rr(1096,823,746,118,20,'#233e65','#5578b7');text('QQ 反馈群',1124,863,25,'#a7c3ed',650);text('2162036353',1124,912,44,'#fff',750);text('欢迎反馈 Bug 与功能需求 · 喜欢的话，给项目一颗 Star 喵～',81,1009,29,'#dfff80',650);text('向后滑动，看 6 张功能截图 →',1842,1009,27,'#bfd2f1',600,'right');
 }
 function feature(i){const p=pages[i],im=shots[i-1];base(i);text(p.tag,78,192,19,'#9bbcf3',650);p.title.forEach((s,j)=>text(s,73,298+j*78,56,j?'#dfff7b':'#fff',800));pill(['专属 Bot','多 Bot 群聊','例行任务','共享云电脑','记忆与资料库','用量统计'][i-1],78,424,'#2c4e7b','#d3e5ff',25);
  p.desc.forEach((s,j)=>{text('0'+(j+1),80,575+j*81,20,'#7f9dca',650);text(s,80,615+j*81,28,'#d0dff5',550);});line(79,839,360,839,'#6c8dbf66',2);p.note.forEach((s,j)=>text(s,80,886+j*42,23,'#aac1e3',550));text('moyubot.net',80,1018,28,'#e3edff',700);
  // Original PNGs remain unchanged: fit and letterbox, never crop the interface.
  const x=421,y=62,w=1422,h=925;rr(x-2,y-2,w+4,h+4,17,'#edf3ff','#94b3e6');c.save();c.beginPath();c.roundRect(x,y,w,h,16);c.clip();c.fillStyle='#f5f7fa';c.fillRect(x,y,w,h);const k=Math.min(w/im.width,h/im.height);c.drawImage(im,x+(w-im.width*k)/2,y+(h-im.height*k)/2,im.width*k,im.height*k);c.restore();
  if(p.extra)text(p.extra,424,1035,22,'#c2d3ef',500);else{text('落地页原图 · '+(p.id==='usage'?'示例数据':p.id==='cloud-desktop'?'真实云电脑实拍':'客户端界面示例'),424,1035,23,'#a8c2e9',550);text('MoyuBot v0.1.0',1841,1035,22,'#a8c2e9',600,'right');}
 }
 function draw(i){c.clearRect(0,0,W,H);i===0?cover():feature(i);return canvas;}
 window.art={draw,canvas,pages};if(new URLSearchParams(location.search).has('render'))document.body.classList.add('render');else pages.forEach((p,i)=>{const b=document.createElement('button');b.textContent=i===0?'01 首图':p.name.replace('-',' ');b.onclick=()=>{document.querySelectorAll('button').forEach(b=>b.classList.remove('active'));b.classList.add('active');draw(i);};if(i===0)b.className='active';document.querySelector('#pages').append(b);});draw(0);window.ART_READY=true;
})().catch(e=>{window.ART_ERROR=String(e);console.error(e);});
