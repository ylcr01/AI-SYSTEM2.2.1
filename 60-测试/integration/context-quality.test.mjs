// BR-AIRD-QUALITY-001 BR-AIRD-QUALITY-002 BR-AIRD-QUALITY-003 BR-AIRD-QUALITY-004
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import { spawnSync } from 'node:child_process';import test from 'node:test';import { buildContext } from '../../40-脚本/lib/context-builder.mjs';import { loadQualityContext,implementationQualityBaseline } from '../../40-脚本/lib/quality-registry.mjs';import { gitRepo,tempDir } from '../helpers.mjs';
test('局部任务不加载 Contract 或 Canonical',t=>{const repo=gitRepo(t);const result=buildContext({cwd:repo,intent:'修复 Web 页面局部 Bug',acceptance:'行为正确'});assert.equal(result.classification.structureImpact,'local');assert.equal(result.quality.contracts.length,0);assert.equal(result.quality.exemplars.length,0);});
test('普通结构语义不加载结构标签或正式闭环',t=>{const repo=gitRepo(t);const local=buildContext({cwd:repo,intent:'修复 Web 页面局部 Bug',acceptance:'行为正确'});assert.equal(local.classification.continuity,'ephemeral');assert.match(local.next.join('\n'),/轻量直达/u);const ordinary=buildContext({cwd:repo,intent:'新增模块并调整架构职责',acceptance:'模块职责清楚'});assert.equal(ordinary.classification.structureImpact,'local');assert.equal(ordinary.classification.continuity,'ephemeral');assert.equal(ordinary.executionRoute,'local-direct-candidate');assert.equal(ordinary.quality.contracts.length,0);});
test('局部 Code Task 获得轻量质量基线',t=>{const repo=gitRepo(t);const result=buildContext({cwd:repo,intent:'修复 Web 页面局部 Bug',acceptance:'行为正确'});assert.equal(result.quality.baseline?.id,'implementation-quality-baseline');assert.ok(result.quality.baseline.rules.some(rule=>rule.id==='goal-fit'));const rules=result.quality.baseline.rules.map(rule=>rule.text).join('\n');assert.match(rules,/稳定功能查漏补缺/u);assert.match(rules,/平行业务规则/u);assert.match(rules,/核心运行代码明显净增/u);const contract=fs.readFileSync(new URL('../../20-能力模块/10-通用工程契约.md',import.meta.url),'utf8');assert.match(contract,/新增逻辑替换或删除了什么旧路径/u);assert.match(contract,/缺少基础模型/u);});
test('显式正式结构任务最多加载一个主要 Contract 和 Canonical',t=>{const repo=gitRepo(t);const result=buildContext({cwd:repo,intent:'新增 Web 模块并调整架构职责',acceptance:'模块职责清楚',tracked:true});assert.equal(result.classification.structureImpact,'structural');assert.equal(result.quality.contracts.length,1);assert.ok(result.quality.exemplars.length<=1);assert.equal(result.quality.baseline?.id,'implementation-quality-baseline');});
test('纯文档任务不返回 implementation quality baseline',t=>{const repo=gitRepo(t);const result=buildContext({cwd:repo,intent:'更新 README 使用说明'});assert.equal(result.quality.baseline,null);});
test('质量基线保持紧凑防膨胀',()=>{const baseline=implementationQualityBaseline(['code']);assert.ok(baseline);assert.ok(JSON.stringify(baseline).length<2500);});
test('Source-driven 规格、边界与既有轻量行为保持一致',()=>{const baseline=implementationQualityBaseline(['code']);const rules=baseline.conditionalRules.filter(rule=>rule.id==='version-source-authority');assert.equal(rules.length,1);const rule=rules[0];assert.equal(rule.when,'version-sensitive-framework-sdk-driver-cli-or-migration-decision');assert.deepEqual(Object.keys(rule).sort(),['id','text','when']);assert.match(rule.text,/Manifest 或锁文件/u);assert.match(rule.text,/官方文档或官方 changelog/u);assert.match(rule.text,/UNVERIFIED/u);assert.match(rule.text,/纯逻辑、重命名和版本无关修改不适用/u);assert.match(rule.text,/不可信 transient data/u);assert.match(rule.text,/不自动加载整站或常驻资料/u);assert.equal(implementationQualityBaseline(['documentation']),null);assert.ok(JSON.stringify(baseline).length<2500);const spec=fs.readFileSync(new URL('../../70-文档/specifications/quality-profile-and-state.md',import.meta.url),'utf8');assert.match(spec,/BR-AIRD-QUALITY-004[^\n]+版本敏感决策/u);const specMap=JSON.parse(fs.readFileSync(new URL('../../.ai/spec-map.json',import.meta.url),'utf8'));assert.ok(specMap.mappings.some(mapping=>mapping.specificationIds?.includes('BR-AIRD-QUALITY-004')&&mapping.testFiles?.includes('60-测试/integration/context-quality.test.mjs')));});
test('显式正式且无专业能力命中的结构性任务回退通用工程契约',t=>{const repo=gitRepo(t);const result=buildContext({cwd:repo,intent:'分析当前架构和未来方向',tracked:true});assert.equal(result.classification.structureImpact,'structural');assert.equal(result.quality.contracts[0]?.id,'universal-engineering');assert.ok(result.filesToRead.some(file=>file.endsWith('10-通用工程契约.md')));});
test('项目质量清单优先于底座和中央',t=>{const project=tempDir(t,'project-quality-'),template=tempDir(t,'template-quality-');for(const root of [project,template])fs.mkdirSync(path.join(root,'.ai'),{recursive:true});fs.mkdirSync(path.join(project,'docs'),{recursive:true});fs.writeFileSync(path.join(project,'docs','contract.md'),'# project contract');fs.writeFileSync(path.join(project,'docs','canonical.md'),'# project canonical');fs.writeFileSync(path.join(project,'.ai','quality.json'),JSON.stringify({contracts:[{id:'project-web',status:'active',profiles:['develop-web'],roles:['web'],artifactKinds:['code'],path:'docs/contract.md'}],exemplars:[{id:'project-example',status:'active',profiles:['develop-web'],artifactKinds:['code'],structureImpacts:['structural'],keywords:['模块'],read:['docs/canonical.md']}]}));fs.mkdirSync(path.join(template,'docs'),{recursive:true});fs.writeFileSync(path.join(template,'docs','contract.md'),'# template contract');fs.writeFileSync(path.join(template,'.ai','quality.json'),JSON.stringify({contracts:[{id:'template-web',status:'active',profiles:['develop-web'],roles:['web'],artifactKinds:['code'],path:'docs/contract.md'}]}));const q=loadQualityContext({role:'web',intent:'新增模块',structureImpact:'structural',artifactKinds:['code'],projectRoot:project,templateRoot:template});assert.equal(q.contracts[0].source,'project');assert.equal(q.contracts[0].id,'project-web');assert.equal(q.exemplars[0].source,'project');});
test('旧质量清单 skills 字段只作为 profiles 兼容输入',t=>{const project=tempDir(t,'legacy-quality-');fs.mkdirSync(path.join(project,'.ai'),{recursive:true});fs.mkdirSync(path.join(project,'docs'),{recursive:true});fs.writeFileSync(path.join(project,'docs','contract.md'),'# legacy contract');fs.writeFileSync(path.join(project,'.ai','quality.json'),JSON.stringify({contracts:[{id:'legacy-web',status:'active',skills:['develop-web'],path:'docs/contract.md'}]}));const q=loadQualityContext({role:'web',intent:'新增模块',structureImpact:'structural',artifactKinds:['code'],projectRoot:project});assert.equal(q.contracts[0].id,'legacy-web');assert.ok(q.profiles.includes('develop-web'));assert.equal('skills' in q,false);});
test('显式 Quality Profile 为局部任务加载 Contract 但不加载 Canonical',t=>{const repo=gitRepo(t);const result=buildContext({cwd:repo,intent:'分析当前实现',qualityProfiles:['develop-web']});assert.equal(result.classification.structureImpact,'local');assert.deepEqual(result.quality.profiles,['develop-web']);assert.equal(result.quality.selectionSource,'explicit');assert.equal(result.quality.contracts[0]?.id,'web-feature');assert.equal(result.quality.exemplars.length,0);assert.ok(result.filesToRead.some(file=>file.endsWith(path.join('develop-web','CONTRACT.md'))));assert.ok(!result.filesToRead.some(file=>file.endsWith('SKILL.md')));});
test('Transient 项目读取 README、Manifest 与项目质量清单',t=>{const repo=gitRepo(t);fs.writeFileSync(path.join(repo,'package.json'),JSON.stringify({name:'app',scripts:{test:'node --test'},dependencies:{vue:'3'}}));fs.writeFileSync(path.join(repo,'.ai','quality.json'),JSON.stringify({contracts:[]}));const result=buildContext({cwd:repo,intent:'新增 Web 模块',acceptance:'行为正确'});assert.ok(result.filesToRead.some(file=>file.endsWith('README.md')));assert.ok(result.manifests.some(x=>x.kind==='node'));assert.ok(result.facts.some(x=>x.path.endsWith(path.join('.ai','quality.json'))));});
test('项目根唯一模块显式绑定模板并只加载命中资料',t=>{const project=gitRepo(t),template=gitRepo(t),modulePath=path.join(project,'web');fs.mkdirSync(modulePath,{recursive:true});fs.writeFileSync(path.join(modulePath,'AGENTS.md'),'# web');for(const [root,remote] of [[project,'https://example.com/org/project.git'],[template,'https://example.com/org/template.git']]){const result=spawnSync('git',['-C',root,'remote','add','origin',remote],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);}fs.writeFileSync(path.join(template,'AGENTS.md'),'# template');fs.writeFileSync(path.join(template,'package.json'),JSON.stringify({name:'template'}));fs.mkdirSync(path.join(template,'.ai'),{recursive:true});fs.mkdirSync(path.join(template,'docs'),{recursive:true});fs.writeFileSync(path.join(template,'docs','table.md'),'# table');fs.writeFileSync(path.join(template,'docs','dialog.md'),'# dialog');fs.writeFileSync(path.join(template,'.ai','manifest.json'),JSON.stringify({routes:[{keywords:['表格'],read:['docs/table.md']},{keywords:['弹窗'],read:['docs/dialog.md']}]}));const registry={templates:{schemaVersion:1,templates:[{id:'web-template',role:'web',enabled:true,repository:{canonicalRemote:'example.com/org/template',allowedRemotes:[]},localPathKey:'template.web',entrypoints:{agents:'AGENTS.md',manifest:'package.json'},knowledge:{mode:'in-repo',root:'.ai',manifest:'.ai/manifest.json'},quality:{manifest:'.ai/quality.json'}}]},projects:{schemaVersion:1,projects:[{id:'project',enabled:true,localPathKey:'project',entrypoints:{agents:'AGENTS.md'},modules:[{id:'project-web',role:'web',localPathKey:'project.web',canonicalRemote:'example.com/org/project',subpath:'web',templateId:'web-template'}]}]},localPaths:{project, 'project.web':modulePath,'template.web':template}};const result=buildContext({cwd:project,intent:'修复网页表格',acceptance:'行为正确',registry});assert.equal(result.context.module.id,'project-web');assert.equal(result.context.template.id,'web-template');assert.ok(result.filesToRead.some(file=>file.endsWith(path.join('docs','table.md'))),JSON.stringify(result.filesToRead));assert.ok(!result.filesToRead.some(file=>file.endsWith(path.join('docs','dialog.md'))));});

