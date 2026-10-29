const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { DiagnosticJournal, redactDiagnostic } = require('../packages/core/dist');
const temporary = (t) => { const dir=fs.mkdtempSync(path.join(os.tmpdir(),'moyu-diagnostics-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir; };

test('diagnostics redact saved secrets, encoded values, credentials, links and user identity before disk storage', (t) => {
 const dir=temporary(t), secret='saved-key-123456+!';
 const journal=new DiagnosticJournal(dir,()=>[secret]);
 journal.record({source:'local',message:'failed '+secret,command:`curl https://example.com/run?token=abc#private -H 'Authorization: Bearer secret123' --password="my secret" API_KEY=abc123 ${encodeURIComponent(secret)}`,detail:'C:\\Users\\alice\\project\\file.txt /home/bob/task user@example.com github_pat_abcdef1234567890'});
 const text=fs.readFileSync(path.join(dir,'diagnostics.json'),'utf8');
 for(const value of [secret,encodeURIComponent(secret),'my secret','secret123','abc123','?token=abc','#private','alice','/home/bob','user@example.com','github_pat_abcdef1234567890'])assert.ok(!text.includes(value),value);
 assert.ok(text.includes('curl'));assert.ok(text.includes('https://example.com/run'));
 const reloaded=new DiagnosticJournal(dir,()=>[secret]);assert.equal(reloaded.list().length,1);assert.equal(reloaded.list()[0].source,'local');
 assert.ok(!redactDiagnostic('https://user:pass@example.com/a?q=secret#bearer').includes('user:pass'));
});

test('journal is bounded, expires old entries, tolerates corruption and clears persisted data', (t) => {
 const dir=temporary(t), journal=new DiagnosticJournal(dir);
 for(let i=0;i<70;i++)journal.record({source:'test',message:'failure '+i,detail:'x'.repeat(5000)});
 assert.equal(journal.list().length,60);assert.equal(journal.list()[0].message,'failure 69');assert.equal(journal.list()[0].detail.length,2500);
 const file=path.join(dir,'diagnostics.json'), entries=JSON.parse(fs.readFileSync(file));
 entries.push({id:'expired',createdAt:Date.now()-8*86400000,source:'test',message:'expired'});fs.writeFileSync(file,JSON.stringify(entries));
 const next=new DiagnosticJournal(dir);assert.equal(next.list().some(e=>e.id==='expired'),false);
 next.clear();assert.equal(new DiagnosticJournal(dir).list().length,0);
 fs.writeFileSync(file,'broken');assert.equal(new DiagnosticJournal(dir).list().length,0);
});

test('newly saved credentials are scrubbed when viewing existing diagnostics', (t) => {
 let secrets=[];const journal=new DiagnosticJournal(temporary(t),()=>secrets);
 journal.record({source:'app',message:'service returned future-secret-value'});
 secrets=['future-secret-value'];assert.ok(!journal.list()[0].message.includes('future-secret-value'));
});
