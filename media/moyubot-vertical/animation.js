// Deterministic Canvas film: every frame is a pure function of time.
// Product interfaces are editable workflow illustrations, not captured screens.
(() => {
 const W=1080,H=1920,ink='#17263f',blue='#3270ea',muted='#7a889e',paper='#f5f6f8',TAU=Math.PI*2;
 const bots=[['chibi','大肥鱼','#5890f0'],['nemu','千金','#a8b8fd'],['shiro','小龙娘','#cdbfef'],['mikan','大小姐','#f7844c'],['neko','小猫娘','#91a7f7'],['tsuki','雌小鬼','#f6d7b4'],['zeta','夜猫','#343542']];
 const canvas=document.querySelector('#film'),c=canvas.getContext('2d');let story,logo,geo={};
 const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x)),ease=x=>1-(1-clamp(x))**3;
 function rr(x,y,w,h,r=12,fill='#fff',stroke){c.beginPath();c.roundRect(x,y,w,h,r);if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=1.4;c.stroke();}}
 function txt(s,x,y,size=24,color=ink,weight=500,align='left',font='"Microsoft YaHei",sans-serif'){c.font=`${weight} ${size}px ${font}`;c.fillStyle=color;c.textAlign=align;c.textBaseline='alphabetic';c.fillText(s,x,y);}
 function center(s,x,y,size=24,color=ink,weight=500){txt(s,x,y,size,color,weight,'center');}
 function dot(x,y,r,color){c.beginPath();c.arc(x,y,r,0,TAU);c.fillStyle=color;c.fill();}
 function line(x,y,X,Y,color='#dce3ed',width=1.5){c.beginPath();c.moveTo(x,y);c.lineTo(X,Y);c.strokeStyle=color;c.lineWidth=width;c.stroke();}
 function card(x,y,w,h,fill='#fff',stroke='#dfe5ed'){c.save();c.shadowColor='#20395614';c.shadowBlur=24;c.shadowOffsetY=10;rr(x,y,w,h,18,fill,stroke);c.restore();}
 function pill(s,x,y,fill='#eaf0fc',color=blue,size=25){c.font=`600 ${size}px "Microsoft YaHei",sans-serif`;const w=c.measureText(s).width+36;rr(x,y,w,49,24,fill);center(s,x+w/2,y+33,size,color,600);return w;}
 function group(t,start,fn){const p=ease((t-start)/.45);if(!p)return;c.save();c.globalAlpha*=p;c.translate(0,(1-p)*18);fn();c.restore();}
 function type(s,t,start,duration){return [...s].slice(0,Math.floor(clamp((t-start)/duration)*[...s].length)).join('');}
 function cover(t,dark=false){c.fillStyle=dark?'#111c30':paper;c.fillRect(0,0,W,H);const g=c.createRadialGradient(790+Math.sin(t*.3)*40,500,30,540,750,1500);g.addColorStop(0,dark?'#29457188':'#dfe9ff');g.addColorStop(1,dark?'#111c3000':'#f5f6f800');c.fillStyle=g;c.fillRect(0,0,W,H);c.fillStyle=dark?'#ffffff15':'#263a5415';for(let x=56;x<W;x+=42)for(let y=48;y<H;y+=42)c.fillRect(x,y,1.2,1.2);}
 function avatar(i,x,y,size,t,expression='idle'){
  const g=geo[bots[i][0]],ph=t*2.7+i*1.2,blink=(t+i*.71)%4.1<.14?Math.max(.08,Math.abs((t+i*.71)%4.1-.07)/.07):1;
  c.save();c.translate(x,y+Math.sin(ph)*2.2);c.rotate(Math.sin(ph*.42)*.023);c.scale(size/245,size/245);c.translate(-114.5,-114.5);c.fillStyle=bots[i][2];c.fill(g.path);g.decals.forEach(d=>{c.fillStyle=d.fill;c.fill(d.path,d.rule||'nonzero');});
  const f=g.face;if(f)f.anchors.forEach(([ex,ey])=>{c.save();c.translate(ex,ey);c.fillStyle=c.strokeStyle=f.ink||'#1a1a1f';c.lineWidth=2.3;if(expression==='happy'||expression==='sleepy'){c.beginPath();c.moveTo(-f.rx,1);c.quadraticCurveTo(0,expression==='happy'?-f.ry*.6:5,f.rx,1);c.stroke();}else{c.scale(1,blink);rr(-f.rx,-f.ry,f.rx*2,f.ry*2,Math.min(4,f.rx),f.ink||'#1a1a1f');}c.restore();});c.restore();
 }
 function pointer(x,y,t,click=false){c.save();c.translate(x,y);if(click){c.globalAlpha=.45+.2*Math.sin(t*8);c.strokeStyle=blue;c.lineWidth=3;c.beginPath();c.arc(0,0,16+7*((t*2)%1),0,TAU);c.stroke();c.globalAlpha=1;}c.beginPath();c.moveTo(0,0);c.lineTo(0,29);c.lineTo(8,22);c.lineTo(13,34);c.lineTo(19,31);c.lineTo(14,20);c.lineTo(26,20);c.closePath();c.fillStyle='#fff';c.fill();c.strokeStyle='#24334c';c.lineWidth=2;c.stroke();c.restore();}