function addRemote(repository, remote) {
 const result = spawnSync('git', ['-C', repository, 'remote', 'add', 'origin', remote], { encoding: 'utf8' });
 assert.equal(result.status, 0, result.stderr);
}

test('项目说明入口不能越出项目目录', (t) => {
 const project = gitRepo(t); const modulePath = path.join(project, 'web');
 fs.mkdirSync(modulePath, { recursive: true }); addRemote(project, 'https://example.com/org/project.git');
 const registry = {
  templates: { schemaVersion: 1, templates: [] },
  projects: { schemaVersion: 1, projects: [{ id: 'project', enabled: true, localPathKey: 'project', entrypoints: { agents: 'AGENTS.md', docs: '../outside.md' }, modules: [{ id: 'project-web', role: 'web', localPathKey: 'project.web', canonicalRemote: 'example.com/org/project', subpath: 'web' }] }] },
  localPaths: { project, 'project.web': modulePath }
 };
 assert.throws(() => buildContext({ cwd: project, intent: '检查网页', registry }), /项目说明路径无效/u);
});

test('直接模块入口仍校验绑定模板身份', (t) => {
 const project = gitRepo(t); const wrongTemplate = gitRepo(t); const modulePath = path.join(project, 'web');
 fs.mkdirSync(modulePath, { recursive: true });
 addRemote(project, 'https://example.com/org/project.git'); addRemote(wrongTemplate, 'https://example.com/org/wrong-template.git');
 const registry = {
  templates: { schemaVersion: 1, templates: [{ id: 'web-template', role: 'web', enabled: true, repository: { canonicalRemote: 'example.com/org/template', allowedRemotes: [] }, localPathKey: 'template.web', entrypoints: { agents: 'AGENTS.md', manifest: 'package.json' } }] },
  projects: { schemaVersion: 1, projects: [{ id: 'project', enabled: true, localPathKey: 'project', entrypoints: { agents: 'AGENTS.md' }, modules: [{ id: 'project-web', role: 'web', localPathKey: 'project.web', canonicalRemote: 'example.com/org/project', subpath: 'web', templateId: 'web-template' }] }] },
  localPaths: { project, 'project.web': modulePath, 'template.web': wrongTemplate }
 };
 assert.throws(() => buildContext({ cwd: modulePath, intent: '检查网页', registry }), /模板身份冲突/u);
});

