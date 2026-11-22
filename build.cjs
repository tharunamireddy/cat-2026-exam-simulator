const fs=require('fs');
const {marked}=require('/Users/tharunreddy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/marked');
const data=JSON.parse(fs.readFileSync('work/data.json','utf8'));
for(const q of data.questions){q.solution=marked.parse(q.solutionMarkdown);delete q.solutionMarkdown;}
const source=fs.readFileSync('work/template.html','utf8').replace('__DATA__',JSON.stringify(data).replace(/</g,'\\u003c')).replace('__ENGINE__',()=>fs.readFileSync('work/engine.js','utf8')).replace('__APP__',()=>fs.readFileSync('work/app.js','utf8'));
fs.writeFileSync('outputs/index.html',source);
console.log('Built outputs/index.html:',Buffer.byteLength(source),'bytes');
