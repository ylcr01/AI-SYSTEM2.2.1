const QUICK_WORDS = /文档|注释|错字|文案|README|说明|comment|typo|docs?/iu;
const STRUCTURAL_WORDS = /架构|新模块|模块拆分|职责迁移|公共接口|数据模型|跨仓|重构体系|architecture|new module|public contract/iu;
const REFERENCE_EQUIVALENT_WORDS = /完全参照|完整复刻|逐项等价|以旧实现为行为基线|不能遗漏任何已有功能|100% 等价|reference implementation|exact behavioral equivalence/iu;
const STRICT_PRESERVATION_WORDS = /保持全部可观察行为|所有现有行为都不能改变|所有已有功能行为保持不变|零行为变化|行为完全不变|preserve all observable behavior|no observable behavior changes/iu;
const PRESERVATION_AWARE_WORDS = /重构|refactor|优化|optimize|升级|upgrade|替换实现|重新实现|reimplement|重写|rewrite|迁移|migration|移植|port/iu;
const OPERATIONS = new Set(['read', 'write', 'external-write']);

export const PROBLEM_TYPES = new Set([
  'bugfix',
  'feature',
  'refactor',
  'migration',
  'integration',
  'documentation',
  'maintenance',
  'external-operation',
  'unknown',
]);

function inferArtifactKinds(intent, acceptance) {
  const kinds=[];
  const text=[intent,acceptance].filter(Boolean).join(' ');
  if (/产品|规划|product/iu.test(intent)) kinds.push('product');
  if (/需求|范围|requirement/iu.test(intent)) kinds.push('requirements');
  if (/界面|交互|视觉|\bui\b|\bux\b/iu.test(text)) kinds.push('ui');
  if (/接口|API/iu.test(text)) kinds.push('api');
  if (/数据|迁移|schema/iu.test(text)) kinds.push('data');
  if (/联调|集成|第三方|integration/iu.test(text)) kinds.push('integration');
  if (/部署|环境|运维|发布|operations?/iu.test(text)) kinds.push('operations');
  if (/文档|README|说明|documentation/iu.test(text)) kinds.push('documentation');
  if (kinds.length===0 || /代码|功能|Bug|修复|重构|code|feature/iu.test(text)) kinds.push('code');
  return [...new Set(kinds)];
}

export function inferProblemType(intent, acceptance = '') {
  const text = [intent, acceptance].filter(Boolean).join(' ');
  if (/发布|部署|生产数据|远程删除|外部写入|publish|deploy|production write|remote delete/iu.test(text)) return 'external-operation';
  if (/迁移|移植|升级|migration|migrate|port|upgrade/iu.test(text)) return 'migration';
  if (/联调|集成|第三方|integration|integrate|third[- ]party/iu.test(text)) return 'integration';
  if (/修复|缺陷|故障|错误|异常|\bbug\b|\bfix(?:e[ds])?\b|defect|regression/iu.test(text)) return 'bugfix';
  if (/重构|重写|优化结构|整理结构|refactor|rewrite|reimplement/iu.test(text)) return 'refactor';
  if (/文档|注释|错字|文案|README|说明|comment|typo|docs?|documentation/iu.test(text)) return 'documentation';
  if (/新增|实现|增加|功能|特性|feature|implement|add support/iu.test(text)) return 'feature';
  return text.trim() ? 'maintenance' : 'unknown';
}

function inferPreservation(text) {
  if (REFERENCE_EQUIVALENT_WORDS.test(text)) return { mode: 'reference-equivalent', reasons: ['reference-request'] };
  if (STRICT_PRESERVATION_WORDS.test(text)) return { mode: 'preserve-all-observable', reasons: ['strict-preservation-request'] };
  if (PRESERVATION_AWARE_WORDS.test(text)) return { mode: 'preserve-unrequested', reasons: ['preservation-aware'] };
  return { mode: 'preserve-unrequested', reasons: [] };
}

