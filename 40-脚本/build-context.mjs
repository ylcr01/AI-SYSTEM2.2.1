import path from 'node:path';
import { parseArgs, listArg, requiredArg } from './lib/args.mjs';
import { buildContext } from './lib/context-builder.mjs';
import { fileSha256, payloadHash } from './lib/evidence.mjs';
import { classifyTask } from './lib/task-policy.mjs';

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
  const specificationFiles = new Set((result.specificationHints?.specificationFiles ?? []).map(file => (
    path.resolve(result.context?.gitRoot ?? process.cwd(), file)
  )));
  return (result.filesToRead ?? []).map(file => {
    const fact = factByPath.get(file);
    if (fact) return { path: file, reason: fact.reason, authority: fact.authority, fingerprint: fileSha256(file) };
    const quality = qualityByPath.get(file);
    if (quality) return { path: file, reason: quality.reason, authority: quality.authority, fingerprint: fileSha256(file) };
    if (specificationFiles.has(path.resolve(file))) {
      return { path: file, reason: '命中规格', authority: 'project', fingerprint: fileSha256(file) };
    }
    return { path: file, reason: '任务相关资料', authority: 'derived', fingerprint: fileSha256(file) };
  });
}

function compactContext(result, options = {}) {
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

  const readPlan = readPlanFor(result);
  const contextFingerprint = payloadHash({
    context: compactIdentity,
    executionTarget: result.executionTarget,
    classification: result.classification,
    manifests: result.manifests,
    configuration: result.configuration,
    quality: {
      baseline: result.quality?.baseline,
      profiles: result.quality?.profiles,
      contracts: (result.quality?.contracts ?? []).map(({ id, version, source }) => ({ id, version, source })),
      exemplars: (result.quality?.exemplars ?? []).map(({ id, version, source }) => ({ id, version, source })),
    },
    specificationHints: result.specificationHints ?? null,
    readPlan: readPlan.map(({ path, fingerprint }) => ({ path, fingerprint })),
  });
  const contextUnchanged = Boolean(options.knownContextFingerprint)
    && options.knownContextFingerprint === contextFingerprint;
  const compact = {
    schemaVersion: 1,
    view: 'summary',
    contextSchemaVersion: result.schemaVersion,
    contextFingerprint,
    contextUnchanged,
    context: Object.fromEntries(
      Object.entries(compactIdentity).filter(([, value]) => value !== undefined && value !== null && value !== ''),
    ),
    executionTarget: result.executionTarget,
    classification: {
      operation: result.classification?.operation,
      executionRoute: result.classification?.executionRoute,
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
    specificationHints: result.specificationHints ?? null,
    configuration: result.configuration ?? [],
    filesToRead: contextUnchanged ? [] : result.filesToRead ?? [],
    readPlan: contextUnchanged ? [] : readPlan,
    warnings: [...(result.warnings ?? [])],
  };

  if (contextUnchanged) {
    compact.projection = {
      filesToRead: {
        total: readPlan.length,
        shown: 0,
        truncated: false,
        suppressedUnchanged: true,
      },
    };
  }

  if (result.role) compact.role = result.role;
  if ((context.moduleCandidates?.length ?? 0) > 1) {
    compact.warnings.push(`检测到 ${context.moduleCandidates.length} 个模块候选，必要时使用 --full 诊断路由。`);
  }
  return compact;
}

const args = parseArgs(process.argv.slice(2));

try {
  const operation = requiredArg(args, 'operation');
  const intent = args.intent ?? '';
  const acceptance = args.acceptance ?? '';
  const classification = classifyTask({
    operation,
    intent,
    acceptance,
    scope: listArg(args.scope),
    path: listArg(args.path),
    tracked: args.tracked === true,
    handoffRequired: args.handoff === true,
  });
  const result = buildContext({
    cwd: args.cwd ?? process.cwd(),
    projectId: args.project,
    intent,
    acceptance,
    classification,
    qualityProfiles: [...new Set([
      ...listArg(args['quality-profile']),
      ...listArg(args.skill),
    ])],
  });

  console.log(JSON.stringify(args.full === true
    ? result
    : compactContext(result, { knownContextFingerprint: args['known-context-fingerprint'] }), null, 2));
} catch (error) {
  console.error(`上下文构建失败: ${error.message}`);
  process.exitCode = 1;
}
