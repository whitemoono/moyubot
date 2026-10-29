const path=require('node:path'),os=require('node:os'),fs=require('node:fs');
const {_electron}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
let instance;
(async()=>{
 // Reuse the profile's encrypted OS key so Electron can decrypt the already saved keys.
 // Never print the key or copy browsing/session data.
 const profile=path.resolve('.work/film-v2/electron');fs.mkdirSync(profile,{recursive:true});
 const originalState=JSON.parse(fs.readFileSync('.work/electron-preview/Local State','utf8'));
 if(originalState.os_crypt)fs.writeFileSync(path.join(profile,'Local State'),JSON.stringify({os_crypt:originalState.os_crypt}));
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 instance=await _electron.launch({executablePath:path.resolve('apps/desktop/node_modules/electron/dist/electron.exe'),args:['--no-sandbox',path.join(__dirname,'electron-recording.cjs')],env,recordVideo:{dir:path.join(__dirname,'output/native-probe'),size:{width:1600,height:900}},timeout:30000});
 const page=await instance.firstWindow();await page.waitForSelector('.workspace-switcher',{timeout:45000});await page.waitForTimeout(1000);
 console.log(JSON.stringify(await page.evaluate(()=>({title:document.title,body:document.body.innerText.slice(0,700)}))));
 console.log(JSON.stringify(await instance.evaluate(async()=>{const b=global.filmBackend;await b.cloud.refresh();return {cloud:b.cloud.status().state,driver:b.store.getSettings().cloud.driver,hasCloudKey:!!b.store.secrets.get('cloud:instabox'),providers:b.store.getSettings().providers.map(p=>({id:p.id,hasKey:!!b.store.secrets.get(b.store.providerSecretKey(p.id))}))};})));
 const out=path.join(__dirname,'output');fs.mkdirSync(out,{recursive:true});await page.getByRole('button',{name:'工作区终端',exact:true}).click();await page.waitForTimeout(4000);await page.screenshot({path:path.join(out,'probe-native.png')});
 console.log('Native video:',!!page.video());await instance.close();
})().catch(async e=>{console.error(e.message);await instance?.close();process.exitCode=1;});