test('Context 转发 operation、scope、plannedPaths 但路径名称不升级路由', (t) => {
  const repo = gitRepo(t);
  const readOnly = buildContext({
    cwd: repo,
    operation: 'read',
    intent: '分析新增模块后的架构职责',
    scope: ['src/auth'],
    plannedPaths: ['src/auth/access.mjs'],
  });
  assert.equal(readOnly.classification.operation, 'read');
  assert.equal(readOnly.classification.structureImpact, 'local');
  assert.equal(readOnly.executionRoute, 'read-only');
  assert.ok(readOnly.next.some((item) => /只读分析/u.test(item)));
  assert.equal(readOnly.next.some((item) => /实施最小 Diff/u.test(item)), false);

  const plannedContext = buildContext({
    cwd: repo,
    operation: 'write',
    intent: '修复普通功能',
    scope: ['src/orders'],
    plannedPaths: ['src/auth/access.mjs'],
  });
  assert.equal(plannedContext.executionRoute, 'local-direct-candidate');
  assert.equal(plannedContext.classification.continuity, 'ephemeral');
});

test('只读 Context 复用规格提示并把命中规格加入读取文件', (t) => {
  const repo = gitRepo(t);
  fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'orders.md'), '# 订单规格\nBR-ORD-001\n');
  fs.writeFileSync(path.join(repo, '.ai', 'spec-map.json'), JSON.stringify({
    schemaVersion: 1,
    mappings: [{
      id: 'orders',
      paths: ['src/orders/**'],
      keywords: ['订单规格'],
      specificationFiles: ['docs/orders.md'],
      specificationIds: ['BR-ORD-001'],
      testFiles: [],
      decisionFiles: [],
    }],
  }));
  const result = buildContext({ cwd: repo, operation: 'read', intent: '核对订单规格' });
  assert.deepEqual(result.specificationHints.matchedRuleIds, ['orders']);
  assert.ok(result.filesToRead.some((file) => file.endsWith(path.join('docs', 'orders.md'))));
});

