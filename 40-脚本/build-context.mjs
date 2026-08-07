import { parseArgs,listArg } from './lib/args.mjs';
import { buildContext } from './lib/context-builder.mjs';
const args=parseArgs(process.argv.slice(2));try{console.log(JSON.stringify(buildContext({cwd:args.cwd??process.cwd(),projectId:args.project,intent:args.intent??'',acceptance:args.acceptance??'',skills:listArg(args.skill),tracked:args.ephemeral!==true,handoffRequired:args.handoff===true}),null,2));}catch(error){console.error(`上下文构建失败: ${error.message}`);process.exitCode=1;}
