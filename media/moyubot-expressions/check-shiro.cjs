// Inspect all eight Shiro expressions, including the eye area at full resolution.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{once}=require('node:events');
const {chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const server=require('../moyubot-film/serve.cjs');let browser;
(async()=>{
 server.listen(0,'localhost');await once(server,'listening');browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu','--force-color-profile=srgb']});
 const page=await browser.newPage({viewport:{width:1080,height:1920}});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(`http://localhost:${server.address().port}/media/moyubot-expressions/?render=1`);await page.waitForFunction(()=>window.FILM_READY||window.FILM_ERROR);
 const result=await page.evaluate(()=>{
  if(window.FILM_ERROR)throw Error(window.FILM_ERROR);
  const canvas=document.createElement('canvas');canvas.width=1240;canvas.height=740;const c=canvas.getContext('2d');c.fillStyle='#faf8f3';c.fillRect(0,0,1240,740);
  const captures=[];
  for(let j=0;j<8;j++){
   const t=24+j*1.25+.6;film.render(t);const x=j%4*310,y=Math.floor(j/4)*370;
   c.drawImage(film.canvas,230,565,620,650,x,y,310,325);c.fillStyle='#24314b';c.font='18px sans-serif';c.fillText(`${film.moods[film.orders[2][j]][0]} / ${t.toFixed(2)}s`,x+12,y+350);captures.push(t);
  }
  // Exercise the complete Shiro interval, including blink minima and cut boundaries.
  for(let f=720;f<1020;f++)film.render(f/30);
  return {sheet:canvas.toDataURL('image/png').split(',')[1],captures};
 });
 const name=process.argv.includes('--before')?'shiro-before':'shiro-fixed';fs.writeFileSync(path.join(__dirname,'output',name+'.png'),Buffer.from(result.sheet,'base64'));
 if(errors.length)throw Error(errors.join('\n'));console.log('Shiro check passed: eight expressions and all 300 solo frames.');
 await browser.close();server.close();
})().catch(async e=>{console.error(e);await browser?.close();server.close();process.exitCode=1;});
