const CONTROLLED_WORDS = /权限|安全|隐私|迁移|生产|发布|部署|不可逆|外部写入|authorization|security|migration|production|deploy|release/iu;
const QUICK_WORDS = /文档|注释|错字|文案|README|说明|comment|typo|docs?/iu;
const STRUCTURAL_WORDS = /架构|新模块|模块拆分|职责迁移|公共接口|数据模型|跨仓|重构体系|architecture|new module|public contract/iu;

const HARD_RISK_PATTERNS = [
  ['security', /(^|\/)(auth|authentication|authorization|security|permissions?|privacy)(\/|$)/iu],
  ['database-migration', /(^|\/)(migrations?|database|schema)(\/|$)/iu],
  ['production', /(^|\/)(production|deploy|deployment|infra|infrastructure)(\/|$)/iu],
  ['workflow', /(^|\/)\.github\/workflows\//iu],
  ['build-contract', /(^|\/)(Dockerfile|docker-compose(?:\.[^.]+)?\.ya?ml|package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|pom\.xml|build\.gradle|Cargo\.toml|go\.mod|tsconfig\.json|vite\.config\.[^/]+|webpack\.config\.[^/]+|next\.config\.[^/]+)$/iu],
  ['public-contract', /(^|\/)(api|contracts?|public)(\/|$)/iu]
];

function inferArtifactKinds(text) {
  const kinds=[];
  if (/产品|规划|product/iu.test(text)) kinds.push('product');
  if (/需求|范围|验收|requirement/iu.test(text)) kinds.push('requirements');
  if (/界面|交互|视觉|\bui\b|\bux\b/iu.test(text)) kinds.push('ui');
  if (/接口|API/iu.test(text)) kinds.push('api');
  if (/数据|迁移|schema/iu.test(text)) kinds.push('data');
  if (/联调|集成|第三方|integration/iu.test(text)) kinds.push('integration');
  if (/部署|环境|运维|发布|operations?/iu.test(text)) kinds.push('operations');
  if (/文档|README|说明|documentation/iu.test(text)) kinds.push('documentation');
  if (kinds.length===0 || /代码|功能|Bug|修复|重构|code|feature/iu.test(text)) kinds.push('code');
  return [...new Set(kinds)];
}

export function classifyTask(input = {}) {
  const text=[input.intent,input.acceptance].filter(Boolean).join(' ');
  const intentRisk=CONTROLLED_WORDS.test(text);
  const controlMode=intentRisk?'controlled':QUICK_WORDS.test(text)?'quick':'standard';
  return {
    controlMode,
    recommendedControlMode:controlMode,
    structureImpact:STRUCTURAL_WORDS.test(text)?'structural':controlMode==='quick'?'none':'local',
    continuity:input.handoffRequired?'handoff-required':input.tracked===false?'ephemeral':'tracked',
    artifactKinds:inferArtifactKinds(text),
    reasons:intentRisk?['intent-risk-signal']:[]
  };
}

export function reclassifyFromChangeSet(classification, changeSet, input = {}) {
  const reasons=[];
  for(const file of changeSet?.files??[]) for(const [reason,pattern] of HARD_RISK_PATTERNS) if(pattern.test(file.path)) reasons.push(`${reason}:${file.path}`);
  const unique=[...new Set(reasons)];
  const runtimeChanged=(changeSet?.files??[]).some(file=>!/\.(md|txt)$/iu.test(file.path));
  let controlMode=classification.controlMode;
  if(unique.length) controlMode='controlled';
  else if(classification.reasons?.includes('intent-risk-signal')) controlMode=runtimeChanged?'standard':'quick';
  else if(controlMode==='quick'&&runtimeChanged) controlMode='standard';
  if(input.forcedMode){
    const order={quick:0,standard:1,controlled:2};
    if(order[input.forcedMode]<order[controlMode]&&!input.forceReason) throw new Error('向下降级 Control Mode 必须说明原因');
    if(unique.length&&input.forcedMode==='quick') throw new Error('真实高风险 ChangeSet 不得降到 Quick');
    controlMode=input.forcedMode;
  }
  return {...classification,controlMode,reclassificationReasons:unique,forcedMode:input.forcedMode??null,forceReason:input.forceReason??null};
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
  if(/package\.json|lock\.yaml|lock\.json|Dockerfile|vite\.config|webpack\.config|tsconfig|pom\.xml|build\.gradle/iu.test(joined))covers.add('package');
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
  if(input.inputChanged)return{allowed:true,reason:'input-changed'};
  if(input.diagnosticRetry&&!input.diagnosticRetryUsed)return{allowed:true,reason:'diagnostic-retry'};
  return{allowed:false,reason:input.diagnosticRetryUsed?'diagnostic-retry-already-used':'same-input-failure'};
}
