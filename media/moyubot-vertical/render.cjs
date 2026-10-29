const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process'),{once}=require('node:events');
let pw;try{pw=require('playwright');}catch{pw=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
const root=__dirname,repo=path.resolve(root,'../..'),out=path.join(root,'output'),qa=process.argv.includes('--qa');
const server=require('../moyubot-film/serve.cjs');let browser,encoder;
(async()=>{
 fs.mkdirSync(path.join(out,'frames'),{recursive:true});server.listen(0,'localhost');await once(server,'listening');
 browser=await pw.chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu','--force-color-profile=srgb']});
 const page=await browser.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(`http://localhost:${server.address().port}/media/moyubot-vertical/?render=1`);await page.waitForFunction(()=>window.FILM_READY||window.FILM_ERROR);
 const error=await page.evaluate(()=>window.FILM_ERROR);if(error)throw new Error(error);
 if(qa){
  // Scene layouts, deterministic backward seeks and all cut boundaries.
  for(const t of [2.5,9,15,19,21.5,23.4,24.9,26.2,29,33,37.3,40.6,45.5,49,52.5,55.6,60.6,63.8,66,68,71.8,76.5,82,88]){
   const png=await page.evaluate(t=>{film.render(t);return film.canvas.toDataURL('image/png').split(',')[1];},t);
   fs.writeFileSync(path.join(out,'frames',`frame-${t.toFixed(1).padStart(4,'0')}.png`),Buffer.from(png,'base64'));
  }
  for(const t of [89.999,0,5,17,27,35,47,57,70,74,84,4.999,16.999,26.999,34.999,46.999,56.999,69.999,73.999,83.999])await page.evaluate(t=>film.render(t),t);
  const audit=await page.evaluate(()=>{
   const original=CanvasRenderingContext2D.prototype.fillText,bad=[];let now;
   CanvasRenderingContext2D.prototype.fillText=function(s,x,y,...rest){
    const w=this.measureText(s).width,m=this.getTransform(),left=this.textAlign==='center'?x-w/2:this.textAlign==='right'?x-w:x;
    if(m.a===1&&m.d===1&&(left+m.e<55||left+w+m.e>1010||y+m.f>1880))bad.push({time:now,text:s,left:left+m.e,right:left+w+m.e,y:y+m.f});
    return original.call(this,s,x,y,...rest);
   };
   for(let f=0;f<900;f++){now=f/10;film.render(now);}
   CanvasRenderingContext2D.prototype.fillText=original;
   film.render(63.8);const before=film.canvas.toDataURL();film.render(0);film.render(89.9);film.render(63.8);
   return {overflow:bad,deterministic:before===film.canvas.toDataURL()};
  });
  if(audit.overflow.length||!audit.deterministic)throw new Error(JSON.stringify(audit));
  if(errors.length)throw new Error(errors.join('\n'));console.log('QA passed: ten scenes, screenshots, arbitrary seek and transition checks.');
 }else{
  const ffmpeg=process.env.MOYU_FFMPEG||path.join(repo,'.work/video-tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe');
  const args=['-y','-hide_banner','-loglevel','warning','-f','image2pipe','-vcodec','mjpeg','-framerate','30','-i','pipe:0','-i',path.join(out,'master.wav'),'-map','0:v','-map','1:a','-vf','scale=in_range=full:out_range=tv:out_color_matrix=bt709','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-color_range','tv','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-c:a','aac','-b:a','192k','-t','90','-metadata','title=MoyuBot v0.1.0 · 90 秒竖屏产品介绍','-movflags','+faststart',path.join(out,'MoyuBot-Introduction-90s-Vertical.mp4')];
  encoder=spawn(ffmpeg,args,{stdio:['pipe','ignore','pipe'],windowsHide:true});const logs=[];let failed;encoder.stderr.on('data',d=>logs.push(String(d)));encoder.on('error',e=>failed=e);encoder.stdin.on('error',e=>failed=e);const done=once(encoder,'close'),start=Date.now();
  for(let f=0;f<2700;f++){
   if(failed)throw failed;const data=await page.evaluate(f=>{film.render(f/30);return film.canvas.toDataURL('image/jpeg',.96).split(',')[1];},f);
   if(!encoder.stdin.write(Buffer.from(data,'base64')))await once(encoder.stdin,'drain');if(f%600===0)console.log(`Rendered ${f/30}/90s (${((Date.now()-start)/1000).toFixed(1)}s elapsed)`);
  }
  encoder.stdin.end();const [code]=await done;fs.writeFileSync(path.join(out,'render.log'),logs.join(''));if(code!==0)throw new Error(logs.join(''));if(errors.length)throw new Error(errors.join('\n'));console.log('90 second vertical MP4 complete.');
 }
 await browser.close();server.close();
})().catch(async e=>{console.error(e);encoder?.kill();await browser?.close();server.close();process.exitCode=1;});
