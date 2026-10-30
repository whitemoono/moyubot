// Keep the independently deployable server on the same provider/cloud adapters as desktop.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
execFileSync(process.execPath,[path.join(root,'apps/desktop/node_modules/typescript/bin/tsc'),'-p',path.join(root,'packages/core/tsconfig.json')],{stdio:'inherit'});
const dest=path.join(root,'apps/web/server/runtime');fs.mkdirSync(dest,{recursive:true});
fs.writeFileSync(path.join(dest,'package.json'),JSON.stringify({private:true,type:'commonjs'}));
for(const name of ['cloud.js','instabox.js','computer-control.js','util.js','generation.js'])fs.copyFileSync(path.join(root,'packages/core/dist',name),path.join(dest,name));
fs.mkdirSync(path.join(dest,'providers'),{recursive:true});
for(const name of fs.readdirSync(path.join(root,'packages/core/dist/providers')).filter(n=>n.endsWith('.js')))fs.copyFileSync(path.join(root,'packages/core/dist/providers',name),path.join(dest,'providers',name));
console.log('Standalone PWA provider and cloud runtime updated.');
