import path from 'node:path';
import { parseArgs, requiredArg } from './lib/args.mjs';
import { atomicWriteJson } from './lib/atomic-file.mjs';
import {
  loadRegistry,
  normalizeRemote,
  SYSTEM_ROOT,
  validateRegistry
} from './lib/registry.mjs';

const args = parseArgs(process.argv.slice(2));
const command = args._[0] ?? 'list';
const root = path.resolve(args.root ?? SYSTEM_ROOT);
const registry = loadRegistry(root);
const directory = path.join(root, '10-注册表');

function save() {
  const result = validateRegistry(registry);
  if (result.errors.length) {
    throw new Error(result.errors.map((item) => `${item.location}: ${item.message}`).join('; '));
  }
  const pending = path.join(root, '80-运行记录', '.pending');
  atomicWriteJson(path.join(directory, 'projects.json'), registry.projects, pending);
  atomicWriteJson(path.join(directory, 'templates.json'), registry.templates, pending);
  atomicWriteJson(path.join(directory, 'local.paths.json'), registry.localPaths, pending);
}

function help() {
  console.log(`注册表管理命令：
  list
  validate
  add-template --id <id> --role <role> --remote <git-remote> [--path <local-path>]
  add-project --id <id> [--path <project-path>]
  add-module --project <project-id> --id <id> --role <role> --remote <git-remote>
             [--path <module-path>] [--subpath <git-relative-path>] [--template <template-id>]
  bind-template --module <module-id> --template <template-id|none>
  set-enabled --id <template-or-project-id> --enabled <true|false>
  set-path --key <local-path-key> --path <local-path>

登记和绑定只维护身份关系，不复制模板代码。`);
}

try {
  if (command === 'help' || command === '帮助' || args.help === true) {
    help();
  } else if (command === 'list') {
    console.log(JSON.stringify({
      templates: registry.templates.templates,
      projects: registry.projects.projects,
      paths: registry.localPaths,
      validation: validateRegistry(registry)
    }, null, 2));
  } else if (command === 'validate') {
    const result = validateRegistry(registry);
    console.log(JSON.stringify(result, null, 2));
    if (result.errors.length) process.exitCode = 1;
  } else if (command === 'set-path') {
    registry.localPaths[requiredArg(args, 'key')] = path.resolve(requiredArg(args, 'path'));
    save();
    console.log('路径已更新');
  } else if (command === 'add-template') {
    const id = requiredArg(args, 'id');
    const role = requiredArg(args, 'role');
    const remote = normalizeRemote(requiredArg(args, 'remote'));
    const localPathKey = args['path-key'] ?? `template.${id}`;
    registry.templates.templates.push({
      id,
      role,
      enabled: true,
      repository: { canonicalRemote: remote, allowedRemotes: [remote] },
      localPathKey,
      entrypoints: {
        agents: args.agents ?? 'AGENTS.md',
        manifest: args.manifest ?? (role === 'server' ? 'pom.xml' : 'package.json')
      },
      knowledge: { mode: 'in-repo', root: '.ai', manifest: '.ai/manifest.json' },
      ...(args.quality ? { quality: { manifest: args.quality } } : {})
    });
    if (args.path) registry.localPaths[localPathKey] = path.resolve(args.path);
    save();
    console.log('模板已添加');
  } else if (command === 'add-project') {
    const id = requiredArg(args, 'id');
    const localPathKey = args['path-key'] ?? `project.${id}`;
    registry.projects.projects.push({
      id,
      enabled: true,
      localPathKey,
      entrypoints: { agents: args.agents ?? 'AGENTS.md', docs: args.docs ?? 'README.md' },
      modules: []
    });
    if (args.path) registry.localPaths[localPathKey] = path.resolve(args.path);
    save();
    console.log('项目已添加');
  } else if (command === 'add-module') {
    const project = registry.projects.projects.find((item) => item.id === requiredArg(args, 'project'));
    if (!project) throw new Error('项目不存在');
    const id = requiredArg(args, 'id');
    const role = requiredArg(args, 'role');
    const localPathKey = args['path-key'] ?? `project.${project.id}.${role}`;
    project.modules.push({
      id,
      role,
      localPathKey,
      canonicalRemote: normalizeRemote(requiredArg(args, 'remote')),
      ...(args.subpath ? { subpath: String(args.subpath).replaceAll('\\', '/') } : {}),
      ...(args.template ? { templateId: args.template } : {})
    });
    if (args.path) registry.localPaths[localPathKey] = path.resolve(args.path);
    save();
    console.log('模块已添加');
  } else if (command === 'bind-template') {
    const moduleId = requiredArg(args, 'module');
    const module = registry.projects.projects.flatMap((project) => project.modules ?? [])
      .find((item) => item.id === moduleId);
    if (!module) throw new Error('模块不存在');
    const templateId = requiredArg(args, 'template');
    if (templateId === 'none') delete module.templateId;
    else module.templateId = templateId;
    save();
    console.log('模板绑定已更新');
  } else if (command === 'set-enabled') {
    const id = requiredArg(args, 'id');
    const item = [...registry.templates.templates, ...registry.projects.projects]
      .find((candidate) => candidate.id === id);
    if (!item) throw new Error('登记不存在');
    item.enabled = requiredArg(args, 'enabled') === 'true';
    save();
    console.log('状态已更新');
  } else {
    throw new Error(`未知注册表命令: ${command}`);
  }
} catch (error) {
  console.error(`注册表操作失败: ${error.message}`);
  process.exitCode = 1;
}
