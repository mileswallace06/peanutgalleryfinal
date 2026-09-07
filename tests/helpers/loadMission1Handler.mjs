import vm from 'node:vm';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

// Actual entry + runtime + projector + SQL, with replacements ONLY at the
// Base44/Stripe/secret/SQL transport edges. No fake receipt or authority DI.
export async function loadMission1Handler(name,deps,options={}) {
  let handler;
  const connections=new Map(),queries=[];
  const roles=['authority_executor','authority_stripe_recorder','authority_worker'];
  const configuration={
    MISSION1_ROLLOUT_EVIDENCE:JSON.stringify({schema_revision:'mission1_projection_v1',authority_host:'synthetic.neon.tech',authority_database:'fixture',
      base44_persistence_verified:true,exclusive_writers_verified:true,legacy_workers_fenced:true}),
    AUTHORITY_V1_DB_URL_DEV_EXECUTOR:'postgresql://authority_executor:synthetic@synthetic.neon.tech/fixture',
    AUTHORITY_V1_DB_URL_DEV_STRIPE_RECORDER:'postgresql://authority_stripe_recorder:synthetic@synthetic.neon.tech/fixture',
    AUTHORITY_V1_DB_URL_DEV_WORKER:'postgresql://authority_worker:synthetic@synthetic.neon.tech/fixture',
    MISSION1_WORKER_TOKEN:'synthetic_worker_token_1234567890123456',
    ...options.secrets,
  };
  const sqlFactory=url=>{
    const parsed=new URL(url),role=parsed.username;
    if(parsed.hostname!=='synthetic.neon.tech' || !roles.includes(role)) throw new Error('ONLY_SYNTHETIC_SQL_TRANSPORT_ALLOWED');
    return async(query,args)=>{
      if(!connections.has(role)) connections.set(role,(async()=>{
        await deps._mission1.sql('SELECT 1');
        const client=await deps._mission1.independentConnection();await client.query(`SET ROLE ${role}`);return client;
      })());
      queries.push({role,query});
      await options.beforeQuery?.(query,args,role);
      const rows=(await (await connections.get(role)).query(query,args)).rows;
      await options.afterQuery?.(query,args,role,rows);
      return rows;
    };
  };
  const base44={asServiceRole:{entities:deps.entities},auth:{me:async()=>options.anonymous?null:deps.user}};
  const edge={
    'npm:@base44/sdk@0.8.25':{createClientFromRequest:()=>base44},
    'npm:@base44/sdk@0.8.31':{createClientFromRequest:()=>base44},
    'npm:stripe@14.21.0':{default:class{constructor(){return deps.stripe;}}},
    'npm:@neondatabase/serverless@0.10.4':{neon:sqlFactory},
    'base44:runtime':{secrets:{get:key=>configuration[key]}},
  };
  const context=vm.createContext({Response,Request,Date,crypto,URL,TextEncoder,TextDecoder,console:{log(){},warn(){},error(){}},
    Deno:{serve:fn=>{handler=fn;},env:{get:key=>key==='MAINTENANCE_MODE'?'false':key==='STRIPELIVESECRETKEY'?'sk_test_synthetic_only':undefined}},
    setTimeout,clearTimeout});
  const modules=new Map();
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
  const notificationPath=resolve(root,'base44/shared/notifications.ts');
  const getModule=async id=>{
    if(modules.has(id))return modules.get(id);
    let module;
    const exports=id===notificationPath?{sendUserNotification:async()=>{},sendTransactionalEmail:async()=>{}}:edge[id];
    if(exports) module=new vm.SyntheticModule(Object.keys(exports),function(){for(const [key,value]of Object.entries(exports))this.setExport(key,value);},{context,identifier:id});
    else {
      if(!id.startsWith(root+'/base44/'))throw new Error('UNMOCKED_EXTERNAL_IMPORT:'+id);
      const source=await readFile(id,'utf8');
      module=new vm.SourceTextModule(id.endsWith('.ts')?ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText:source,{context,identifier:id});
    }
    modules.set(id,module);return module;
  };
  const entry=await getModule(resolve(root,`base44/functions/${name}/entry.ts`));
  await entry.link((specifier,referencing)=>getModule(edge[specifier]?specifier:resolve(dirname(referencing.identifier),specifier)));
  await entry.evaluate();
  return {queries,async request(body={},headers={}){return handler(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify(body),headers}));}};
}
