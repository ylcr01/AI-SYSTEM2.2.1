import fs from 'node:fs';
import path from 'node:path';
import { SYSTEM_ROOT } from './registry.mjs';

const ROLE_SKILL={web:'develop-web',app:'develop-app',server:'develop-server',docs:'write-documentation',ops:'operate-environments'};
const INTENT_SKILLS=[
 ['clarify-requirements',/需求|范围|验收|requirement/iu],['design-product',/产品|规划|product/iu],
 ['design-ui',/界面|交互|视觉|\bui\b|\bux\b/iu],['integrate-systems',/联调|跨仓|第三方|集成|integration/iu],
 ['operate-environments',/环境|发布|部署|容器|网关|deploy|runtime/iu],['write-documentation',/文档|README|架构说明|documentation/iu],
 ['curate-knowledge',/经验|知识|复盘|knowledge/iu]
];

function existing(file){return file&&fs.existsSync(file)&&fs.statSync(file).isFile()?path.resolve(file):null;}
function existingPath(file){return file&&fs.existsSync(file)?path.resolve(file):null;}
function readJson(file,fallback=null){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}}
function selectSkills(role,intent,explicit=[]){if(explicit.length)return[...new Set(explicit)].slice(0,2);const result=[];if(ROLE_SKILL[role])result.push(ROLE_SKILL[role]);for(const[name,re]of INTENT_SKILLS)if(re.test(intent))result.push(name);return[...new Set(result)].slice(0,2);}

function qualityManifest(root,source){
  if(!root)return null;const file=path.join(root,'.ai','quality.json');const value=readJson(file);if(!value)return null;
  return{source,root:path.resolve(root),file:path.resolve(file),contracts:Array.isArray(value.contracts)?value.contracts:[],exemplars:Array.isArray(value.exemplars)?value.exemplars:[],disabledDefaults:new Set(value.disabledDefaults??[]),exceptions:value.exceptions??[]};
}
function matches(item,input){
  if(item.status&&item.status!=='active')return false;
  if(item.skills?.length&&!item.skills.some(x=>input.skills.includes(x)))return false;
  if(item.roles?.length&&!item.roles.includes(input.role))return false;
  if(item.artifactKinds?.length&&!item.artifactKinds.some(x=>input.artifactKinds.includes(x)))return false;
  return true;
}
function resolvePaths(manifest,values=[]){return values.map(rel=>existingPath(path.resolve(manifest.root,rel))).filter(Boolean);}
function contractFromManifest(manifest,input){
  for(const item of manifest?.contracts??[]){if(!matches(item,input))continue;const file=existing(path.resolve(manifest.root,item.path??''));if(file)return{id:item.id,version:item.version??1,path:file,source:manifest.source,manifest:manifest.file};}
  return null;
}
function exemplarCandidates(manifest,input){
  const normalized=input.intent.toLowerCase();return(manifest?.exemplars??[]).filter(item=>matches(item,input)&&!item.supersededBy&&(item.structureImpacts??['structural']).includes('structural'))
   .map(item=>({item,score:(item.keywords??[]).filter(k=>normalized.includes(String(k).toLowerCase())).length}))
   .sort((a,b)=>b.score-a.score).map(x=>x.item);
}
function exemplarFromManifest(manifest,input){
  const item=exemplarCandidates(manifest,input)[0];if(!item)return null;const files=resolvePaths(manifest,item.read??[]);if(!files.length)return null;
  return{...item,files,source:manifest.source,manifest:manifest.file};
}
function centralContract(skill){const file=existing(path.join(SYSTEM_ROOT,'20-能力模块',skill,'CONTRACT.md'));if(!file)return null;const text=fs.readFileSync(file,'utf8');const id=text.match(/^id:\s*([^\r\n]+)/mu)?.[1]?.trim()??skill;const version=Number(text.match(/^version:\s*(\d+)/mu)?.[1]??2);return{id,version,path:file,source:'central'};}
function centralExemplar(skill,intent){
 const root=path.join(SYSTEM_ROOT,'20-能力模块',skill);const index=readJson(path.join(root,'样板','索引.json'));const normalized=intent.toLowerCase();
 const item=(index?.exemplars??[]).filter(x=>x.status==='active'&&!x.supersededBy).map(x=>({x,score:(x.keywords??[]).filter(k=>normalized.includes(String(k).toLowerCase())).length})).sort((a,b)=>b.score-a.score)[0]?.x;
 if(!item)return null;const files=(item.read??[]).map(f=>existing(path.join(root,'样板',f))).filter(Boolean);return files.length?{...item,files,source:'central'}:null;
}
function selectExperience(intent,projectRoot){
 const normalized=intent.toLowerCase();const sources=[];
 if(projectRoot){const index=readJson(path.join(projectRoot,'.ai','30-经验','索引.json'));if(index)sources.push({root:path.join(projectRoot,'.ai','30-经验'),index,source:'project'});}
 const centralRoot=path.join(SYSTEM_ROOT,'30-知识库');sources.push({root:centralRoot,index:readJson(path.join(centralRoot,'索引.json'),{routes:[]}),source:'central'});
 for(const source of sources){const route=(source.index.routes??[]).filter(x=>x.lifecycle==='active').map(x=>({x,score:(x.keywords??[]).filter(k=>normalized.includes(String(k).toLowerCase())).length})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score)[0]?.x;if(route){const file=existing(path.join(source.root,route.read?.[0]??''));if(file)return[{path:file,source:source.source}];}}
 return[];
}

export function loadQualityContext(input={}){
 const skills=selectSkills(input.role,input.intent??'',input.explicitSkills??[]);const methods=skills.map(skill=>({name:skill,path:existing(path.join(SYSTEM_ROOT,'20-能力模块',skill,'SKILL.md')),source:'central'})).filter(x=>x.path);
 if(input.structureImpact!=='structural')return{skills,methods,contracts:[],exemplars:[],experiences:selectExperience(input.intent??'',input.projectRoot),files:methods.map(x=>x.path)};
 const matchInput={skills,role:input.role,artifactKinds:input.artifactKinds??['code'],intent:input.intent??''};
 const project=qualityManifest(input.projectRoot,'project');const template=qualityManifest(input.templateRoot,'template');
 let contract=contractFromManifest(project,matchInput)??contractFromManifest(template,matchInput);
 if(!contract){for(const skill of skills){if(project?.disabledDefaults.has(skill)||template?.disabledDefaults.has(skill))continue;contract=centralContract(skill);if(contract)break;}}
 let exemplar=exemplarFromManifest(project,matchInput)??exemplarFromManifest(template,matchInput);
 if(!exemplar){for(const skill of skills){if(project?.disabledDefaults.has(skill)||template?.disabledDefaults.has(skill))continue;exemplar=centralExemplar(skill,input.intent??'');if(exemplar)break;}}
 const experiences=selectExperience(input.intent??'',input.projectRoot);const files=[...methods.map(x=>x.path),contract?.path,...(exemplar?.files??[]),...experiences.map(x=>x.path)].filter(Boolean);
 return{skills,methods,contracts:contract?[contract]:[],exemplars:exemplar?[exemplar]:[],experiences,files:[...new Set(files)],authority:{project:project?.file??null,template:template?.file??null}};
}
