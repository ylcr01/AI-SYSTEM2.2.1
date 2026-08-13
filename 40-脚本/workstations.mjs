#!/usr/bin/env node
import { parseArgs, requiredArg } from './lib/args.mjs';
import {
  analyzeWorkstations,
  initializeWorkstations,
  refreshWorkstations,
  routeWorkstation,
  validateWorkstationIndex,
} from './lib/workstations.mjs';

const args = parseArgs(process.argv.slice(2));
const aliases = new Map([
  ['analyze', '分析'], ['init', '初始化'], ['check', '检查'], ['route', '路由'], ['refresh', '刷新'], ['help', '帮助'],
]);
const action = aliases.get(args._[0]) ?? args._[0] ?? '帮助';

function help() {
  console.log(`项目业务工作站：
  分析 [--cwd <项目>] [--intent <目标>]
  初始化 --cwd <项目> --plan <已确认方案.json> --confirm-plan
  检查 [--cwd <项目>]
  路由 --cwd <项目> --intent <任务> [--workstation <id>]
  刷新 --cwd <项目> --confirm-reviewed

“分析、检查、路由”只读；“初始化、刷新”必须在目标项目的已准备写 Task 中执行。
初始化从不覆盖已有 .ai/workstations。工作站是软领域归属，不是目录权限边界。`);
}

try {
  let result;
  if (action === '帮助' || args.help === true) help();
  else if (action === '分析') result = analyzeWorkstations({ cwd: args.cwd ?? process.cwd(), intent: args.intent ?? '', workstation: args.workstation ?? null });
  else if (action === '初始化') result = initializeWorkstations({
    cwd: args.cwd ?? process.cwd(),
    planFile: requiredArg(args, 'plan'),
    confirmPlan: args['confirm-plan'] === true,
  });
  else if (action === '检查') result = validateWorkstationIndex(args.cwd ?? process.cwd());
  else if (action === '路由') result = routeWorkstation(args.cwd ?? process.cwd(), requiredArg(args, 'intent'), args.workstation ?? null);
  else if (action === '刷新') result = refreshWorkstations({ cwd: args.cwd ?? process.cwd(), confirmReviewed: args['confirm-reviewed'] === true });
  else throw new Error(`未知工作站命令: ${action}`);
  if (result !== undefined) {
    console.log(JSON.stringify(result, null, 2));
    if (result?.ok === false) process.exitCode = 1;
  }
} catch (error) {
  console.error(`工作站操作失败: ${error.message}`);
  process.exitCode = 1;
}