test('存在但损坏或不是普通文件的 Quality JSON 失败关闭', (t) => {
  const malformed = gitRepo(t);
  fs.writeFileSync(path.join(malformed, '.ai', 'quality.json'), '{not-json');
  assert.throws(
    () => buildContext({ cwd: malformed, operation: 'read', intent: '检查项目' }),
    /质量清单 JSON 损坏/u,
  );

  const directory = gitRepo(t);
  fs.mkdirSync(path.join(directory, '.ai', 'quality.json'));
  assert.throws(
    () => buildContext({ cwd: directory, operation: 'read', intent: '检查项目' }),
    /质量清单必须是普通文件/u,
  );

  const unsupported = gitRepo(t);
  fs.writeFileSync(path.join(unsupported, '.ai', 'quality.json'), JSON.stringify({ schemaVersion: 999, contracts: [] }));
  assert.throws(
    () => buildContext({ cwd: unsupported, operation: 'read', intent: '检查项目' }),
    /schemaVersion 仅支持 1/u,
  );

  const invalidShape = gitRepo(t);
  fs.writeFileSync(path.join(invalidShape, '.ai', 'quality.json'), JSON.stringify({
    contracts: [{ id: 'invalid-shape', profiles: 'develop-web', path: 'README.md' }],
  }));
  assert.throws(
    () => buildContext({ cwd: invalidShape, operation: 'read', intent: '检查项目' }),
    /profiles 必须是非空字符串数组/u,
  );
});

