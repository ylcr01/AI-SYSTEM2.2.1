import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runGit, pathContains, normalizePath } from './registry.mjs';

function hashFile(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function gitRaw(root, args) { const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024 }); return result.status === 0 && !result.error ? result.stdout : null; }
function statusEntries(gitRoot) {
  const raw = gitRaw(gitRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (raw === null) return [];
  const fields = raw.split('\0'); const entries = [];
  for (let index = 0; index < fields.length; index += 1) {
    const row = fields[index]; if (!row || row.length < 4) continue;
    const status = row.slice(0, 2); const target = row.slice(3).replaceAll('\\', '/');
    entries.push({ path: target, status, hash: hashFile(path.join(gitRoot, target)) });
    if (/[RC]/u.test(status)) { const original = fields[index + 1]; if (original) entries.push({ path: original.replaceAll('\\','/'), status:'D ', hash:null }); index += 1; }
  }
  return entries.sort((a,b) => a.path.localeCompare(b.path));
}

function fingerprint(entries, extra = {}) {
  const normalized = [...entries].map((item) => ({ path:item.path, status:item.status ?? null, hash:item.hash ?? null })).sort((a,b) => a.path.localeCompare(b.path));
  return crypto.createHash('sha256').update(JSON.stringify({ files: normalized, extra })).digest('hex');
}

function nearestExisting(value) {
  let current = path.resolve(value);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
  return current;
}

export function normalizeScope(executionTarget, scopeValue, gitRoot) {
  const root = normalizePath(gitRoot); const target = normalizePath(executionTarget);
  if (!pathContains(root, target)) throw new Error('执行目标不在 Git Root 内');
  const candidate = path.isAbsolute(String(scopeValue ?? '.'))
    ? path.resolve(String(scopeValue ?? '.'))
    : path.resolve(target, String(scopeValue ?? '.'));
  const lexicalRelative = path.relative(path.resolve(root), path.resolve(candidate));
  if (path.isAbsolute(lexicalRelative) || lexicalRelative === '..' || lexicalRelative.startsWith(`..${path.sep}`)) throw new Error('授权 Scope 必须位于当前 Git Root 内');
  const realParent = normalizePath(nearestExisting(candidate));
  if (!pathContains(root, realParent)) throw new Error('授权 Scope 通过符号链接越出 Git Root');
  if (fs.existsSync(candidate) && !pathContains(root, normalizePath(candidate))) throw new Error('授权 Scope 通过符号链接越出 Git Root');
  return { base:'git-root', path:path.relative(root, candidate).replaceAll('\\','/') || '.', absolute:path.resolve(candidate) };
}

export function scopeAbsolute(scope, gitRoot) {
  if (!scope || scope.base !== 'git-root' || typeof scope.path !== 'string') throw new Error('授权 Scope 结构无效');
  const absolute = path.resolve(gitRoot, scope.path === '.' ? '' : scope.path);
  if (!pathContains(gitRoot, absolute)) throw new Error('授权 Scope 不在 Git Root 内');
  return absolute;
}

export function captureBaseline(gitRoot) {
  if (!gitRoot) throw new Error('缺少 Git Root');
  const root = path.resolve(gitRoot); const files = statusEntries(root);
  return { schemaVersion:3, gitRoot:root, head:runGit(root,['rev-parse','HEAD']), files,
    fingerprint:fingerprint(files), capturedAt:new Date().toISOString() };
}

function committedChanges(root, before, after) {
  if (!before || !after || before === after) return [];
  const raw = runGit(root, ['diff','--name-status','-z','--find-renames',before,after,'--']) ?? '';
  const fields = raw.split('\0'); const changes=[];
  for (let i=0;i<fields.length;) {
    const status=fields[i++]; if(!status) continue;
    if (/^[RC]/u.test(status)) {
      const from=fields[i++]; const to=fields[i++];
      if(from) changes.push({path:from.replaceAll('\\','/'),status:'D ',hash:null});
      if(to) changes.push({path:to.replaceAll('\\','/'),status:'A ',hash:hashFile(path.join(root,to))});
    } else { const file=fields[i++]; if(file) changes.push({path:file.replaceAll('\\','/'),status,hash:status==='D'?null:hashFile(path.join(root,file))}); }
  }
  return changes;
}

export function computeChangeSet(baseline) {
  if (!baseline?.gitRoot) throw new Error('缺少 Git Baseline');
  const root=baseline.gitRoot; const before=new Map((baseline.files??[]).map(x=>[x.path,x]));
  const currentEntries=statusEntries(root); const current=new Map(currentEntries.map(x=>[x.path,x]));
  const paths=new Set([...before.keys(),...current.keys()]); const changes=[];
  for(const filePath of paths){const left=before.get(filePath)??null; const right=current.get(filePath)??null;
    if(JSON.stringify(left)!==JSON.stringify(right)) changes.push(right??{path:filePath,status:'D ',hash:null});}
  const currentHead=runGit(root,['rev-parse','HEAD']);
  for(const item of committedChanges(root,baseline.head,currentHead)){const idx=changes.findIndex(x=>x.path===item.path); if(idx>=0)changes[idx]=item;else changes.push(item);}
  changes.sort((a,b)=>a.path.localeCompare(b.path));
  return {schemaVersion:3,gitRoot:root,baselineHead:baseline.head,currentHead,files:changes,
    fingerprint:fingerprint(changes,{head:currentHead}),computedAt:new Date().toISOString()};
}

export function validateChangeSetScope(changeSet, scope) {
  const base=scopeAbsolute(scope,changeSet.gitRoot);
  const violations=(changeSet.files??[]).filter(item=>!pathContains(base,path.resolve(changeSet.gitRoot,item.path)));
  return {ok:violations.length===0,scope:base,violations};
}
export function assertChangeSetWithinScope(changeSet,scope){const result=validateChangeSetScope(changeSet,scope);if(!result.ok)throw new Error(`ChangeSet 越出授权范围: ${result.violations.map(x=>x.path).join(', ')}`);return result;}

export function userChangesRemainIsolated(baseline, changeSet, allowedExisting = []) {
  const allow=new Set(allowedExisting.map(String)); const original=new Map((baseline?.files??[]).map(x=>[x.path,x]));
  const overwritten=(changeSet?.files??[]).filter(item=>original.has(item.path)&&!allow.has(item.path)).map(item=>item.path);
  return {ok:overwritten.length===0,overwritten};
}
