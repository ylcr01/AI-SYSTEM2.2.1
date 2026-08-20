import { parseArgs, listArg } from './lib/args.mjs';
import { buildContext } from './lib/context-builder.mjs';

function readPlanFor(result) {
  const factByPath = new Map((result.facts ?? []).map(fact => [fact.path, fact]));
  const qualityEntries = [
    ...(result.quality?.contracts ?? []).map(item => ({
      path: item.path,
      reason: `质量契约: ${item.id}`,
      authority: item.source ?? 'central',
    })),
    ...(result.quality?.exemplars ?? []).flatMap(item => (item.files ?? []).map(file => ({
      path: file,
      reason: `Canonical 样板: ${item.id}`,
      authority: item.source ?? 'central',
    }))),
    ...(result.quality?.experiences ?? []).map(item => ({
      path: item.path,
      reason: '命中经验',
      authority: item.source ?? 'central',
    })),
  ];
  const qualityByPath = new Map(qualityEntries.map(item => [item.path, item]));
  return (result.filesToRead ?? []).map(file => {
    const fact = factByPath.get(file);
    if (fact) return { path: file, reason: fact.reason, authority: fact.authority };
    const quality = qualityByPath.get(file);
    if (quality) return { path: file, reason: quality.reason, authority: quality.authority };
    return { path: file, reason: '任务相关资料', authority: 'derived' };
  });
}

function compactContext(result) {
  const context = result.context ?? {};
  const compactIdentity = {
    kind: context.kind,
    gitRoot: context.gitRoot,
    remote: context.remote,
    branch: context.branch,
    head: context.head,
    projectId: context.project?.id,
    moduleId: context.module?.id,
    templateId: context.template?.id,
  };

  const compact = {
    schemaVersion: 1,
    view: 'summary',
    contextSchemaVersion: result.schemaVersion,
    context: Object.fromEntries(
      Object.entries(compactIdentity).filter(([, value]) => value !== undefined && value !== null && value !== ''),
    ),
    executionTarget: result.executionTarget,
    classification: {
      controlMode: result.classification?.controlMode,
      structureImpact: result.classification?.structureImpact,
      continuity: result.classification?.continuity,
      artifactKinds: result.classification?.artifactKinds ?? [],
      reasons: result.classification?.reasons ?? [],
    },
    manifests: (result.manifests ?? []).map(manifest => ({
      kind: manifest.kind,
      name: manifest.name,
      packageManager: manifest.packageManager,
      hasWorkspaces: Boolean(manifest.workspaces),
      scriptCount: manifest.scripts?.length ?? 0,
      frameworks: manifest.frameworks ?? [],
      checksHints: manifest.checksHints ?? [],
    })),
    quality: {
      baseline: result.quality?.baseline ?? null,
      pass: result.quality?.baseline
        ? { timing: 'before-delivery', rerunAffectedChecks: true }
        : null,
      contracts: (result.quality?.contracts ?? []).map(item => ({
        id: item.id,
        version: item.version,
        source: item.source,
      })),
    },
    configuration: result.configuration ?? [],
    filesToRead: result.filesToRead ?? [],
    readPlan: readPlanFor(result),
    warnings: [...(result.warnings ?? [])],
  };

  if (result.role) compact.role = result.role;
  if ((context.moduleCandidates?.length ?? 0) > 1) {
    compact.warnings.push(`检测到 ${context.moduleCandidates.length} 个模块候选，必要时使用 --full 诊断路由。`);
  }
  return compact;
}

const args = parseArgs(process.argv.slice(2));

try {
  const result = buildContext({
    cwd: args.cwd ?? process.cwd(),
    projectId: args.project,
    intent: args.intent ?? '',
    acceptance: args.acceptance ?? '',
    skills: listArg(args.skill),
    tracked: args.ephemeral !== true,
    handoffRequired: args.handoff === true,
  });

  console.log(JSON.stringify(args.full === true ? result : compactContext(result), null, 2));
} catch (error) {
  console.error(`上下文构建失败: ${error.message}`);
  process.exitCode = 1;
}
