const fs=require('fs'),cp=require('child_process');
const parser=require(process.cwd()+'/node_modules/@babel/parser');
const walk=require(process.cwd()+'/node_modules/@babel/traverse').default;
const gen=require(process.cwd()+'/node_modules/@babel/generator').default;
const baseline='2d3adeab9601c9f64fbc2f7bc8a0f14958c1dbcb';
const files=cp.execFileSync('git',['diff','--name-only','--diff-filter=M',baseline],{encoding:'utf8'}).trim().split('\n').filter(f=>/\.(jsx|js)$/.test(f));
const result=[];
function extract(src){const ast=parser.parse(src,{sourceType:'module',plugins:['jsx']});const handlers=[],requests=[],fields=[];walk(ast,{JSXAttribute(p){const n=p.node.name.name;if(/^on[A-Z]/.test(n))handlers.push(gen(p.node,{compact:true}).code);if(['disabled','readOnly','required','value','checked','href','to','action','method','type','name'].includes(n))fields.push(gen(p.node,{compact:true}).code);},CallExpression(p){const callee=gen(p.node.callee,{compact:true}).code;if(/^(base44\.|stripe\.|elements\.|fetch$)|^use(State|Effect|Callback|Memo)$/.test(callee)){if(/^use/.test(callee))return;requests.push(gen(p.node,{compact:true}).code)}}});return{handlers,requests,fields};}
for(const f of files){const before=extract(cp.execFileSync('git',['show',baseline+':'+f],{encoding:'utf8'})),after=extract(fs.readFileSync(f,'utf8'));result.push({file:f,handlersUnchanged:JSON.stringify(before.handlers)===JSON.stringify(after.handlers),requestsUnchanged:JSON.stringify(before.requests)===JSON.stringify(after.requests),fieldsUnchanged:JSON.stringify(before.fields)===JSON.stringify(after.fields),handlers:after.handlers.length,requests:after.requests.length});}
fs.writeFileSync('docs/reviews/rebrand-evidence/behavior-preservation.json',JSON.stringify({baseline,files:result},null,2)+'\n');
console.log(JSON.stringify({files:result.length,handlers:result.reduce((n,x)=>n+x.handlers,0),requests:result.reduce((n,x)=>n+x.requests,0),differences:result.filter(x=>!x.handlersUnchanged||!x.requestsUnchanged||!x.fieldsUnchanged)},null,2));
