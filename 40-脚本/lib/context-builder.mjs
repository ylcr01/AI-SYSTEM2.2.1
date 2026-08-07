import fs from 'node:fs';
import path from 'node:path';
import { publicContext, resolveContext, SYSTEM_ROOT } from './registry.mjs';
import { readProjectManifests } from './manifest-reader.mjs';
import { loadQualityContext } from './quality-registry.mjs';
import { classifyTask } from './task-policy.mjs';

function inferRole(context,intent){const registered=context.module?.role??context.template?.role;if(registered)return registered;if(/服务端|后端|API|数据库|server|backend/iu.test(intent))return'server';if(/移动|小程序|App|uni-app/iu.test(intent))return'app';if(/文档|README|documentation/iu.test(intent))return'docs';if(/部署|环境|运维|deploy/iu.test(intent))return'ops';if(/网页|前端|页面|Vue|React|Web/iu.test(intent))return'web';return null;}
function addFact(list,file,authority,reason){if(file&&fs.existsSync(file)&&fs.statSync(file).isFile()&&!list.some(x=>x.path===path.resolve(file)))list.push({path:path.resolve(file),authority,reason});}

export function buildContext(options={}){
 const intent=String(options.intent??'').trim();const acceptance=String(options.acceptance??'').trim();const context=resolveContext(options);
 const executionTarget=path.resolve(context.modulePath??context.projectPath??context.templatePath??context.gitRoot??context.cwd);
 const role=inferRole(context,intent);const classification=options.classification??classifyTask({intent,acceptance,tracked:options.tracked,handoffRequired:options.handoffRequired});
 const facts=[];
 if(context.projectPath){addFact(facts,path.join(context.projectPath,context.project?.entrypoints?.agents??'AGENTS.md'),'project','项目入口');addFact(facts,path.join(context.projectPath,'.ai','contract.md'),'project','项目契约');addFact(facts,path.join(context.projectPath,'.ai','quality.json'),'project','项目质量清单');addFact(facts,path.join(context.projectPath,'.ai','spec-map.json'),'project','规格映射');addFact(facts,path.join(context.projectPath,'.ai','spec-policy.json'),'project','规格一致性策略');}
 if(context.modulePath){addFact(facts,path.join(context.modulePath,'AGENTS.md'),'project','模块入口');addFact(facts,path.join(context.modulePath,'.ai','contract.md'),'project','模块契约');addFact(facts,path.join(context.modulePath,'.ai','spec-map.json'),'project','模块规格映射');}
 if(context.templatePath){addFact(facts,path.join(context.templatePath,context.template?.entrypoints?.agents??'AGENTS.md'),'template','底座入口');addFact(facts,path.join(context.templatePath,context.template?.quality?.manifest??'.ai/quality.json'),'template','底座质量清单');}
 if(context.kind==='transient'&&context.gitRoot){addFact(facts,path.join(context.gitRoot,'AGENTS.md'),'project','临时项目入口');addFact(facts,path.join(context.gitRoot,'.ai','contract.md'),'project','临时项目契约');addFact(facts,path.join(context.gitRoot,'.ai','quality.json'),'project','临时项目质量清单');addFact(facts,path.join(context.gitRoot,'.ai','spec-map.json'),'project','临时项目规格映射');addFact(facts,path.join(context.gitRoot,'.ai','spec-policy.json'),'project','临时项目规格策略');}
 if(context.gitRoot&&path.resolve(context.gitRoot)===path.resolve(SYSTEM_ROOT))addFact(facts,path.join(SYSTEM_ROOT,'AGENTS.md'),'system','系统入口');
 const manifests=readProjectManifests(context);for(const item of manifests)addFact(facts,item.path,'reality',`项目 Manifest: ${item.kind}`);
 const quality=loadQualityContext({role,intent,structureImpact:classification.structureImpact,artifactKinds:classification.artifactKinds,explicitSkills:options.skills??[],projectRoot:context.modulePath??context.projectPath??context.gitRoot,templateRoot:context.templatePath});
 return{schemaVersion:3,context:publicContext(context),executionTarget:{targetPath:executionTarget},role,classification,
  facts,manifests,quality,filesToRead:[...new Set([...facts.map(x=>x.path),...quality.files])],
  next:['先读取项目事实、Manifest、目标代码和直接调用方',classification.structureImpact==='structural'?'读取一个主要 Contract 和最多一个 Active Canonical':'保持局部，不默认加载 Contract/Canonical','项目事实冲突时不机械套用中央默认','模型自行选择验证方式和是否使用额外 Agent']};
}
