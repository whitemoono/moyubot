const path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{once}=require('node:events');
const {chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const server=require('../moyubot-film/serve.cjs');let browser;
(async()=>{
 server.listen(0,'localhost');await once(server,'listening');browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']});
 const page=await browser.newPage({viewport:{width:1366,height:900}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(`http://localhost:${server.address().port}/media/moyubot-film-v2/`);await page.waitForFunction(()=>window.FILM_READY);
 assert.equal(await page.locator('#clock').textContent(),'00:00 / 01:30');
 await page.locator('#play').click();await page.waitForTimeout(1200);assert.equal(await page.locator('#play').textContent(),'暂停');assert((await page.locator('#clock').textContent()).startsWith('00:01'));
 await page.locator('#play').click();const paused=await page.locator('#seek').inputValue();await page.waitForTimeout(150);assert.equal(await page.locator('#seek').inputValue(),paused);
 await page.locator('body').click({position:{x:8,y:8}});await page.keyboard.press('ArrowRight');assert(+await page.locator('#seek').inputValue()>5);
 await page.locator('#seek').evaluate(el=>{el.value=89;el.dispatchEvent(new Event('input'));});await page.keyboard.press('Space');await page.waitForTimeout(1150);assert.equal(await page.locator('#play').textContent(),'重播');
 await page.locator('#mute').click();assert(await page.locator('#audio').evaluate(el=>el.muted));
 const meta=await page.locator('#audio').evaluate(el=>({duration:el.duration,error:el.error?.code}));assert.equal(meta.duration,90);assert(!meta.error);
 const size=await page.evaluate(()=>({doc:document.documentElement.scrollWidth,view:innerWidth}));assert(size.doc<=size.view);
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(100);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.equal(errors.length,0);console.log('Player QA passed: audio, play/pause, seek, keyboard, end, mute, desktop/mobile overflow.');
 await browser.close();server.close();
})().catch(async e=>{console.error(e);await browser?.close();server.close();process.exitCode=1;});
