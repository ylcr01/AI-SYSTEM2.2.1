import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteJson, withFileLock } from './atomic-file.mjs';
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
export function checkCacheKey(input={}){return crypto.createHash('sha256').update(JSON.stringify(canonical({taskId:input.taskId,acceptanceFingerprint:input.acceptanceFingerprint,planFingerprint:input.planFingerprint,changeFingerprint:input.changeFingerprint,inputCycle:input.inputCycle??0,command:input.command,args:input.args??[],cwd:input.cwd,runtime:input.runtime??{node:process.version,platform:process.platform,arch:process.arch},dependencyFingerprint:input.dependencyFingerprint??null,configFingerprint:input.configFingerprint??null,environmentIdentity:input.environmentIdentity??null}))).digest('hex');}
export function cacheEligible(check){return check?.cacheable===true&&check?.sideEffect==='none';}
export function loadCheckCache(file){if(!fs.existsSync(file))return{schemaVersion:2,entries:{}};try{const value=JSON.parse(fs.readFileSync(file,'utf8'));return value?.schemaVersion===2&&value.entries?value:{schemaVersion:2,entries:{}};}catch{return{schemaVersion:2,entries:{}};}}
function artifactsExist(entry,cwd){return(entry.artifacts??[]).every(item=>fs.existsSync(path.resolve(cwd,item)));}
export function lookupCheckCache(file,key,options={}){const entry=loadCheckCache(file).entries[key]??null;if(!entry)return null;if(!artifactsExist(entry,options.cwd??process.cwd()))return null;return entry;}
export function saveCheckCache(file,key,result){const lock=`${file}.lock`;return withFileLock(lock,()=>{const value=loadCheckCache(file);value.entries[key]={...result,savedAt:new Date().toISOString()};atomicWriteJson(file,value,path.join(path.dirname(file),'.pending'));return value.entries[key];});}
