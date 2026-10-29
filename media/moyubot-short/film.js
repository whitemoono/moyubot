/* Original time-driven expression animation using the project's existing portraits. */
(() => {
 'use strict';
 const canvas=document.querySelector('#film'),c=canvas.getContext('2d'),W=1080,H=1920,TAU=Math.PI*2;
 const font='"Microsoft YaHei",sans-serif',ink='#24314b';
 const bots=[
  {shape:'chibi',name:'大肥鱼',color:'#5890f0',pale:'#e5edff',tag:'今天，也要元气满满。'},
  {shape:'nemu',name:'千金',color:'#a8b8fd',pale:'#ededff',tag:'再睡五分钟，就起来。'},
  {shape:'shiro',name:'小龙娘',color:'#cdbfef',pale:'#f0eafa',tag:'有一点害羞，也有一点好奇。'},
  {shape:'mikan',name:'大小姐',color:'#f7844c',pale:'#fff0e4',tag:'哼，才没有在等你呢。'},
  {shape:'neko',name:'小猫娘',color:'#91a7f7',pale:'#eeedff',tag:'喵？听见你在叫我。'},
  {shape:'tsuki',name:'雌小鬼',color:'#f6d7b4',pale:'#fcf0de',tag:'诶嘿，被我发现啦。'},
  {shape:'zeta',name:'夜猫',color:'#343542',pale:'#e9e9ef',tag:'夜深了，灵感还醒着。'}
 ];
 const moods=[['idle','眨眨眼','HELLO'],['happy','开心！','HAPPY'],['thinking','思考中…','THINKING'],['shy','有点害羞','SHY'],['sleepy','困困了','SLEEPY'],['surprised','诶？！','SURPRISED'],['angry','哼！','GRUMPY'],['wink','眨眼比心','WINK']];
 const orders=[[0,1,2,3,4,5,6,7],[0,4,5,3,2,6,1,7],[0,3,2,5,4,6,7,1],[0,6,2,3,5,4,7,1],[0,5,2,3,6,4,1,7],[0,7,5,6,2,4,3,1],[0,2,4,5,6,3,1,7]];
 const geo={};let logo;const images={};let story;
 const clamp=n=>Math.max(0,Math.min(1,n)),ease=n=>1-Math.pow(1-clamp(n),3),smooth=n=>{n=clamp(n);return n*n*(3-2*n);};
 function rect(x,y,w,h,r,fill,stroke){c.beginPath();c.roundRect(x,y,w,h,r);if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=2;c.stroke();}}
 function text(s,x,y,size,color=ink,weight=500,align='center'){c.font=`${weight} ${size}px ${font}`;c.fillStyle=color;c.textAlign=align;c.textBaseline='alphabetic';c.fillText(s,x,y);}
 function en(s,x,y,size=20,color='#8d96a7',align='center'){c.font=`600 ${size}px "Segoe UI",sans-serif`;c.fillStyle=color;c.textAlign=align;c.fillText(s,x,y);}
 function circle(x,y,r,col){c.beginPath();c.arc(x,y,r,0,TAU);c.fillStyle=col;c.fill();}
 function line(points,color,width=3){c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.lineJoin='round';c.stroke();}
 function heart(x,y,size,col){c.save();c.translate(x,y);c.scale(size/24,size/24);c.beginPath();c.moveTo(0,9);c.bezierCurveTo(-25,-7,-11,-24,0,-12);c.bezierCurveTo(11,-24,25,-7,0,9);c.fillStyle=col;c.fill();c.restore();}
 function star(x,y,r,col,rotation=0){c.save();c.translate(x,y);c.rotate(rotation);c.beginPath();for(let i=0;i<8;i++){const a=i*TAU/8,rr=i%2?r*.24:r;i?c.lineTo(Math.cos(a)*rr,Math.sin(a)*rr):c.moveTo(rr,0);}c.closePath();c.fillStyle=col;c.fill();c.restore();}
 function pill(s,x,y,color,bg){c.font=`600 26px ${font}`;const w=c.measureText(s).width+50;rect(x-w/2,y,w,56,28,bg);text(s,x,y+38,26,color,600);}
 function appear(t,start,fn){const p=ease((t-start)/.55);if(!p)return;c.save();c.globalAlpha*=p;c.translate(0,(1-p)*30);fn();c.restore();}
 function background(t,i=0,dark=false){
  c.fillStyle=dark?'#202940':'#faf8f3';c.fillRect(0,0,W,H);
  const grad=c.createRadialGradient(700+Math.sin(t*.2)*100,760,40,550,850,1000);grad.addColorStop(0,dark?'#5b6eae66':bots[i].pale);grad.addColorStop(1,dark?'#20294000':'#faf8f300');c.fillStyle=grad;c.fillRect(0,0,W,H);
  c.fillStyle=dark?'#ffffff14':'#24314b14';for(let x=60;x<W;x+=48)for(let y=70;y<H;y+=48)c.fillRect(x,y,2,2);
  c.save();c.strokeStyle=dark?'#ffffff0b':'#d9dfeb77';c.lineWidth=2;c.translate(540,850);c.rotate(Math.sin(t*.08)*.1);[440,500].forEach(r=>{c.beginPath();c.ellipse(0,0,r,r*.96,0,0,TAU);c.stroke();});c.restore();
 }
 function header(t,dark=false){if(logo)c.drawImage(logo,68,83,49,49);text('MoyuBot',135,119,29,dark?'#fff':ink,700,'left');en('MEET YOUR AI WORKSPACE',1011,116,17,dark?'#adb9d4':'#8893a6','right');
  rect(68,1790,944,3,2,dark?'#ffffff22':'#dce1ed');rect(68,1790,944*t/30,3,2,'#6586ee');en('moyubot.net',68,1845,22,dark?'#dbe4ff':'#74839e','left');en('PRODUCT FILM / 30 SEC',1012,1845,17,dark?'#a9b7d0':'#8c96a8','right');}
 function pose(mood,t,i){
  const p=t*3+i*.6,b=Math.sin(p);let x=0,y=b*2,roll=Math.sin(p*.5)*.025,sx=1,sy=1;
  if(mood==='happy'){y=-Math.abs(Math.sin(t*4))*7;roll=Math.sin(t*4)*.045;sx=1+Math.sin(t*8)*.012;sy=1-Math.sin(t*8)*.016;}
  if(mood==='thinking'){roll=.085+Math.sin(t*2)*.018;x=2;}
  if(mood==='shy'){roll=-.07+Math.sin(t*2)*.025;y=3;}
  if(mood==='sleepy'){roll=.07+Math.sin(t*1.8)*.02;y=4+Math.sin(t*2)*3;sy=.99;}
  if(mood==='surprised'){y=-5-Math.abs(Math.sin(t*5))*3;sy=1.025;sx=.99;}
  if(mood==='angry'){x=Math.sin(t*22)*1.2;roll=Math.sin(t*12)*.018;}
  if(mood==='wink'){roll=-.07;y=-Math.abs(Math.sin(t*3))*3;}
  return {x,y,roll,sx,sy};
 }
 function avatar(i,x,y,size,mood,t,transition=1){
  const b=bots[i],g=geo[b.shape],p=pose(mood,t,i);const k=size/245;
  c.save();c.translate(x+p.x*k,y+p.y*k);c.rotate(p.roll);c.scale(k*p.sx,k*p.sy);c.translate(-114.5,-114.5);
  c.fillStyle=b.color;c.fill(g.path);g.decals.forEach(d=>{c.fillStyle=d.fill;c.fill(d.path,d.rule||'nonzero');});
  const f=g.face,phase=(t+i*.53)%3.6;
  const blink=mood==='idle'&&transition>=.42&&transition<=.66?Math.max(.03,Math.abs(transition-.54)/.12):phase<.2?Math.max(.03,Math.abs(phase-.1)/.1):1;
  const peak=1-Math.exp(-Math.max(0,transition)*12);const faceInk=f.ink||'#1a1a1f';
  const gaze=mood==='thinking'?{x:3,y:-4}:mood==='shy'?{x:2,y:3}:{x:Math.sin(t*.9+i)*1.2,y:0};
  f.anchors.forEach(([ex,ey],j)=>{
   c.save();c.translate(ex+gaze.x,ey+gaze.y);c.strokeStyle=faceInk;c.fillStyle=faceInk;c.lineCap='round';c.lineWidth=4;
   const rx=f.rx,ry=f.ry;
   if(mood==='happy'||(mood==='wink'&&j===1)){
    c.beginPath();c.moveTo(-rx*1.4,2);c.quadraticCurveTo(0,-ry*.65,rx*1.4,2);c.stroke();
   }else if(mood==='sleepy'){
    c.beginPath();c.moveTo(-rx*1.4,-1);c.quadraticCurveTo(0,4,rx*1.4,-1);c.stroke();
   }else if(mood==='surprised'){
    c.beginPath();c.ellipse(0,0,rx*1.65,ry*1.08,0,0,TAU);c.fill();circle(-rx*.4,-ry*.45,rx*.48,'#fff');
   }else if(mood==='angry'){
    c.save();c.rotate(j===0?-.16:.16);rect(-rx,-ry*.47,rx*2,ry*1.2,3,faceInk);c.restore();
    line([[-rx*1.7,-ry-2],[rx*1.7,-ry+(j===0?4:-4)]],faceInk,2.8);
   }else if(mood==='thinking'){
    rect(-rx,-ry*.72,rx*2,ry*1.44,3,faceInk);line([[-rx*1.5,-ry-5],[rx,-ry-7+(j===0?3:-2)]],faceInk,2.2);
   }else{
    c.scale(1,blink*(mood==='shy'?.78:1));rect(-rx,-ry,rx*2,ry*2,Math.min(4,rx),faceInk);
   }c.restore();
  });
  const mx=(f.anchors[0][0]+f.anchors[1][0])/2,my=f.anchors[0][1]+26;
  if(mood==='surprised'){c.beginPath();c.ellipse(mx,my,3.8,5.8,0,0,TAU);c.strokeStyle=faceInk;c.lineWidth=2;c.stroke();}
  if(mood==='angry'){line([[mx-5,my+2],[mx,my],[mx+5,my+2]],faceInk,2);}
  if(mood==='happy'||mood==='wink'){c.beginPath();c.moveTo(mx-4,my-1);c.quadraticCurveTo(mx,my+4,mx+4,my-1);c.strokeStyle=faceInk;c.lineWidth=1.8;c.stroke();}
  if(mood==='shy'){
   c.globalAlpha=.45*peak;f.anchors.forEach(([ex,ey],j)=>{c.save();c.translate(ex+(j?-13:13),ey+21);for(let n=0;n<3;n++)line([[n*4-5,-2],[n*4-7,4]],'#e884a0',1.6);c.restore();});c.globalAlpha=1;
  }
  c.restore();
 }
 function decorations(mood,x,y,size,t,color){
  const u=size/600;
  c.save();c.translate(x,y);c.scale(u,u);
  if(mood==='happy'){[-1,1].forEach((sign,j)=>star(sign*270,-95+Math.sin(t*4+j)*14,24,color,t));}
  if(mood==='thinking'){text('?',259,-130+Math.sin(t*3)*8,80,color,600);[0,1,2].forEach(j=>circle(219+j*21,-35,4+Math.sin(t*4-j)*1.5,color));}
  if(mood==='shy'){heart(270,-130+Math.sin(t*2)*10,23,'#e7a5b8');heart(-252,50+Math.sin(t*2+1)*10,17,'#e7a5b8');}
  if(mood==='sleepy'){[0,1,2].forEach(j=>{c.save();c.globalAlpha=.45+.5*((t*.8+j*.33)%1);en('z',190+j*36,-105-j*42-((t*.8+j*.33)%1)*15,24+j*9,'#8496cf');c.restore();});}
  if(mood==='surprised'){text('!',255,-130,88,color,700);line([[-258,-120],[-283,-143]],color,7);line([[-272,-75],[-306,-80]],color,7);}
  if(mood==='angry'){line([[245,-160],[245,-137],[265,-137]],'#d27a72',6);line([[279,-137],[279,-116],[258,-116]],'#d27a72',6);}
  if(mood==='wink'){heart(265,-86-Math.sin(t*3)*12,40,'#e796b4');star(-260,-110,21,color,t*.5);}
  c.restore();
 }
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
 async function init(){
  bots.forEach(b=>{const g=window.GROK_GEO.shapes[b.shape];geo[b.shape]={path:new Path2D(g.path),decals:(g.decals||[]).map(d=>({...d,path:new Path2D(d.d)})),face:g.iconFace};});
  logo=await new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src='../../apps/desktop/src/assets/brand/logo.png';});await document.fonts.ready;
  
  story=await fetch('story.json').then(r=>r.json());
  await Promise.all(['local','local-terminal','cloud-sleep','memory','tasks'].map(async name=>{
   images[name]=await new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src='output/ui/'+name+'.png';});
  }));
  window.film={render,bots,canvas,duration:30};
  if(new URLSearchParams(location.search).has('render')){document.body.classList.add('render');render(2.5);window.FILM_READY=true;return;}
  const audio=document.querySelector('#audio'),play=document.querySelector('#play'),seek=document.querySelector('#seek'),clock=document.querySelector('#clock');let playing=false,time=0,base=0,start=0;
  const fmt=t=>`${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`;
  function tick(){if(playing){time=Math.min(30,base+(performance.now()-start)/1000);if(time>=30){playing=false;audio.pause();play.textContent='重播';}}render(time);seek.value=time;clock.textContent=`${fmt(time)} / 00:30`;requestAnimationFrame(tick);}
  function toggle(){if(playing){playing=false;audio.pause();play.textContent='播放';}else{if(time>=30)time=0;start=performance.now();base=time;audio.currentTime=time;audio.play().catch(()=>{});playing=true;play.textContent='暂停';}}
  function jump(t){time=Math.max(0,Math.min(30,t));base=time;start=performance.now();audio.currentTime=time;}
  play.onclick=toggle;seek.oninput=()=>jump(+seek.value);document.querySelector('#mute').onclick=e=>{audio.muted=!audio.muted;e.target.textContent=audio.muted?'开启声音':'静音';};
  document.addEventListener('keydown',e=>{if(e.target.tagName==='INPUT')return;if(e.code==='Space'){e.preventDefault();toggle();}if(e.code==='ArrowLeft')jump(time-5);if(e.code==='ArrowRight')jump(time+5);});tick();window.FILM_READY=true;
 }
 init().catch(e=>{window.FILM_ERROR=String(e);console.error(e);});
})();
