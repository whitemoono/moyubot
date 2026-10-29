const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process'),{once}=require('node:events');
let pw;try{pw=require('playwright');}catch{pw=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
const root=__dirname,repo=path.resolve(root,'../..'),out=path.join(root,'output'),qa=process.argv.includes('--qa');
const server=require('../moyubot-film/serve.cjs');let browser,encoder;
(async()=>{
 fs.mkdirSync(path.join(out,'frames'),{recursive:true});server.listen(0,'localhost');await once(server,'listening');
 browser=await pw.chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu','--force-color-profile=srgb']});
 const page=await browser.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(`http://localhost:${server.address().port}/media/moyubot-expressions/?render=1`);await page.waitForFunction(()=>window.FILM_READY||window.FILM_ERROR);
 const error=await page.evaluate(()=>window.FILM_ERROR);if(error)throw new Error(error);
 if(qa){
  // Seven portraits and all eight expressions, including arbitrary backward seeks.
  for(const t of [2.5,5.7,16.7,27.9,36.7,46.7,55.7,66.7,77.5]){
   const png=await page.evaluate(t=>{film.render(t);return film.canvas.toDataURL('image/png').split(',')[1];},t);
   fs.writeFileSync(path.join(out,'frames',`frame-${t.toFixed(1).padStart(4,'0')}.png`),Buffer.from(png,'base64'));
  }
  const expressions=[];
  for(let m=0;m<8;m++){
   const t=4+m*1.25+.6;
   const png=await page.evaluate(t=>{film.render(t);return film.canvas.toDataURL('image/png').split(',')[1];},t);
   fs.writeFileSync(path.join(out,'frames',`mood-${m}.png`),Buffer.from(png,'base64'));expressions.push(t);
  }
  for(const t of [79.999,0,4,14,24,34,44,54,64,74,13.999,23.999,73.999,5.249,5.25])await page.evaluate(t=>{film.render(t);},t);
  if(errors.length)throw new Error(errors.join('\n'));console.log('Portrait QA passed: all seven characters, eight moods and transition/seek checks.');
 }else{
  const ffmpeg=process.env.MOYU_FFMPEG||path.join(repo,'.work/video-tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe');
  const args=['-y','-hide_banner','-loglevel','warning','-f','image2pipe','-vcodec','mjpeg','-framerate','30','-i','pipe:0','-i',path.join(out,'master.wav'),'-map','0:v','-map','1:a','-vf','scale=in_range=full:out_range=tv:out_color_matrix=bt709','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-color_range','tv','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-c:a','aac','-b:a','192k','-t','80','-metadata','title=MoyuBot · 七种个性，百种心情','-movflags','+faststart',path.join(out,'MoyuBot-Expressions-Vertical.mp4')];
  encoder=spawn(ffmpeg,args,{stdio:['pipe','ignore','pipe'],windowsHide:true});const logs=[];let failed;encoder.stderr.on('data',d=>logs.push(String(d)));encoder.on('error',e=>failed=e);encoder.stdin.on('error',e=>failed=e);const done=once(encoder,'close'),start=Date.now();
  for(let f=0;f<2400;f++){
   if(failed)throw failed;const data=await page.evaluate(f=>{film.render(f/30);return film.canvas.toDataURL('image/jpeg',.96).split(',')[1];},f);
   if(!encoder.stdin.write(Buffer.from(data,'base64')))await once(encoder.stdin,'drain');if(f%300===0)console.log(`Rendered ${f/30}/80s (${((Date.now()-start)/1000).toFixed(1)}s elapsed)`);
  }
  encoder.stdin.end();const [code]=await done;fs.writeFileSync(path.join(out,'render.log'),logs.join(''));if(code!==0)throw new Error(logs.join(''));if(errors.length)throw new Error(errors.join('\n'));console.log('Vertical MP4 complete.');
 }
 await browser.close();server.close();
})().catch(async e=>{console.error(e);encoder?.kill();await browser?.close();server.close();process.exitCode=1;});
