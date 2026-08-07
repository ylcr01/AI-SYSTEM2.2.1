export function parseArgs(values = []) {
  const result = { _: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) { result._.push(value); continue; }
    const [rawKey, inline] = value.slice(2).split('=', 2);
    if (inline !== undefined) {
      result[rawKey] = Object.hasOwn(result, rawKey)
        ? [...(Array.isArray(result[rawKey]) ? result[rawKey] : [result[rawKey]]), inline]
        : inline;
      continue;
    }
    const next = values[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      result[rawKey] = Object.hasOwn(result, rawKey)
        ? [...(Array.isArray(result[rawKey]) ? result[rawKey] : [result[rawKey]]), next]
        : next;
      index += 1;
    } else result[rawKey] = true;
  }
  return result;
}

export function listArg(value) {
  if (value === undefined || value === null || value === false) return [];
  return (Array.isArray(value) ? value : [value])
    .flatMap((item) => String(item).split(/[,，]/u))
    .map((item) => item.trim()).filter(Boolean);
}

export function requiredArg(args, name) {
  const value = args[name];
  if (value === undefined || value === true || String(value).trim() === '') throw new Error(`缺少 --${name}`);
  return String(value);
}
