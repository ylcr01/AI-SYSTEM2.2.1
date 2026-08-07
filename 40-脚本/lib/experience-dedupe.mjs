import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '')
    .trim();
}

function grams(value) {
  const text = normalizeText(value);
  if (!text) return new Set();
  const asciiWords = String(value ?? '').toLowerCase().match(/[a-z0-9_./:-]{2,}/gu) ?? [];
  const result = new Set(asciiWords);
  if (text.length === 1) result.add(text);
  else for (let index = 0; index < text.length - 1; index += 1) result.add(text.slice(index, index + 2));
  return result;
}

function jaccard(left, right) {
  if (!left.size && !right.size) return 1;
  const intersection = [...left].filter((item) => right.has(item)).length;
  return intersection / (left.size + right.size - intersection || 1);
}

function candidateText(candidate = {}) {
  return [candidate.trigger, candidate.rootCause, candidate.action, candidate.boundary, ...(candidate.keywords ?? [])]
    .filter(Boolean)
    .join(' ');
}

export function experienceFingerprint(candidate = {}) {
  return crypto.createHash('sha256').update(JSON.stringify({
    rootCause: normalizeText(candidate.rootCause),
    action: normalizeText(candidate.action),
    boundary: normalizeText(candidate.boundary)
  })).digest('hex');
}

function parseScalar(value) {
  const trimmed = String(value ?? '').trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).split(/[,，]/u).map((item) => item.trim().replace(/^['"]|['"]$/gu, '')).filter(Boolean);
  }
  return trimmed.replace(/^['"]|['"]$/gu, '');
}

function parseFrontMatter(content) {
  const lines = String(content ?? '').replace(/^\uFEFF/u, '').split(/\r?\n/u);
  if (lines[0]?.trim() !== '---') return { metadata: {}, body: content };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) throw new Error('经验 Markdown Front Matter 未闭合');
  const metadata = {};
  let currentList = null;
  for (const line of lines.slice(1, end)) {
    const item = line.match(/^\s*-\s+(.+)$/u);
    if (item && currentList) {
      metadata[currentList].push(parseScalar(item[1]));
      continue;
    }
    const pair = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/u);
    if (!pair) continue;
    const value = pair[2].trim();
    if (!value) {
      metadata[pair[1]] = [];
      currentList = pair[1];
    } else {
      metadata[pair[1]] = parseScalar(value);
      currentList = null;
    }
  }
  return { metadata, body: lines.slice(end + 1).join('\n') };
}

function markdownSections(body) {
  const matches = [...String(body ?? '').matchAll(/^(#{1,4})\s+(.+?)\s*$/gmu)];
  const sections = [];
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const next = matches[index + 1];
    const start = current.index + current[0].length;
    const end = next?.index ?? body.length;
    sections.push({ title: current[2].trim(), content: body.slice(start, end).trim() });
  }
  return sections;
}

function sectionValue(sections, names) {
  const patterns = names.map((name) => new RegExp(`^${name}$`, 'iu'));
  return sections.find((section) => patterns.some((pattern) => pattern.test(section.title)))?.content ?? '';
}

function parseMarkdown(file, content) {
  const { metadata, body } = parseFrontMatter(content);
  const sections = markdownSections(body);
  return {
    id: String(metadata.id ?? path.basename(file, path.extname(file))).trim(),
    status: String(metadata.status ?? metadata.lifecycle ?? 'published').trim(),
    lifecycle: String(metadata.lifecycle ?? metadata.status ?? 'published').trim(),
    trigger: sectionValue(sections, ['Trigger', '触发条件', '触发现象']),
    rootCause: sectionValue(sections, ['Root Cause', '根因']),
    action: sectionValue(sections, ['Action', '处理动作', '处理方法']),
    boundary: sectionValue(sections, ['Boundary', '适用边界']),
    keywords: Array.isArray(metadata.keywords)
      ? metadata.keywords.map(String).map((item) => item.trim()).filter(Boolean)
      : String(metadata.keywords ?? '').split(/[,，]/u).map((item) => item.trim()).filter(Boolean),
    contentFingerprint: typeof metadata.contentFingerprint === 'string' ? metadata.contentFingerprint : null,
    sourceFile: file
  };
}

function parseRecord(file) {
  const content = fs.readFileSync(file, 'utf8');
  try {
    if (file.endsWith('.json')) return { ...JSON.parse(content), sourceFile: file };
    return parseMarkdown(file, content);
  } catch (error) {
    throw new Error(`经验文件无法解析 ${file}: ${error.message}`);
  }
}

function collectFiles(root) {
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
        else if (/\.(?:json|md)$/iu.test(entry.name)) files.push(target);
      }
    }
  }
  return files.sort();
}

export function loadExperienceRecords(root) {
  return collectFiles(path.resolve(root)).map(parseRecord);
}

export function findSimilarExperiences(candidate, records = [], options = {}) {
  const threshold = Number(options.threshold ?? 0.72);
  const exactThreshold = Number(options.exactThreshold ?? 0.92);
  const fingerprint = experienceFingerprint(candidate);
  const source = grams(candidateText(candidate));
  const matches = records
    .filter((record) => record.id !== candidate.id)
    .map((record) => {
      const exact = record.contentFingerprint === fingerprint || experienceFingerprint(record) === fingerprint;
      const similarity = exact ? 1 : jaccard(source, grams(candidateText(record)));
      return {
        id: record.id ?? path.basename(record.sourceFile ?? 'unknown'),
        status: record.status ?? record.lifecycle ?? 'unknown',
        sourceFile: record.sourceFile ?? null,
        similarity: Number(similarity.toFixed(4)),
        exact: exact || similarity >= exactThreshold
      };
    })
    .filter((item) => item.similarity >= threshold)
    .sort((left, right) => right.similarity - left.similarity || String(left.id).localeCompare(String(right.id)));
  return {
    threshold,
    exactThreshold,
    duplicate: matches.some((item) => item.exact),
    similar: matches.length > 0,
    bestMatch: matches[0] ?? null,
    matches
  };
}
