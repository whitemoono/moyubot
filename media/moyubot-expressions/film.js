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
 const geo={};let logo;
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
 function header(t,dark=false){if(logo)c.drawImage(logo,68,83,49,49);text('MoyuBot',135,119,29,dark?'#fff':ink,700,'left');en('EXPRESSION STUDIO',1011,116,17,dark?'#adb9d4':'#8893a6','right');
  rect(68,1790,944,3,2,dark?'#ffffff22':'#dce1ed');rect(68,1790,944*t/80,3,2,'#6586ee');en('moyubot.net',68,1845,22,dark?'#dbe4ff':'#74839e','left');en('07 BOTS / 08 MOODS',1012,1845,17,dark?'#a9b7d0':'#8c96a8','right');}
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
  const f=g.face,phase=(t+i*.53)%3.6,blink=phase<.2?Math.max(.03,Math.abs(phase-.1)/.1):1;
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
 function intro(t){
  background(t,0);header(t);appear(t,.1,()=>{en('SEVEN LITTLE PERSONALITIES',540,285,22);text('七种个性',540,415,101,ink,700);text('百种心情。',540,541,101,'#6385df',700);});
  const places=[[360,780],[720,780],[220,1060],[540,1060],[860,1060],[370,1340],[710,1340]];
  bots.forEach((b,i)=>appear(t,.35+i*.12,()=>{const [x,y]=places[i];circle(x,y,118,b.pale);avatar(i,x,y,230,i%2?'wink':'happy',t);text(b.name,x,y+148,27,ink,600);}));
  appear(t,1.8,()=>{pill('今天，你是哪一种心情？',540,1585,'#6079bb','#e8edf9');});
 }
 function solo(i,t,global){
  const b=bots[i],slot=Math.min(7,Math.floor(t/1.25)),local=t-slot*1.25,mi=orders[i][slot],m=moods[mi];
  background(global,i);header(global);
  en(`CHARACTER ${String(i+1).padStart(2,'0')} / 07`,540,271,25);
  text(b.name,540,416,110,ink,700);text(b.tag,540,490,30,'#8e96a5',400);
  // The title panel stays stable while eyes and poses change on the musical beat.
  const entry=ease(t/.55),exit=ease((10-t)/.3),pop=1+Math.sin(Math.min(1,local/.35)*Math.PI)*.023;
  c.save();c.globalAlpha=entry*exit;c.translate(540,927+(1-entry)*50);c.scale(entry*.12+.88,entry*.12+.88);
  circle(0,0,363,'#ffffffbb');c.save();c.translate(0,290);c.scale(1,.11);circle(0,0,225,b.color+'20');c.restore();
  avatar(i,0,-15,693*pop,m[0],global,local);decorations(m[0],0,-15,693,global,b.color);c.restore();
  pill(m[1],540,1350,ink,'#ffffffdc');en(m[2],540,1459,21);
  moods.forEach((mood,j)=>{const x=183+j%4*238,y=1548+Math.floor(j/4)*88;const active=mi===j;rect(x-102,y-31,204,62,31,active?ink:'#ffffff88');text(mood[1],x,y+9,24,active?'#fff':'#8c96a6',active?600:400);});
 }
 function ensemble(t,global){
  background(global,1,true);header(global,true);
  appear(t,.05,()=>{en('A MOOD FOR EVERY MOMENT',540,277,23,'#aabce5');text('你喜欢哪一个？',540,404,74,'#fff',700);});
  const places=[[335,660],[745,660],[220,1008],[540,1008],[860,1008],[340,1360],[740,1360]];
  bots.forEach((b,i)=>appear(t,.12+i*.06,()=>{const [x,y]=places[i];const mood=t<2?moods[(i+1)%8][0]:t<4?'wink':'happy';circle(x,y,117,b.pale);avatar(i,x,y,238,mood,global);text(b.name,x,y+157,29,'#e5eaff',600);}));
  appear(t,.8,()=>{text('每一种心情，都有人陪。',540,1650,34,'#c6d6f8');});
 }
 function render(t){t=Math.max(0,Math.min(79.999,t));c.clearRect(0,0,W,H);if(t<4)intro(t);else if(t<74){let i=Math.floor((t-4)/10);solo(i,t-4-i*10,t);}else ensemble(t-74,t);
  // Short soft wipe at character cuts, without flashing or full-screen strobes.
  const cut=t>=4&&t<74?(t-4)%10:t>=74?t-74:t;
  if(t>=4&&cut<.18){c.fillStyle='#faf8f3';c.globalAlpha=1-smooth(cut/.18);c.fillRect(0,190,W,1560);c.globalAlpha=1;}
  return canvas;
 }
 async function init(){
  bots.forEach(b=>{const g=window.GROK_GEO.shapes[b.shape];geo[b.shape]={path:new Path2D(g.path),decals:(g.decals||[]).map(d=>({...d,path:new Path2D(d.d)})),face:g.iconFace};});
  logo=await new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src='../../apps/desktop/src/assets/brand/logo.png';});await document.fonts.ready;
  window.film={render,bots,moods,orders,canvas,duration:80};
  if(new URLSearchParams(location.search).has('render')){document.body.classList.add('render');render(6);window.FILM_READY=true;return;}
  const audio=document.querySelector('#audio'),play=document.querySelector('#play'),seek=document.querySelector('#seek'),clock=document.querySelector('#clock');let playing=false,time=0,base=0,start=0;
  const fmt=t=>`${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`;
  function tick(){if(playing){time=Math.min(80,base+(performance.now()-start)/1000);if(time>=80){playing=false;audio.pause();play.textContent='重播';}}render(time);seek.value=time;clock.textContent=`${fmt(time)} / 01:20`;requestAnimationFrame(tick);}
  function toggle(){if(playing){playing=false;audio.pause();play.textContent='播放';}else{if(time>=80)time=0;start=performance.now();base=time;audio.currentTime=time;audio.play().catch(()=>{});playing=true;play.textContent='暂停';}}
  function jump(t){time=Math.max(0,Math.min(80,t));base=time;start=performance.now();audio.currentTime=time;}
  play.onclick=toggle;seek.oninput=()=>jump(+seek.value);document.querySelector('#mute').onclick=e=>{audio.muted=!audio.muted;e.target.textContent=audio.muted?'开启声音':'静音';};
  document.addEventListener('keydown',e=>{if(e.target.tagName==='INPUT')return;if(e.code==='Space'){e.preventDefault();toggle();}if(e.code==='ArrowLeft')jump(time-5);if(e.code==='ArrowRight')jump(time+5);});tick();window.FILM_READY=true;
 }
 init().catch(e=>{window.FILM_ERROR=String(e);console.error(e);});
})();