test('Quality JSON 是悬空符号链接时不得当作未配置', (t) => {
  const repository = gitRepo(t);
  const manifest = path.join(repository, '.ai', 'quality.json');
  try {
    fs.symlinkSync(path.join(repository, '.ai', 'missing-quality.json'), manifest, 'file');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error?.code)) {
      t.skip(`当前平台无法创建测试符号链接: ${error.code}`);
      return;
    }
    throw error;
  }
  assert.throws(
    () => buildContext({ cwd: repository, operation: 'read', intent: '检查项目' }),
    /质量清单符号链接目标不存在/u,
  );
});

test('Quality Contract 路径越界或指向目录时失败关闭', (t) => {
  const escaped = gitRepo(t);
  const outside = tempDir(t, 'quality-outside-');
  const outsideFile = path.join(outside, 'contract.md');
  fs.writeFileSync(outsideFile, '# outside');
  fs.writeFileSync(path.join(escaped, '.ai', 'quality.json'), JSON.stringify({
    contracts: [{
      id: 'escaped', status: 'active', profiles: ['develop-web'],
      path: path.relative(escaped, outsideFile),
    }],
  }));
  assert.throws(
    () => loadQualityContext({
      role: 'web', intent: '新增模块', structureImpact: 'structural', artifactKinds: ['code'], projectRoot: escaped,
    }),
    /不能越出仓库/u,
  );

  const directory = gitRepo(t);
  fs.mkdirSync(path.join(directory, 'docs', 'contract'), { recursive: true });
  fs.writeFileSync(path.join(directory, '.ai', 'quality.json'), JSON.stringify({
    contracts: [{
      id: 'directory', status: 'active', profiles: ['develop-web'], path: 'docs/contract',
    }],
  }));
  assert.throws(
    () => loadQualityContext({
      role: 'web', intent: '新增模块', structureImpact: 'structural', artifactKinds: ['code'], projectRoot: directory,
    }),
    /必须指向普通文件/u,
  );
});

