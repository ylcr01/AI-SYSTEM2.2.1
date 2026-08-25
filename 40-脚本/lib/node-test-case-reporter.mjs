const EVENT_PREFIX = 'AI_RD_NODE_TEST_CASE ';

function messageFromError(error) {
  if (!error) return null;
  if (typeof error === 'string') return error;
  return String(error.message ?? error.code ?? error);
}

export default async function* nodeTestCaseReporter(source) {
  for await (const event of source) {
    if (event?.type !== 'test:pass' && event?.type !== 'test:fail') continue;
    const data = event.data ?? {};
    const details = data.details ?? {};
    yield `${EVENT_PREFIX}${JSON.stringify({
      schemaVersion: 1,
      event: event.type === 'test:pass' ? 'passed' : 'failed',
      name: String(data.name ?? ''),
      file: data.file ?? null,
      entryFile: data.entryFile ?? null,
      nesting: Number(data.nesting ?? 0),
      skipped: Boolean(data.skip ?? details.skip),
      todo: Boolean(data.todo ?? details.todo),
      durationMs: Number(details.duration_ms ?? 0),
      error: messageFromError(details.error),
    })}\n`;
  }
}

export const nodeTestCaseEventPrefix = EVENT_PREFIX;
