// Product-native vector cover. Edit copy and composition here, then run cover.cjs.
(async()=>{
const canvas=document.querySelector('#cover'),c=canvas.getContext('2d');
const bots=[['chibi','#5890f0'],['nemu','#a8b8fd'],['shiro','#cdbfef'],['mikan','#f7844c'],['neko','#91a7f7'],['tsuki','#f6d7b4'],['zeta','#343542']];
const logo=await new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src='../../apps/desktop/src/assets/brand/logo.png';});
await document.fonts.ready;
function rr(x,y,w,h,r,fill,stroke){c.beginPath();c.roundRect(x,y,w,h,r);if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.lineWidth=2;c.strokeStyle=stroke;c.stroke();}}
function text(s,x,y,size,color='#fff',weight=900,font='"Microsoft YaHei",sans-serif'){c.font=`${weight} ${size}px ${font}`;c.fillStyle=color;c.fillText(s,x,y);}
function line(x,y,X,Y,color,width=2){c.beginPath();c.moveTo(x,y);c.lineTo(X,Y);c.lineWidth=width;c.strokeStyle=color;c.stroke();}
function dot(x,y,r,color){c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fillStyle=color;c.fill();}
function portrait(i,x,y,size,angle=0){const g=window.GROK_GEO.shapes[bots[i][0]],f=g.iconFace;c.save();c.translate(x,y);c.rotate(angle);c.scale(size/245,size/245);c.translate(-114.5,-114.5);c.fillStyle=bots[i][1];c.fill(new Path2D(g.path));for(const d of g.decals||[]){c.fillStyle=d.fill;c.fill(new Path2D(d.d),d.rule||'nonzero');}if(f){c.strokeStyle=f.ink||'#1a1a1f';c.fillStyle=c.strokeStyle;c.lineWidth=2.8;for(const [x,y]of f.anchors){if(i===0||i===4){c.beginPath();c.moveTo(x-f.rx,y+1);c.quadraticCurveTo(x,y-f.ry*.6,x+f.rx,y+1);c.stroke();}else if(i===1){c.beginPath();c.moveTo(x-f.rx,y);c.lineTo(x+f.rx,y);c.stroke();}else rr(x-f.rx,y-f.ry,f.rx*2,f.ry*2,3,c.fillStyle);}}c.restore();}
function medallion(i,x,y,size,angle=0){c.save();c.shadowColor='#0005';c.shadowBlur=25;c.shadowOffsetY=15;dot(x,y,size*.55,'#eef3ff');c.restore();c.save();c.beginPath();c.arc(x,y,size*.55,0,Math.PI*2);c.clip();const g=c.createLinearGradient(x,y-size,x,y+size);g.addColorStop(0,'#fff');g.addColorStop(1,bots[i][1]+'55');c.fillStyle=g;c.fillRect(x-size,y-size,size*2,size*2);c.restore();portrait(i,x,y,size,angle);}
function draw(height=1200){canvas.width=1920;canvas.height=height;c.textBaseline='alphabetic';c.textAlign='left';const offset=(height-1080)/2;
const bg=c.createLinearGradient(0,0,1920,height);bg.addColorStop(0,'#07172d');bg.addColorStop(.54,'#102b55');bg.addColorStop(1,'#2844bd');c.fillStyle=bg;c.fillRect(0,0,1920,height);
const glow=c.createRadialGradient(1505,height*.44,30,1505,height*.44,800);glow.addColorStop(0,'#3b71ff8c');glow.addColorStop(1,'#14326700');c.fillStyle=glow;c.fillRect(0,0,1920,height);
c.save();c.translate(0,offset);c.strokeStyle='#9cbdff10';c.lineWidth=1;for(let x=0;x<1920;x+=80)line(x,0,x,1080,'#9cbdff10',1);for(let y=0;y<1080;y+=80)line(0,y,1920,y,'#9cbdff10',1);
// Large diagonal sweep gives the character area a separate blue field.
c.beginPath();c.moveTo(1230,-100);c.lineTo(1920,-100);c.lineTo(1920,1180);c.lineTo(910,1180);c.closePath();c.fillStyle='#4d6dff13';c.fill();
c.drawImage(logo,99,71,76,76);text('MoyuBot',197,124,43,'#fff',750);rr(428,82,203,48,24,'#e7ff7220','#dfff7255');text('开源 · 免费下载',451,114,23,'#deff80',700);
// Hook and two-line primary title, kept within a generous crop-safe area.
text('Grok',93,381,213,'#fff',900,'Arial,sans-serif');text('？',585,379,184,'#dfff72',900);
rr(100,421,86,8,4,'#cfff6c');text('让 AI 上班',94,604,133,'#fff',900);text('你负责摸鱼',94,772,133,'#dfff72',900);
text('7 个 AI 搭子，替你动手干活',105,865,38,'#c1d2ee',600);
rr(102,935,285,60,13,'#f1f5ff');text('v0.1.0 已上线',124,976,31,'#162b56',800);text('moyubot.net',422,976,31,'#b9d0f7',600,'Consolas,monospace');
// Real product identities surround one shared computer.
c.save();c.translate(1455,610);c.rotate(-.045);c.shadowColor='#0005';c.shadowBlur=46;c.shadowOffsetY=25;rr(-372,-220,744,462,27,'#f5f8ff','#b9d1ff');c.shadowColor='transparent';rr(-372,-220,744,55,27,'#dce7fc');c.fillStyle='#dce7fc';c.fillRect(-372,-192,744,27);['#fe8276','#efc45b','#66be92'].forEach((color,i)=>dot(-339+i*24,-192,6,color));text('MoyuBot · 云电脑',-229,-183,20,'#627da7',650);rr(-347,-144,694,361,17,'#e8effe');
rr(-324,93,648,96,15,'#132742');text('✓ 任务完成，文件已保存',-295,134,24,'#b7f2d1',650);text('$ let AI work; you relax',-295,170,19,'#8daccf',500,'Consolas,monospace');
portrait(0,6,-43,280,-.025);c.restore();
// Six supporting portraits + the main chibi above = seven characters.
medallion(1,1169,318,151,-.11);medallion(2,1427,256,159,.025);medallion(3,1693,319,157,.10);medallion(4,1120,842,154,-.12);medallion(5,1432,938,158,.04);medallion(6,1724,855,156,.07);
// A distinct small cloud badge and mouse link the artwork to tool use.
rr(1538,460,230,49,24,'#2b59d8');text('一台共享电脑',1560,493,25,'#fff',700);
c.save();c.translate(1728,691);c.rotate(-.12);c.beginPath();c.moveTo(0,0);c.lineTo(0,91);c.lineTo(25,70);c.lineTo(43,109);c.lineTo(62,99);c.lineTo(45,63);c.lineTo(83,63);c.closePath();c.fillStyle='#dfff72';c.fill();c.strokeStyle='#10214d';c.lineWidth=5;c.stroke();c.restore();
c.restore();window.COVER_READY=true;return canvas;}
window.cover={draw};draw();
})().catch(e=>{window.COVER_ERROR=String(e);console.error(e);});