function normalizeOperation(operation) {
  const value = String(operation ?? 'write').trim();
  if (!OPERATIONS.has(value)) throw new Error(`无效 operation: ${value || '(empty)'}`);
  return value;
}

function executionRouteFor({ operation, continuity }) {
  if (operation === 'read') return 'read-only';
  if (operation === 'external-write') return 'formal-task';
  return continuity === 'ephemeral' ? 'local-direct-candidate' : 'formal-task';
}

export function classifyTask(input = {}) {
  const operation=normalizeOperation(input.operation);
  const intent=String(input.intent??'');
  const text=[intent,input.acceptance].filter(Boolean).join(' ');
  const artifactKinds=inferArtifactKinds(intent,input.acceptance);
  const problemType=inferProblemType(intent,input.acceptance);
  const semanticDocument=artifactKinds.some(kind=>['product','requirements'].includes(kind));
  const formalContext=operation!=='read'
    && (input.tracked===true||input.handoffRequired===true||operation==='external-write');
  const structural=formalContext&&STRUCTURAL_WORDS.test(text);
  const controlMode=operation==='external-write'
    ? 'controlled'
    : QUICK_WORDS.test(text)&&!semanticDocument&&!structural?'quick':'standard';
  const formalTracking=input.tracked===true||operation==='external-write';
  const preservation=inferPreservation(text);
  const continuity=operation==='read'
    ? 'ephemeral'
    : input.handoffRequired?'handoff-required':formalTracking?'tracked':'ephemeral';
  const structureImpact=structural?'structural':controlMode==='quick'?'none':'local';
  return {
    operation,
    executionRoute:executionRouteFor({operation,continuity}),
    controlMode,
    recommendedControlMode:controlMode,
    structureImpact,
    continuity,
    artifactKinds,
    problemType,
    preservationMode:preservation.mode,
    preservationReasons:preservation.reasons,
    reasons:operation==='external-write'?['operation-external-write']:[]
  };
}

export function reclassifyFromChangeSet(classification, changeSet, input = {}) {
  const operation = normalizeOperation(classification?.operation);
  const packageManifestChanges = Array.isArray(input.packageManifestChanges) ? input.packageManifestChanges : null;
  const runtimeChanged=(changeSet?.files??[]).some(file=>!/\.(md|mdx|rst|adoc)$/iu.test(file.path));
  const semanticDocument=(classification.artifactKinds??[]).some(kind=>['product','requirements'].includes(kind));
  const documentationOnly=(changeSet?.files??[]).length>0&&!runtimeChanged;
  const artifactKinds=documentationOnly
    ? [...new Set([...(classification.artifactKinds??[]).filter(kind=>['product','requirements'].includes(kind)),'documentation'])]
    : classification.artifactKinds;
  const problemType=documentationOnly ? 'documentation' : classification.problemType;
  let controlMode=classification.controlMode;
  if(documentationOnly&&!semanticDocument&&classification.structureImpact!=='structural'&&operation!=='external-write') controlMode='quick';
  else if(controlMode==='quick'&&runtimeChanged) controlMode='standard';
  if(operation==='external-write') controlMode='controlled';
  if(input.forcedMode){
    const order={quick:0,standard:1,controlled:2};
    if(!(input.forcedMode in order)) throw new Error(`无效 forcedMode: ${input.forcedMode}`);
    if(order[input.forcedMode]<order[controlMode]) throw new Error('forcedMode 只能向上加强，不能降低真实 Control Mode');
    controlMode=input.forcedMode;
  }
  const structureImpact=controlMode==='quick'?'none':classification.structureImpact;
  let continuity=classification.continuity??'ephemeral';
  if(operation==='read') continuity='ephemeral';
  else if(continuity!=='handoff-required'&&input.forcedMode==='controlled') continuity='tracked';
  const executionRoute=executionRouteFor({operation,continuity});
  return {...classification,operation,executionRoute,controlMode,structureImpact,continuity,artifactKinds,problemType,reclassificationReasons:[],packageManifestChanges:packageManifestChanges??classification.packageManifestChanges??null,forcedMode:input.forcedMode??null,forceReason:input.forceReason??null};
}

