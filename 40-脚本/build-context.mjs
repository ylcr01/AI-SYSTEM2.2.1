import { parseArgs, listArg } from './lib/args.mjs';
import { buildContext } from './lib/context-builder.mjs';

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
      contracts: (result.quality?.contracts ?? []).map(item => ({
        id: item.id,
        version: item.version,
        source: item.source,
      })),
    },
    configuration: result.configuration ?? [],
    workstationRouting: result.workstationRouting ?? null,
    filesToRead: result.filesToRead ?? [],
    readPlan: (result.facts ?? [])
      .filter(fact => fact.readMode !== 'machine')
      .map(fact => ({ path: fact.path, reason: fact.reason, authority: fact.authority })),
    warnings: [...(result.warnings ?? [])],
  };

  if (result.role) compact.role = result.role;
  if ((context.moduleCandidates?.length ?? 0) > 1) {
    compact.warnings.push(`检测到 ${context.moduleCandidates.length} 个模块候选，必要时使用 --full 诊断路由。`);
  }
  if (result.workstationRouting?.ambiguous) {
    compact.warnings.push('多个业务工作站命中且得分相同，请使用 --workstation 显式选择。');
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
    workstation: args.workstation,
  });

  console.log(JSON.stringify(args.full === true ? result : compactContext(result), null, 2));
} catch (error) {
  console.error(`上下文构建失败: ${error.message}`);
  process.exitCode = 1;
}
