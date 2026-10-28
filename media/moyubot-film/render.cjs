/* Headless Chrome / Playwright renderer. No application window is shown. */
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const ROOT=__dirname,repo=path.resolve(ROOT,'../..'),out=path.join(ROOT,'output');
let playwright;
try{playwright=require('playwright');}catch{
  const bundled=process.env.MOYU_PLAYWRIGHT_PATH||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  playwright=require(bundled);
}
const qa=process.argv.includes('--qa');
const server=require('./serve.cjs');
let browser,encoder;
(async()=>{
  fs.mkdirSync(out,{recursive:true});server.listen(0,'localhost');await once(server,'listening');
  browser=await playwright.chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu','--force-color-profile=srgb']});
  const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(`http://localhost:${server.address().port}/media/moyubot-film/?render=1`);
  await page.waitForFunction(()=>window.FILM_READY||window.FILM_ERROR);
  const error=await page.evaluate(()=>window.FILM_ERROR);if(error)throw new Error(error);
  if(qa){
    fs.mkdirSync(path.join(out,'frames'),{recursive:true});
    for(const t of [0,5,15,25,29,38,52,63,75,86,96,107]){
      const data=await page.evaluate(t=>{film.render(t);return film.canvas.toDataURL('image/png').split(',')[1];},t);
      fs.writeFileSync(path.join(out,'frames',`frame-${String(t).padStart(3,'0')}.png`),Buffer.from(data,'base64'));console.log(`QA frame ${t}s`);
    }
    for(const t of [7.99,8,19.99,20,31.99,32,43.99,44,55.99,56,67.99,68,79.99,80,89.99,90,99.99,100,111.999])
      await page.evaluate(t=>{film.render(t);},t);
    if(errors.length)throw new Error(errors.join('\n'));
    console.log('QA passed: 12 stills, 20 boundary/seek checks, no runtime errors.');
  }else{
    const ffmpeg=process.env.MOYU_FFMPEG||path.join(repo,'.work','video-tools','imageio_ffmpeg','binaries','ffmpeg-win-x86_64-v7.1.exe');
    if(!fs.existsSync(ffmpeg))throw new Error('Set MOYU_FFMPEG to your ffmpeg executable.');
    const args=['-y','-hide_banner','-loglevel','warning','-f','image2pipe','-vcodec','mjpeg','-framerate','30','-i','pipe:0','-i',path.join(out,'master.wav'),'-i',path.join(out,'MoyuBot.zh-CN.srt'),'-map','0:v:0','-map','1:a:0','-map','2:s:0','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-c:a','aac','-b:a','192k','-c:s','mov_text','-metadata:s:s:0','language=zho','-metadata','title=MoyuBot — 让 AI 上班，你负责摸鱼','-metadata','comment=Original Canvas animation, original music, Chinese synthetic narration. Planned features labeled.','-t','112','-movflags','+faststart',path.join(out,'MoyuBot-Introduction-1080p.mp4')];
    // Burned captions are already visible; keep the selectable track disabled by default.
    args.splice(args.length-1,0,'-disposition:s:0','0');
    encoder=spawn(ffmpeg,args,{stdio:['pipe','ignore','pipe'],windowsHide:true});
    const logs=[];encoder.stderr.on('data',d=>logs.push(d.toString()));
    let failure;encoder.on('error',e=>failure=e);encoder.stdin.on('error',e=>failure=e);
    const completion=once(encoder,'close'),start=Date.now();
    for(let frame=0;frame<3360;frame++){
      if(failure)throw failure;
      const data=await page.evaluate(frame=>{film.render(frame/30);return film.canvas.toDataURL('image/jpeg',.96).split(',')[1];},frame);
      if(!encoder.stdin.write(Buffer.from(data,'base64')))await once(encoder.stdin,'drain');
      if(frame%300===0)console.log(`Rendered ${(frame/30).toFixed(0)} / 112 seconds (${((Date.now()-start)/1000).toFixed(1)}s elapsed)`);
    }
    encoder.stdin.end();const [code]=await completion;fs.writeFileSync(path.join(out,'render.log'),logs.join(''));
    if(code!==0)throw new Error(`FFmpeg failed: ${logs.join('').slice(-2500)}`);
    if(errors.length)throw new Error(errors.join('\n'));
    console.log(`MP4 complete in ${((Date.now()-start)/1000).toFixed(1)} seconds`);
  }
  await browser.close();server.close();
})().catch(async error=>{console.error(error);encoder?.kill();await browser?.close();server.close();process.exitCode=1;});
