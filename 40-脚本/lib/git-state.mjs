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
function gitResult(root, args) { return spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024 }); }
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
  if (Array.isArray(scopeValue)) throw new Error('授权 Scope 只能指定一个路径；多个文件或目录请改用共同父目录');
  const rawScope = String(scopeValue ?? '.').trim();
  if (/[,，]/u.test(rawScope)) throw new Error('授权 Scope 不接受逗号拼接；多个文件或目录请改用共同父目录');
  if (/[*?\[\]{}]/u.test(rawScope)) throw new Error('授权 Scope 不支持 glob；请改用明确的共同父目录');
  const root = normalizePath(gitRoot); const target = normalizePath(executionTarget);
  if (!pathContains(root, target)) throw new Error('执行目标不在 Git Root 内');
  const candidate = path.isAbsolute(rawScope)
    ? path.resolve(rawScope)
    : path.resolve(target, rawScope);
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
  const gitDir = runGit(root, ['rev-parse', '--path-format=absolute', '--git-dir']);
  const gitCommonDir = runGit(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const branch = runGit(root, ['branch', '--show-current']) || null;
  return { schemaVersion:4, gitRoot:root, head:runGit(root,['rev-parse','HEAD']), files,
    branch, gitDir:gitDir ? path.resolve(gitDir) : null, gitCommonDir:gitCommonDir ? path.resolve(gitCommonDir) : null,
    linkedWorktree:Boolean(gitDir && gitCommonDir && normalizePath(gitDir) !== normalizePath(gitCommonDir)),
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
  const uncommittedTaskChanges = JSON.stringify(currentEntries) !== JSON.stringify(baseline.files ?? []);
  return {schemaVersion:4,gitRoot:root,baselineHead:baseline.head,currentHead,files:changes,uncommittedTaskChanges,
    fingerprint:fingerprint(changes,{head:currentHead}),computedAt:new Date().toISOString()};
}

export function normalizeIntegrationTarget(value) {
  const raw = String(value ?? '').trim().replace(/^refs\/heads\//u, '');
  if (!raw || raw.startsWith('-') || raw.includes('..') || raw.includes('@{') || raw.endsWith('.lock') || !/^[A-Za-z0-9._/-]+$/u.test(raw)) {
    throw new Error('集成目标必须是有效的本地分支名');
  }
  return raw;
}

export function integrationRequiredForBaseline(baseline, explicitTarget = null) {
  return Boolean(explicitTarget || baseline?.linkedWorktree || !baseline?.branch);
}

export function assertIntegrationTargetExists(gitRoot, target) {
  const normalized = normalizeIntegrationTarget(target);
  if (!runGit(gitRoot, ['rev-parse', '--verify', `refs/heads/${normalized}^{commit}`])) {
    throw new Error(`集成目标分支不存在: ${normalized}`);
  }
  return normalized;
}

export function createPendingIntegrationRef(gitRoot, taskId, commit) {
  if (!/^task-[A-Za-z0-9._-]+$/u.test(taskId ?? '')) throw new Error('任务编号无效');
  if (!/^[0-9a-f]{40,64}$/iu.test(commit ?? '')) throw new Error('结果提交无效');
  const ref = `refs/ai/pending/${taskId}`;
  const result = gitResult(gitRoot, ['update-ref', ref, commit]);
  if (result.status !== 0 || result.error) throw new Error(`无法保存待集成提交: ${(result.stderr || result.error?.message || '').trim()}`);
  return ref;
}

export function verifyIntegrationCandidate(task, changeSet) {
  if (!task.integration?.required) return { ok:true, reasons:[] };
  const reasons = [];
  if (!changeSet.currentHead || changeSet.currentHead === changeSet.baselineHead) reasons.push('missing-result-commit');
  if (changeSet.uncommittedTaskChanges) reasons.push('uncommitted-task-changes');
  if (changeSet.currentHead && changeSet.baselineHead) {
    const ancestry = gitResult(changeSet.gitRoot, ['merge-base', '--is-ancestor', changeSet.baselineHead, changeSet.currentHead]);
    if (ancestry.status !== 0) reasons.push('result-not-descendant-of-baseline');
  }
  return { ok:reasons.length === 0, reasons, resultCommit:changeSet.currentHead ?? null };
}

function commonGitDir(gitRoot) {
  const value = runGit(gitRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return value ? normalizePath(value) : null;
}

export function verifyCommitIntegrated(input = {}) {
  const gitRoot = path.resolve(input.gitRoot);
  const expectedCommonDir = input.expectedCommonDir ? normalizePath(input.expectedCommonDir) : null;
  const actualCommonDir = commonGitDir(gitRoot);
  if (!actualCommonDir || (expectedCommonDir && actualCommonDir !== expectedCommonDir)) {
    return { ok:false, reason:'repository-mismatch', targetCommit:null };
  }
  const target = normalizeIntegrationTarget(input.target);
  const targetRef = `refs/heads/${target}`;
  const targetCommit = runGit(gitRoot, ['rev-parse', '--verify', `${targetRef}^{commit}`]);
  if (!targetCommit) return { ok:false, reason:'target-not-found', target, targetRef, targetCommit:null };
  const result = gitResult(gitRoot, ['merge-base', '--is-ancestor', input.resultCommit, targetCommit]);
  if (result.status === 0) return { ok:true, reason:null, method:'ancestor', target, targetRef, targetCommit };
  if (input.baseCommit) {
    const cherry = gitResult(gitRoot, ['cherry', targetRef, input.resultCommit, input.baseCommit]);
    const lines = String(cherry.stdout ?? '').split(/\r?\n/u).filter(Boolean);
    if (cherry.status === 0 && lines.length > 0 && lines.every((line) => line.startsWith('- '))) {
      return { ok:true, reason:null, method:'patch-equivalent', target, targetRef, targetCommit };
    }
  }
  return { ok:false, reason:'result-not-reachable', method:null, target, targetRef, targetCommit };
}

export function deletePendingIntegrationRef(gitRoot, ref, expectedCommit) {
  if (!/^refs\/ai\/pending\/task-[A-Za-z0-9._-]+$/u.test(ref ?? '')) throw new Error('待集成引用无效');
  const current = runGit(gitRoot, ['rev-parse', '--verify', ref]);
  if (!current) return false;
  if (current !== expectedCommit) throw new Error('待集成引用已指向其他提交，拒绝删除');
  const result = gitResult(gitRoot, ['update-ref', '-d', ref, expectedCommit]);
  if (result.status !== 0 || result.error) throw new Error(`无法清理待集成引用: ${(result.stderr || result.error?.message || '').trim()}`);
  return true;
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
