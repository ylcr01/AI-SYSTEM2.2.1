import path from 'node:path';

const NODE_TEST_CASE_EVENT_PREFIX = 'AI_RD_NODE_TEST_CASE ';
const NODE_TEST_CASE_REPORTER = new URL('./node-test-case-reporter.mjs', import.meta.url).href;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function nodeTestArgs(check, { legacy }) {
  const config = check.config ?? {};
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('node-test config 必须是对象');
  if (legacy) {
    const unknown = Object.keys(config).filter((key) => key !== 'testNamePattern');
    if (unknown.length) throw new Error(`node-test config 包含未知字段: ${unknown.join(', ')}`);
    const args = ['--test'];
    if (config.testNamePattern) args.push('--test-name-pattern', String(config.testNamePattern));
    args.push(...check.testFiles);
    return args;
  }
  if (Object.keys(config).length) throw new Error('node-test v2 不接受 config；目标用例必须通过 cases 声明');
  if (!Array.isArray(check.cases) || !check.cases.length) throw new Error('node-test v2 必须声明非空 cases');
  const names = [...new Set(check.cases.map((item) => item.testName))];
  const pattern = `^(?:${names.map(escapeRegExp).join('|')})$`;
  return [
    '--test',
    '--test-reporter', NODE_TEST_CASE_REPORTER,
    '--test-name-pattern', pattern,
    ...check.testFiles,
  ];
}

const ADAPTERS = new Map([
  ['node-test', {
    sideEffect: 'workspace',
    build(check) {
      const legacy = check.legacy === true;
      return {
        version: legacy ? 1 : 2,
        resultProtocol: legacy ? 'exit-code-v1' : 'node-test-cases-v1',
        command: 'node',
        args: nodeTestArgs(check, { legacy }),
      };
    },
  }],
]);

function comparableFile(file, cwd) {
  if (!file) return null;
  const absolute = path.normalize(path.isAbsolute(file) ? file : path.resolve(cwd, file));
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

function parseNodeTestCaseEvents(stdout) {
  const events = [];
  const malformed = [];
  for (const line of String(stdout ?? '').split(/\r?\n/gu)) {
    if (!line.startsWith(NODE_TEST_CASE_EVENT_PREFIX)) continue;
    try {
      const event = JSON.parse(line.slice(NODE_TEST_CASE_EVENT_PREFIX.length));
      if (event?.schemaVersion !== 1
        || !['passed', 'failed'].includes(event?.event)
        || typeof event?.name !== 'string'
        || typeof event?.file !== 'string') {
        malformed.push(line);
      } else {
        events.push(event);
      }
    } catch {
      malformed.push(line);
    }
  }
  return { events, malformed };
}

function nodeTestCaseResult(check, execution) {
  const parsed = parseNodeTestCaseEvents(execution.stdout);
  const caseResults = (check.cases ?? []).map((declared) => {
    const expectedFile = comparableFile(declared.testFile, execution.cwd);
    const matches = parsed.events.filter((event) => event.name === declared.testName
      && [event.entryFile, event.file].some((file) => comparableFile(file, execution.cwd) === expectedFile));
    const skippedCount = matches.filter((event) => event.skipped === true).length;
    const todoCount = matches.filter((event) => event.todo === true).length;
    const failedCount = matches.filter((event) => event.event === 'failed').length;
    const passedCount = matches.filter((event) => event.event === 'passed' && !event.skipped && !event.todo).length;
    const matchedCount = matches.length;
    const ok = matchedCount === declared.expectedMatches
      && passedCount === declared.expectedMatches
      && failedCount === 0
      && skippedCount === 0
      && todoCount === 0;
    return {
      id: declared.id,
      acceptanceIds: declared.acceptanceIds,
      covers: declared.covers,
      testFile: declared.testFile,
      testName: declared.testName,
      expectedMatches: declared.expectedMatches,
      matchedCount,
      passedCount,
      failedCount,
      skippedCount,
      todoCount,
      status: ok ? 'passed' : 'failed',
      executed: matches.map((event) => ({
        name: event.name,
        file: event.file,
        entryFile: event.entryFile,
        status: event.skipped ? 'skipped' : event.todo ? 'todo' : event.event,
        durationMs: event.durationMs,
        error: event.error,
      })),
    };
  });
  const failedCases = caseResults.filter((item) => item.status !== 'passed');
  const errorParts = [];
  if (parsed.malformed.length) errorParts.push(`Runner 返回 ${parsed.malformed.length} 条无法解析的用例事件`);
  if (failedCases.length) {
    errorParts.push(`目标用例证明失败: ${failedCases.map((item) => `${item.id}(matched=${item.matchedCount}, passed=${item.passedCount}, failed=${item.failedCount}, skipped=${item.skippedCount}, todo=${item.todoCount})`).join(', ')}`);
  }
  return {
    caseResults,
    caseSummary: {
      declared: caseResults.length,
      passed: caseResults.length - failedCases.length,
      failed: failedCases.length,
      malformedEvents: parsed.malformed.length,
    },
    error: errorParts.length ? errorParts.join('；') : null,
  };
}

export function supportedCheckRunners() {
  return [...ADAPTERS.keys()];
}

export function buildAdapterCheck(check = {}) {
  const runner = String(check.runner ?? '').trim();
  const adapter = ADAPTERS.get(runner);
  if (!adapter) {
    throw new Error(`Task Check runner 不受支持: ${runner || 'missing'}；当前支持 ${supportedCheckRunners().join(', ')}`);
  }
  if (check.command !== undefined || check.args !== undefined || check.sideEffect !== undefined) {
    throw new Error(`Task Check ${check.name ?? ''} 只能声明 runner/cases/config，禁止自定义 command/args/sideEffect`);
  }
  const built = adapter.build(check);
  return {
    runner,
    adapterVersion: built.version,
    resultProtocol: built.resultProtocol,
    command: built.command,
    args: built.args,
    sideEffect: adapter.sideEffect,
  };
}

export function evaluateAdapterResult(check, execution) {
  if (!check.runner || check.resultProtocol === 'exit-code-v1') return { error: null };
  if (check.runner === 'node-test' && check.resultProtocol === 'node-test-cases-v1') {
    return nodeTestCaseResult(check, execution);
  }
  return { error: `Runner 结果协议不受支持: ${check.resultProtocol ?? 'missing'}` };
}
