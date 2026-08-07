export const DEFAULT_BUDGETS=Object.freeze({quick:60_000,standard:300_000,controlled:900_000,release:Number.MAX_SAFE_INTEGER});
export function createBudget(input={}){const mode=input.mode??'standard';const limitMs=Number(input.limitMs??DEFAULT_BUDGETS[mode]??DEFAULT_BUDGETS.standard);if(!Number.isFinite(limitMs)||limitMs<=0)throw new Error('验证预算必须大于零');return{schemaVersion:1,mode,limitMs,spentMs:Number(input.spentMs??0),continued:input.continued===true,continuationNote:input.continuationNote??null};}
export function remainingBudget(budget){if(budget.continued||budget.mode==='release')return Number.MAX_SAFE_INTEGER;return Math.max(0,budget.limitMs-budget.spentMs);}
export function consumeBudget(budget,durationMs){return{...budget,spentMs:Math.max(0,budget.spentMs+Math.max(0,Number(durationMs??0)))};}
export function budgetDecision(budget){const remainingMs=remainingBudget(budget);return{allowed:remainingMs>0,remainingMs,reason:remainingMs>0?null:'budget-exhausted'};}