test('Canonical 仅在关键词得分大于零时加载且 read 只接受普通文件', (t) => {
  const unrelated = gitRepo(t);
  fs.mkdirSync(path.join(unrelated, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(unrelated, 'docs', 'customer.md'), '# customer');
  fs.writeFileSync(path.join(unrelated, '.ai', 'quality.json'), JSON.stringify({
    exemplars: [{
      id: 'customer', status: 'active', structureImpacts: ['structural'],
      keywords: ['客户'], read: ['docs/customer.md'],
    }],
  }));
  const noMatch = loadQualityContext({
    intent: '分析新增模块后的架构职责', structureImpact: 'structural', artifactKinds: ['code'], projectRoot: unrelated,
  });
  assert.equal(noMatch.exemplars.length, 0);

  const directory = gitRepo(t);
  fs.mkdirSync(path.join(directory, 'docs', 'customer'), { recursive: true });
  fs.writeFileSync(path.join(directory, '.ai', 'quality.json'), JSON.stringify({
    exemplars: [{
      id: 'customer', status: 'active', structureImpacts: ['structural'],
      keywords: ['客户'], read: ['docs/customer'],
    }],
  }));
  assert.throws(
    () => loadQualityContext({
      intent: '新增客户模块并调整架构', structureImpact: 'structural', artifactKinds: ['code'], projectRoot: directory,
    }),
    /必须指向普通文件/u,
  );
});

test('无效显式 Profile 失败关闭，Profile 截断产生 warning', (t) => {
  const repo = gitRepo(t);
  assert.throws(
    () => buildContext({ cwd: repo, operation: 'read', intent: '检查项目', qualityProfiles: ['unknown-profile'] }),
    /无效 Quality Profile/u,
  );
  const withoutContract = gitRepo(t);
  fs.mkdirSync(path.join(withoutContract, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(withoutContract, 'docs', 'example.md'), '# example');
  fs.writeFileSync(path.join(withoutContract, '.ai', 'quality.json'), JSON.stringify({
    exemplars: [{
      id: 'custom-example', status: 'active', profiles: ['custom-profile'],
      keywords: ['示例'], read: ['docs/example.md'],
    }],
  }));
  assert.throws(
    () => buildContext({
      cwd: withoutContract, operation: 'read', intent: '检查示例', qualityProfiles: ['custom-profile'],
    }),
    /显式 Quality Profile 没有可读取的 Contract/u,
  );
  const result = loadQualityContext({
    role: 'web',
    intent: '梳理需求、产品、界面和联调方案',
    structureImpact: 'local',
    artifactKinds: ['code'],
  });
  assert.equal(result.profiles.length, 2);
  assert.ok(result.warnings.some((warning) => /截断/u.test(warning)));
});

test('明确命中的 Experience 即使是局部任务也进入读取文件', (t) => {
  const repo = gitRepo(t);
  const experienceRoot = path.join(repo, '.ai', '30-经验');
  fs.mkdirSync(experienceRoot, { recursive: true });
  fs.writeFileSync(path.join(experienceRoot, 'cache-stampede.md'), '# 缓存击穿处理');
  fs.writeFileSync(path.join(experienceRoot, '索引.json'), JSON.stringify({
    routes: [{
      id: 'cache-stampede', lifecycle: 'active', keywords: ['缓存击穿'], read: ['cache-stampede.md'],
    }],
  }));
  const result = buildContext({ cwd: repo, operation: 'read', intent: '排查缓存击穿问题' });
  assert.equal(result.classification.structureImpact, 'local');
  assert.equal(result.quality.experiences[0]?.source, 'project');
  assert.ok(result.quality.experiences[0]?.path.endsWith(path.join('30-经验', 'cache-stampede.md')));
  assert.ok(result.filesToRead.some((file) => file.endsWith(path.join('30-经验', 'cache-stampede.md'))));
});

test('命中 Experience 但 read 指向目录时失败关闭', (t) => {
  const repo = gitRepo(t);
  const experienceRoot = path.join(repo, '.ai', '30-经验');
  fs.mkdirSync(path.join(experienceRoot, 'cache-stampede'), { recursive: true });
  fs.writeFileSync(path.join(experienceRoot, '索引.json'), JSON.stringify({
    routes: [{
      id: 'cache-stampede', lifecycle: 'active', keywords: ['缓存击穿'], read: ['cache-stampede'],
    }],
  }));
  assert.throws(
    () => buildContext({ cwd: repo, operation: 'read', intent: '排查缓存击穿问题' }),
    /必须指向普通文件/u,
  );
});
