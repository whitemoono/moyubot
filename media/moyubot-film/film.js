/* Deterministic animation: every frame is derived only from film time. */
(() => {
  'use strict';
  const canvas = document.querySelector('#film');
  let c = canvas.getContext('2d');
  const W = 1920, H = 1080, TAU = Math.PI * 2;
  const C = {paper:'#f5f5ef',ink:'#172b49',blue:'#3265ed',pale:'#e6edff',muted:'#738198',dark:'#111e35',line:'#dce1e6',amber:'#b77728'};
  const FONT = '"Microsoft YaHei", "PingFang SC", sans-serif';
  const bots = [
    ['chibi','大肥鱼','BOT 01','#5890f0'],['nemu','千金','BOT 02','#a8b8fd'],
    ['shiro','小龙娘','BOT 03','#cdbfef'],['mikan','大小姐','BOT 04','#f7844c'],
    ['neko','小猫娘','BOT 05','#91a7f7'],['tsuki','雌小鬼','BOT 06','#f6d7b4'],['zeta','夜猫','BOT 07','#343542']
  ];
  const assets = {}, paths = {};
  let story;
  const clamp = (n,a=0,b=1) => Math.max(a,Math.min(b,n));
  const ease = n => 1 - Math.pow(1-clamp(n),3);
  const smooth = n => {n=clamp(n);return n*n*(3-2*n);};
  const mix = (a,b,p) => a+(b-a)*p;
  function rr(x,y,w,h,r=22,fill,stroke) {
    c.beginPath(); c.roundRect(x,y,w,h,r);
    if(fill){c.fillStyle=fill;c.fill();} if(stroke){c.strokeStyle=stroke;c.lineWidth=1.5;c.stroke();}
  }
  function txt(s,x,y,size=28,color=C.ink,weight=400,align='left') {
    c.fillStyle=color;c.font=`${weight} ${size}px ${FONT}`;c.textAlign=align;c.textBaseline='alphabetic';c.fillText(s,x,y);
  }
  function en(s,x,y,size=20,color=C.muted,weight=600,align='left') {
    c.fillStyle=color;c.font=`${weight} ${size}px "Segoe UI", Arial, sans-serif`;c.textAlign=align;c.textBaseline='alphabetic';c.fillText(s,x,y);
  }
  function dot(x,y,r,color){c.beginPath();c.arc(x,y,r,0,TAU);c.fillStyle=color;c.fill();}
  function line(x,y,x2,y2,color=C.line,width=2){c.beginPath();c.moveTo(x,y);c.lineTo(x2,y2);c.strokeStyle=color;c.lineWidth=width;c.stroke();}
  function pill(s,x,y,color=C.blue,bg=C.pale,size=20) {
    c.font=`600 ${size}px ${FONT}`;let width=c.measureText(s).width+38;
    rr(x,y,width,43,21,bg);txt(s,x+19,y+29,size,color,600);return width;
  }
  function group(t,delay,fn,offset=32) {
    const p=ease((t-delay)/.75);if(p<=0)return;c.save();c.globalAlpha*=p;c.translate(0,(1-p)*offset);fn(p);c.restore();
  }
  function bg(t,dark=false) {
    c.fillStyle=dark?C.dark:C.paper;c.fillRect(0,0,W,H);
    const g=c.createRadialGradient(1500+Math.sin(t*.15)*80,170,10,1500,170,1100);
    g.addColorStop(0,dark?'#243d6d88':'#d7e4ffbb');g.addColorStop(1,dark?'#111e3500':'#f5f5ef00');c.fillStyle=g;c.fillRect(0,0,W,H);
    c.fillStyle=dark?'#a7c5ff16':'#324d6d12';
    for(let x=62;x<W;x+=44)for(let y=58;y<H;y+=44)c.fillRect(x,y,1.4,1.4);
  }
  function header(index,dark=false,label) {
    let ink=dark?'#e6edfa':C.ink;
    if(assets.logo)c.drawImage(assets.logo,94,44,41,41);
    en('MoyuBot',148,74,25,ink,700);
    en(label||'YOUR AI CREW. YOUR QUIET MOMENT.',1822,72,16,dark?'#91a6c4':C.muted,500,'right');
    line(98,105,1822,105,dark?'#ffffff18':'#172b491c',1);
    en(`${String(index+1).padStart(2,'0')} / 10`,98,930,16,dark?'#7e94b5':C.muted);
  }
  function heading(a,b,kicker,t,dark=false) {
    const color=dark?'#f4f6fa':C.ink;
    group(t,.1,()=>en(kicker,110,190,18,dark?'#9ebaff':C.blue,600));
    group(t,.3,()=>txt(a,110,292,72,color,700));
    if(b)group(t,.48,()=>txt(b,110,382,72,color,700));
  }
  function avatar(i,x,y,size,t,mood='idle',alpha=1) {
    const bot=bots[i],geo=paths[bot[0]];if(!geo)return;
    const phase=t*2+i*1.3;
    let bob=Math.sin(phase)*3.5, tilt=Math.sin(phase*.56)*.035;
    if(mood==='happy'){bob-=Math.abs(Math.sin(t*3+i)) * 8;tilt*=2;}
    if(mood==='thinking')tilt+=.07;
    c.save();c.globalAlpha*=alpha;c.translate(x,y+bob);c.rotate(tilt);
    c.scale(size/245,size/245);c.translate(-114.5,-114.5);
    const breath=1+Math.sin(phase)*.008;c.translate(114.5,180);c.scale(1,breath);c.translate(-114.5,-180);
    c.fillStyle=bot[3];c.fill(geo.path);
    geo.decals.forEach(d=>{c.fillStyle=d.fill;c.fill(d.path,d.rule||'nonzero');});
    const face=geo.face;
    if(face) {
      const blinkPhase=(t+i*.71)%4.6;
      const blink=blinkPhase<.16?Math.max(.08,Math.abs(blinkPhase-.08)/.08):1;
      face.anchors.forEach(([ex,ey],j)=>{
        c.save();c.translate(ex+Math.sin(t*.8+i)*1.7,ey+(mood==='thinking'?-2:0));
        if(mood==='happy' && Math.sin(t*1.3+i)>.8){
          c.strokeStyle=face.ink||'#1a1a1f';c.lineWidth=4;c.lineCap='round';c.beginPath();c.moveTo(-6,2);c.quadraticCurveTo(0,-6,6,2);c.stroke();
        } else {c.scale(1,blink);rr(-face.rx,-face.ry,face.rx*2,face.ry*2,Math.min(face.rx,4),face.ink||'#1a1a1f');}
        c.restore();
      });
    }
    c.restore();
  }
  function shadowCard(x,y,w,h,fn,r=24,fill='#fff') {
    c.save();c.shadowColor='#10274915';c.shadowBlur=55;c.shadowOffsetY=22;rr(x,y,w,h,r,fill);c.restore();
    c.save();rr(x,y,w,h,r);c.clip();fn?.();c.restore();
  }
  // Preserve the real product UI while synchronizing demo identities with the reference.
  // Original screenshots remain untouched. All edits are local to the film's image surface.
  function synchronizeScreenshot(name,img) {
    if(!['home','group','tasks'].includes(name))return img;
    const surface=document.createElement('canvas');surface.width=img.width;surface.height=img.height;
    const previous=c;c=surface.getContext('2d');
    try {
      c.drawImage(img,0,0);
      const light=name==='group',side=light?'#f4f4f4':'#171717',page=light?'#fcfcfc':'#111111';
      const ink=light?'#253145':'#e6e6e6',muted=light?'#8c929d':'#818181',selected=light?'#e7e7e7':'#222222';
      const erase=(x,y,w,h,color)=>{c.fillStyle=color;c.fillRect(x,y,w,h);};
      const portrait=(i,x,y,size,bg)=>{erase(x-size/2-3,y-size/2-3,size+6,size+6,bg);avatar(i,x,y,size,0);};
      // Seven names, portraits, and the pinned/hidden organization follow the user's reference.
      erase(1,96,245,765,side);
      avatar(0,124,144,48,0);txt(bots[0][1],124,191,11,muted,400,'center');
      txt('▱  111',25,237,11,muted);en('1',221,237,10,muted,400,'right');
      if(name!=='group')rr(13,253,221,58,14,selected);
      avatar(1,40,281,39,0);txt(bots[1][1],68,276,13,ink,600);txt('还没有消息，和我聊聊吧',68,297,11,muted);
      txt('▱  未分组',25,345,11,muted);en('4',221,345,10,muted,400,'right');
      for(let i=2;i<=5;i++){
        const y=385+(i-2)*65;avatar(i,40,y,39,0);txt(bots[i][1],68,y-5,13,ink,500);txt('还没有消息，和我聊聊吧',68,y+16,11,muted);
      }
      txt('⌁  已隐藏的 Bot',25,654,11,muted);en('1',221,654,10,muted,400,'right');
      avatar(6,40,698,39,0);txt(bots[6][1],68,693,13,ink,500);txt('还没有消息，和我聊聊吧',68,714,11,muted);
      if(name==='group'){
        rr(13,759,221,58,14,selected);txt('◎',28,794,23,muted);txt('灵感小组',68,782,13,ink);txt('让不同的 Bot 一起讨论',68,804,11,muted);
        portrait(0,482,265,34,page);portrait(1,482,426,34,page);
        erase(532,250,126,24,'#f5f5f5');txt(bots[0][1],538,268,12,'#737373',500);
        erase(532,411,126,24,'#f5f5f5');txt(bots[1][1],538,429,12,'#737373',500);
      }else if(name==='home'){
        erase(793,48,123,50,page);rr(798,52,112,42,21,'#1b1b1b','#363636');
        avatar(1,822,73,29,0);txt(bots[1][1],846,78,12,ink,600);
        portrait(1,854,320,88,page);
        erase(665,470,385,30,page);txt('我是 千金。陪你思考，也替你动手。',854,489,12,'#777777',400,'center');
        erase(553,535,352,23,'#1c1c1c');txt('和 千金 说点什么…',558,550,12,'#777777');
      }else{
        erase(648,48,123,50,page);rr(651,52,112,42,21,'#222222','#393939');
        avatar(1,675,73,29,0);txt(bots[1][1],699,78,12,ink,600);
        portrait(1,1316,138,83,page);erase(1255,183,124,32,page);txt(bots[1][1],1316,205,15,ink,600,'center');
        [166,454,744].forEach(y=>portrait(1,330,y,34,page));
        erase(380,898,325,24,'#1c1c1c');txt('和 千金 说点什么…',386,914,12,'#777777');
      }
    } finally {c=previous;}
    return surface;
  }
  function screenshot(name,x,y,w,h,t,label='界面演示 · 角色已同步') {
    const img=assets[name];if(!img)return;
    shadowCard(x,y,w,h,()=>{
      c.fillStyle='#111';c.fillRect(x,y,w,h);
      if(name==='usage')c.drawImage(img,370,138,890,447,x,y,w,h);
      else c.drawImage(img,x,y,w,h);
    },18);
    pill(label,x+18,y+h-51,'#fff','#172b49dc',15);
  }
  function check(x,y,color=C.blue) {c.save();c.strokeStyle=color;c.lineWidth=3;c.lineCap='round';c.beginPath();c.moveTo(x-6,y);c.lineTo(x-1,y+5);c.lineTo(x+8,y-6);c.stroke();c.restore();}
  function intro(t) {
    bg(t);header(0);
    group(t,.1,()=>pill('OPEN SOURCE / DESKTOP AGENT',110,174));
    group(t,.35,()=>txt('让 AI 上班。',105,372,112,C.ink,700));
    group(t,2.7,()=>txt('你，摸会儿鱼。',105,514,112,C.blue,700));
    group(t,4.0,()=>{txt('一个工作空间，一群 AI 伙伴。',112,620,32,C.muted);en('Less busywork. More breathing room.',112,674,25,C.muted,400);});
    const p=ease((t-.7)/1.3);
    c.save();c.translate(0,(1-p)*100);c.globalAlpha=p;
    c.save();c.translate(1420,489);c.rotate(-.08);rr(-260,-250,520,520,120,'#e1eaff');c.restore();
    avatar(0,1420,471,480,t,'happy');
    [['写代码','</>',1120,250],['整理资料','≡',1550,684],['安排任务','◷',1100,740]].forEach(([a,b,x,y],i)=>{
      group(t,1.2+i*.5,()=>{const yy=y+Math.sin(t+i)*9;shadowCard(x,yy,240,79,()=>{en(b,x+22,yy+50,26,C.blue,700);txt(a,x+79,yy+50,24,C.ink,600);},20);});
    });c.restore();
  }
  function cast(t) {
    bg(t);header(1);
    group(t,.15,()=>{en('MEET YOUR AI CREW',110,188,18,C.blue);txt('七种个性。一个工作空间。',105,294,78,C.ink,700);});
    group(t,.5,()=>txt('角色是你的选择，模型也一样。',112,366,29,C.muted));
    bots.forEach((b,i)=>group(t,.7+i*.24,()=>{
      const x=112+i*245, y=461+Math.sin(t*.65+i*.55)*6;
      shadowCard(x,y,225,352,null,34,'#fff');
      rr(x+16,y+16,193,206,26,['#eaf1ff','#edf0ff','#f0ebfb','#fff1df','#eeeefd','#faf3e8','#ececf0'][i]);
      avatar(i,x+112,y+120,193,t,i===1?'idle':'happy');
      txt(b[1],x+112,y+267,29,C.ink,700,'center');en(b[2],x+112,y+309,22,C.muted,500,'center');
      dot(x+192,y+249,5,b[3]);
    }));
    group(t,4,()=>{line(112,867,1808,867);en('BREATHE / BLINK / THINK / WORK / CELEBRATE',960,909,18,C.muted,500,'center');});
  }
  function workspace(t) {
    bg(t,true);header(2,true,'ONE WORKSPACE / MANY MODELS');
    heading('喜欢的模型，','都坐在这里。','01 / WORKSPACE',t,true);
    group(t,.9,()=>{txt('一个 Bot，一份持续的对话。',113,493,29,'#aabbd3');txt('模型、角色、工具，各自配置。',113,544,29,'#aabbd3');});
    const labels=['多供应商与自定义端点','私聊 + 多 Bot 群聊','明暗主题 / 快捷搜索'];
    labels.forEach((s,i)=>group(t,1.4+i*.65,()=>{dot(124,655+i*65,15,'#2e4570');check(124,655+i*65,'#97b9ff');txt(s,158,665+i*65,25,'#e1e9f6');}));
    group(t,.45,()=>{
      c.save();const z=1+ease(t/12)*.018;c.translate(1294,527);c.scale(z,z);c.translate(-1294,-527);
      const name=t<6?'home':'group';screenshot(name,754,194,1050,683,t);c.restore();
    });
    if(t>5.8)group(t,5.8,()=>pill('让不同模型接着讨论',1112,838,'#d6e6ff','#2b4375',20));
  }
  function cloud(t) {
    bg(t);header(3);
    heading('一台云电脑，','全员共享。','02 / SHARED CLOUD COMPUTER',t);
    group(t,.9,()=>{txt('需要时唤醒，空闲时休眠。',112,500,32,C.blue,600);txt('纯聊天不唤醒 · 工作文件持久保留',112,556,26,C.muted);});
    const center={x:1310,y:495},state=t<3?'休眠中':t<5?'正在唤醒':t<9?'执行任务':'自动休眠';
    group(t,.4,()=>{
      [224,318].forEach((r,i)=>{c.beginPath();c.ellipse(center.x,center.y,r,r*.72,0,0,TAU);c.strokeStyle=i?'#ced9ec':'#b8cbee';c.lineWidth=1.5;c.setLineDash(i?[4,10]:[]);c.stroke();c.setLineDash([]);});
      bots.forEach((b,i)=>{
        const a=i/7*TAU-Math.PI/2;const x=center.x+Math.cos(a)*317,y=center.y+Math.sin(a)*228;
        line(center.x,center.y,x,y,'#bdcef04d');
        if(t>3&&t<9){let p=(t*.48+i*.15)%1;dot(mix(x,center.x,p),mix(y,center.y,p),5,b[3]);}
        dot(x,y,59,'#fff');avatar(i,x,y,102,t,t>4&&t<9?'thinking':'idle');
      });
      shadowCard(1186,400,248,187,()=>{
        rr(1239,428,140,83,13,t>3&&t<9?'#3265ed':'#9aa9c0');
        en(t>3&&t<9?'>_':'z z',1309,482,35,'#fff',600,'center');line(1309,512,1309,533,C.ink,4);line(1283,535,1336,535,C.ink,4);
        txt(state,1310,567,23,C.ink,600,'center');
      });
    });
    group(t,1.2,()=>{
      const steps=['SLEEP','WAKE','EXECUTE','SLEEP'];const active=t<3?0:t<5?1:t<9?2:3;
      steps.forEach((s,i)=>{const x=140+i*437;dot(x,803,12,i===active?C.blue:'#c7d1de');if(i<3)line(x+26,803,x+411,803,'#c7d1de');en(s,x,858,20,i===active?C.blue:C.muted,600);});
      pill('InstaBox · 按需唤醒',112,638);
    });
  }
  function tools(t) {
    bg(t,true);header(4,true,'WORDS → TOOLS → RESULTS');
    heading('从一句话，','到真正动手。','03 / AGENT LOOP',t,true);
    group(t,.8,()=>{txt('查网页、跑命令、读写文件。',112,492,30,'#b5c5dd');txt('也能把想法变成图片。',112,548,30,'#b5c5dd');});
    group(t,1.1,()=>{
      rr(110,640,540,115,23,'#213456','#385482');avatar(0,159,697,73,t,'thinking');txt('帮我整理资料，并生成配图。',209,709,25,'#e7effd');
      pill('多步工具调用',112,809,'#b9d0ff','#253d68');
    });
    group(t,.5,()=>{
      shadowCard(771,216,1028,490,()=>{
        rr(771,216,1028,490,22,'#0b1629','#3b4f6c');
        [0,1,2].forEach(i=>dot(806+i*24,251,6,['#ee8a8d','#d9b76d','#72c09b'][i]));
        en('moyubot / cloud terminal',869,258,18,'#8398b9');
        const rows=[['$','抓取网页并整理关键资料'],['→','web_fetch · 读取来源'],['→','cloud_write · 保存 research.md'],['→','cloud_exec · 运行整理脚本'],['✓','输出已保存至 /data/moyubot'],['→','generate_image · 生成配图']];
        rows.forEach(([s,a],i)=>group(t,1.4+i*.85,()=>{en(s,812,332+i*57,24,i===4?'#88d8b2':'#8daeff');txt(a,857,332+i*57,25,i===4?'#88d8b2':'#d9e2f3');}));
      },22);
      en('流程演绎 · 实际执行依模型、工具及个人配置',790,750,18,'#8499ba',400);
    });
    group(t,6.9,()=>{
      shadowCard(1367,573,363,282,()=>{
        const grad=c.createLinearGradient(1367,573,1730,855);grad.addColorStop(0,'#a1c7ec');grad.addColorStop(1,'#e0e6cc');c.fillStyle=grad;c.fillRect(1367,573,363,282);
        c.fillStyle='#386c93';c.beginPath();c.moveTo(1367,790);c.quadraticCurveTo(1460,635,1572,795);c.quadraticCurveTo(1660,680,1730,750);c.lineTo(1730,855);c.lineTo(1367,855);c.fill();
        dot(1643,637,31,'#fff7d9');pill('配图示意',1382,590,C.ink,'#ffffffc9',15);
      },20);
    });
  }
  function memory(t) {
    bg(t);header(5);
    heading('记住你，','也记得下一件事。','04 / MEMORY & ROUTINES',t);
    group(t,.9,()=>{
      shadowCard(112,453,652,173,()=>{pill('长期记忆',136,476);txt('“报告用中文，先结论，再给依据。”',138,579,27,C.ink,500);},24);
      line(158,651,158,706,'#b3c5e7',2);dot(158,684,5,C.blue);
      shadowCard(112,712,652,139,()=>{en('09:00',138,768,36,C.blue,700);txt('整理今天的项目进展',292,768,27,C.ink,600);txt('通过对话创建、修改与暂停',139,818,23,C.muted);},24);
    });
    group(t,.55,()=>{screenshot('tasks',861,208,947,617,t);pill('对话会延续，偏好会留下',1010,849);});
    group(t,4,()=>txt('定时任务需保持应用运行',113,906,20,C.muted));
  }
  function control(t) {
    bg(t,true);header(6,true,'AUTOMATE THE WORK. KEEP THE CONTROL.');
    group(t,.15,()=>{en('05 / CONTROL & VISIBILITY',110,186,18,'#9ebaff');txt('把执行交出去。把掌控留下。',106,286,74,'#f5f7fc',700);});
    group(t,.6,()=>screenshot('usage',110,350,1090,547,t));
    group(t,1.1,()=>{
      shadowCard(1250,350,553,270,()=>{
        rr(1250,350,553,270,24,'#213456','#3b5278');pill('等待你的确认',1273,374,'#f1ca8a','#59472f',18);
        txt('允许执行这一步？',1276,474,32,'#fff',600);en('cloud_exec / run task',1277,519,22,'#b5c8e5');
        rr(1276,550,220,48,24,'#3265ed');txt(t>5?'已批准 ✓':'批准',1386,583,22,'#fff',600,'center');
        rr(1514,550,260,48,24,'#2b4265');txt('由你决定',1644,583,22,'#b9cbe6',500,'center');
      },24);
      rr(1250,650,553,247,24,'#1a2d4b','#3b5278');
      dot(1302,704,23,'#2a466e');en('⌑',1302,715,30,'#a0c3ff',500,'center');
      txt('密钥，本地加密。',1348,715,28,'#edf4ff',600);txt('系统级加密存储',1280,775,25,'#a9bedc');txt('用量统计，记录每次模型请求。',1280,831,24,'#a9bedc');
    });
  }
  function roadmap(t) {
    bg(t);header(7,false,'THE ROAD AHEAD / PLANNED FEATURES');
    group(t,.1,()=>pill('待开发 · 不代表当前可用',110,154,C.amber,'#f5e9d5',19));
    group(t,.35,()=>txt('下一站，连接更大的世界。',106,292,76,C.ink,700));
    const items=[['01','应用连接器 OAuth','Gmail / GitHub / Drive / Notion','已有列表界面，授权待接入'],['02','云电脑文件浏览器','目录浏览 / 上传下载 / 拖拽','规划中'],['03','移动端与审批','macOS / Android / iOS','跨平台与移动审批规划'],['04','MCP 工具生态','外部工具集 / 更多执行环境','规划中']];
    items.forEach(([n,title,sub,status],i)=>group(t,.75+i*.55,()=>{
      const x=110+(i%2)*867,y=369+Math.floor(i/2)*257;
      shadowCard(x,y,834,227,()=>{en(n,x+30,y+58,28,C.amber,600);txt(title,x+95,y+59,34,C.ink,700);en(sub,x+32,y+122,24,C.muted,400);pill(status,x+29,y+157,C.amber,'#f8f0e3',17);},26);
    }));
  }
  function chain(t) {
    bg(t,true);header(8,true,'MOYUCHAIN / CONCEPT STAGE');
    group(t,.12,()=>pill('设计阶段 · 尚未上线',110,159,'#efd19d','#59472f',19));
    group(t,.4,()=>{en('MoyuChain',105,334,94,'#fff',700);txt('让闲置的模型额度，',110,441,57,'#edf3ff',700);txt('流动起来。',110,518,57,'#9dbdff',700);});
    ['模型调用额度互助','可信计量与积分结算','独立于任务云电脑'].forEach((s,i)=>group(t,1.2+i*.6,()=>{dot(125,650+i*66,5,'#98b7fc');txt(s,149,659+i*66,27,'#b3c7e5');}));
    group(t,.7,()=>{
      const cx=1338,cy=517;
      const nodes=[[-254,-141,'提供者 A'],[250,-140,'使用者 A'],[240,189,'使用者 B'],[-238,198,'提供者 B']];
      nodes.forEach(([dx,dy,s],i)=>{
        const x=cx+dx,y=cy+dy;
        line(cx,cy,x,y,'#4d70a8',2);
        let p=(t*.32+i*.22)%1;dot(mix(x,cx,p),mix(y,cy,p),6,'#a5c5ff');
        dot(x,y,77,'#243c60');dot(x,y,61,'#1a2d4b');
        en(i<2?'API':'AI',x,y+12,36,'#a7c6ff',600,'center');txt(s,x,y+116,24,'#b5c9e6',400,'center');
      });
      c.save();c.translate(cx,cy);c.rotate(Math.PI/4);rr(-98,-98,196,196,44,'#3265ed');c.restore();
      txt('模型额度',cx,cy-5,31,'#fff',600,'center');en('EXCHANGE',cx,cy+36,20,'#d4e3ff',600,'center');
      en('A SHARED IDEA. STILL TAKING SHAPE.',cx,860,17,'#7995bc',500,'center');
    });
  }
  function outro(t) {
    bg(t);header(9,false,'OPEN SOURCE / BUILT IN THE OPEN');
    group(t,.15,()=>{c.drawImage(assets.logo,903,140,114,114);en('MoyuBot',960,365,103,C.ink,700,'center');});
    group(t,.6,()=>txt('让 AI 上班，你负责摸鱼。',960,460,54,C.blue,700,'center'));
    bots.forEach((b,i)=>group(t,.8+i*.13,()=>avatar(i,534+i*142,572,127,t,'happy')));
    group(t,1.3,()=>{
      en('EXPLORE THE PROJECT',960,701,17,C.muted,600,'center');
      shadowCard(486,727,948,89,()=>{en('WEB',517,783,17,C.muted,600);en('moyubot.net',960,785,38,C.blue,650,'center');en('↗',1390,785,28,C.blue);},22);
      shadowCard(360,836,1200,73,()=>{en('GITHUB',390,882,17,C.muted,600);en('github.com/whitemoono/moyubot',1020,884,30,C.ink,600,'center');},20);
    });
  }
  const scenes=[intro,cast,workspace,cloud,tools,memory,control,roadmap,chain,outro];
  function captions(t) {
    const cue=story.cues.find(q=>t>=q.start&&t<q.end);if(!cue)return;
    c.save();c.font=`500 27px ${FONT}`;const w=c.measureText(cue.text).width+62;
    rr((W-w)/2,971,w,55,17,'#13233de8');txt(cue.text,960,1007,27,'#f6f8ff',500,'center');c.restore();
  }
  function render(t) {
    t=clamp(t,0,111.999);let i=story.scenes.findIndex(s=>t>=s.start&&t<s.end);if(i<0)i=9;
    const s=story.scenes[i],local=t-s.start;c.clearRect(0,0,W,H);
    scenes[i](local);
    // A short paper wipe on each cut. It is time driven and survives random seeking.
    if(i>0&&local<.32){c.save();c.fillStyle=C.paper;c.fillRect(W*ease(local/.32),0,W,H);c.restore();}
    captions(t);
    c.fillStyle='#cad5e4';c.fillRect(98,1048,1724,2);c.fillStyle=C.blue;c.fillRect(98,1048,1724*t/112,2);
    en('MOYUBOT / PRODUCT FILM',98,1036,12,'#7e8ea5',500);en('2026',1822,1036,12,'#7e8ea5',500,'right');
    return canvas;
  }
  async function init() {
    story=await (await fetch('story.json')).json();
    for(const b of bots){const g=window.GROK_GEO.shapes[b[0]];paths[b[0]]={path:new Path2D(g.path),decals:(g.decals||[]).map(d=>({...d,path:new Path2D(d.d)})),face:g.iconFace};}
    const sources={logo:'../../apps/desktop/src/assets/brand/logo.png',home:'../../docs/screenshots/home.png',group:'../../docs/screenshots/group-replies.png',tasks:'../../docs/screenshots/bot-tasks.png',usage:'../../docs/screenshots/usage-dark.png'};
    await Promise.all(Object.entries(sources).map(([name,url])=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{assets[name]=img;resolve();};img.onerror=()=>reject(new Error(`Missing image: ${url}`));img.src=url;})));
    await document.fonts.ready;
    for(const name of ['home','group','tasks'])assets[name]=synchronizeScreenshot(name,assets[name]);
    window.film={render,story,bots,canvas};
    const query=new URLSearchParams(location.search);
    if(query.has('render')){document.body.classList.add('render');render(+(query.get('t')||0));window.FILM_READY=true;return;}
    const audio=document.querySelector('#audio'),play=document.querySelector('#play'),seek=document.querySelector('#seek'),clock=document.querySelector('#clock');
    let playing=false,time=+(query.get('t')||0),start=0,base=0;
    const fmt=t=>`${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`;
    function update(){if(playing){time=Math.min(112,base+(performance.now()-start)/1000);if(time>=112){playing=false;audio.pause();play.textContent='重播';}}
      render(time);seek.value=time;clock.textContent=`${fmt(time)} / 01:52`;requestAnimationFrame(update);}
    function toggle(){if(playing){playing=false;audio.pause();play.textContent='播放';}else{if(time>=112)time=0;base=time;start=performance.now();audio.currentTime=time;audio.play().catch(()=>{});playing=true;play.textContent='暂停';}}
    function jump(t){time=clamp(t,0,112);base=time;start=performance.now();audio.currentTime=time;}
    play.onclick=toggle;seek.oninput=()=>jump(+seek.value);
    document.querySelector('#mute').onclick=e=>{audio.muted=!audio.muted;e.target.textContent=audio.muted?'开启声音':'静音';};
    document.addEventListener('keydown',e=>{if(e.target.tagName==='INPUT')return;if(e.code==='Space'){e.preventDefault();toggle();}if(e.code==='ArrowRight')jump(time+5);if(e.code==='ArrowLeft')jump(time-5);});
    update();window.FILM_READY=true;
  }
  init().catch(e=>{window.FILM_ERROR=String(e);console.error(e);});
})();
