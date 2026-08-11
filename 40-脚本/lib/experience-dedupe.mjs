import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '').trim();
}

export function experienceFingerprint(candidate = {}) {
  return crypto.createHash('sha256').update(JSON.stringify({
    rootCause: normalizeText(candidate.rootCause),
    action: normalizeText(candidate.action),
    boundary: normalizeText(candidate.boundary)
  })).digest('hex');
}

function frontMatter(content) {
  const lines = String(content ?? '').replace(/^\uFEFF/u, '').split(/\r?\n/u);
  if (lines[0]?.trim() !== '---') return { metadata: {}, body: content };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) throw new Error('经验 Markdown Front Matter 未闭合');
  const metadata = {};
  for (const line of lines.slice(1, end)) {
    const pair = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/u);
    if (pair) metadata[pair[1]] = pair[2].trim().replace(/^['"]|['"]$/gu, '');
  }
  return { metadata, body: lines.slice(end + 1).join('\n') };
}

function section(body, names) {
  const headings = [...String(body ?? '').matchAll(/^#{1,4}\s+(.+?)\s*$/gmu)];
  for (let index = 0; index < headings.length; index += 1) {
    if (!names.includes(headings[index][1].trim())) continue;
    const start = headings[index].index + headings[index][0].length;
    const end = headings[index + 1]?.index ?? body.length;
    return body.slice(start, end).trim();
  }
  return '';
}

function parseRecord(file) {
  const content = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.json')) return { ...JSON.parse(content), sourceFile: file };
  const { metadata, body } = frontMatter(content);
  const record = {
    id: metadata.id ?? path.basename(file, path.extname(file)),
    contentFingerprint: metadata.contentFingerprint || null,
    rootCause: section(body, ['Root Cause', '根因']),
    action: section(body, ['Action', '处理动作', '处理方法']),
    boundary: section(body, ['Boundary', '适用边界']),
    sourceFile: file
  };
  record.contentFingerprint ??= experienceFingerprint(record);
  return record;
}

export function loadExperienceRecords(root) {
  const directories = [path.join(root, '.ai', '30-经验'), path.join(root, '.ai', 'experiences')];
  const files = [];
  for (const directory of directories) {
    if (!fs.existsSync(directory)) continue;
    const stack = [directory];
    while (stack.length) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const target = path.join(current, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) stack.push(target);
        else if (/\.(?:json|md)$/iu.test(entry.name) && !/^(?:index|索引)\.json$/iu.test(entry.name)) files.push(target);
      }
    }
  }
  return files.sort().map((file) => {
    try { return parseRecord(file); }
    catch (error) { throw new Error(`经验文件无法解析 ${file}: ${error.message}`); }
  });
}

export function findExactExperience(candidate, records = []) {
  const fingerprint = candidate.contentFingerprint ?? experienceFingerprint(candidate);
  const match = records.find((record) => record.id !== candidate.id
    && (record.contentFingerprint ?? experienceFingerprint(record)) === fingerprint);
  return match ? { id: match.id, sourceFile: match.sourceFile ?? null } : null;
}
