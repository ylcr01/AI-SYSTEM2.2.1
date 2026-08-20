const ADAPTERS = new Map([
  ['node-test', {
    version: 1,
    sideEffect: 'workspace',
    build(check) {
      const config = check.config ?? {};
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('node-test config 必须是对象');
      const unknown = Object.keys(config).filter((key) => key !== 'testNamePattern');
      if (unknown.length) throw new Error(`node-test config 包含未知字段: ${unknown.join(', ')}`);
      const args = ['--test'];
      if (config.testNamePattern) {
        args.push('--test-name-pattern', String(config.testNamePattern));
      }
      args.push(...check.testFiles);
      return { command: 'node', args };
    },
  }],
]);

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
    throw new Error(`Task Check ${check.name ?? ''} 只能声明 runner/testFiles/config，禁止自定义 command/args/sideEffect`);
  }
  const built = adapter.build(check);
  return {
    runner,
    adapterVersion: adapter.version,
    command: built.command,
    args: built.args,
    sideEffect: adapter.sideEffect,
  };
}