export function determineEvidenceRequirements(input = {}) {
  const mode=input.classification?.controlMode??'standard'; const paths=(input.changeSet?.files??[]).map(x=>x.path);
  const covers=new Set(['scope','diff']);
  if(mode!=='quick')covers.add('behavior');
  if(mode==='controlled')covers.add('negative-path');
  for(const item of input.acceptance??[]) for(const cover of item.requiredCovers??[]) covers.add(cover);
  const joined=paths.join(' ');
  if(/\.(ts|tsx|vue)$/iu.test(joined))covers.add('typecheck');
  if(/(migrations?|database|schema)/iu.test(joined)){covers.add('data');covers.add('rollback');}
  const packagePaths=paths.filter((item)=>(/(^|\/)package\.json$/iu).test(item));
  const manifestChanges=input.classification?.packageManifestChanges;
  const packageIntegrityRequired=Array.isArray(manifestChanges)
    ? manifestChanges.some((item)=>item.requiresPackageIntegrity!==false)
    : packagePaths.length>0;
  const otherBuildContract=paths.some((item)=>!/(^|\/)package\.json$/iu.test(item)
    && /lock\.yaml|lock\.json|Dockerfile|vite\.config|webpack\.config|tsconfig|pom\.xml|build\.gradle/iu.test(item));
  if(packageIntegrityRequired||otherBuildContract)covers.add('package');
  if(input.observableBrowserBehavior===true)covers.add('browser');
  if(input.classification?.structureImpact==='structural')covers.add('architecture');
  if(input.classification?.artifactKinds?.includes('documentation'))covers.add('documentation');
  return [...covers];
}

export function evaluateDeliveryEligibility(input = {}) {
  if(!input.identityValid)return{decision:'blocked',reasons:['identity']};
  if(!input.scopeValid)return{decision:'blocked',reasons:['scope']};
  if(!input.userChangesIsolated)return{decision:'blocked',reasons:['user-changes']};
  if((input.blockers??[]).length)return{decision:'blocked',reasons:['blockers',...input.blockers]};
  if((input.invalidEvidence??[]).length)return{decision:'verifying',reasons:['invalid-evidence']};
  if((input.missingAcceptance??[]).length||(input.missingCovers??[]).length)return{decision:'verifying',reasons:['missing-evidence']};
  if(input.reviewHasBlockingFindings)return{decision:'needs_rework',reasons:['blocking-review-finding']};
  if(input.explicitReviewRequirement&&!input.reviewSatisfied)return{decision:'reviewing',reasons:['explicit-review-requirement']};
  if(input.handoffRequired&&!input.handoffReady)return{decision:'verifying',reasons:['handoff-required']};
  if(input.integrationRequired&&!input.integrationReady)return{decision:'verifying',reasons:['integration-commit-required',...(input.integrationReasons??[])]};
  if(input.integrationRequired)return{decision:'ready_to_integrate',reasons:['integration-required']};
  return{decision:'waiting_acceptance',reasons:[]};
}

export function evaluateExternalAction(input = {}) {
  const auth=input.authorization;
  if(!auth?.approvedByUser)return{decision:'block',reason:'missing-user-authorization'};
  if(auth.action!==input.action||auth.target!==input.target)return{decision:'block',reason:'authorization-target-mismatch'};
  if(input.highRisk&&!auth.rollback)return{decision:'block',reason:'missing-rollback'};
  return{decision:'allow'};
}

export function canRerunVerification(input = {}) {
  if(!input.previousFailure)return{allowed:true,reason:'no-previous-failure'};
  if(input.diagnosticRetry&&!input.diagnosticRetryUsed)return{allowed:true,reason:'diagnostic-retry'};
  return{allowed:false,reason:input.diagnosticRetryUsed?'diagnostic-retry-already-used':'same-input-failure'};
}
