import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY', 'EEXIST']);
const WAIT = new Int32Array(new SharedArrayBuffer(4));
const DELAYS = [8, 16, 32, 64, 128, 256];

function sleep(ms) { Atomics.wait(WAIT, 0, 0, ms); }

function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt += 1) {
    try { fs.renameSync(from, to); return; }
    catch (error) {
      if (!RETRYABLE.has(error?.code) || attempt >= DELAYS.length) throw error;
      sleep(DELAYS[attempt]);
    }
  }
}

export function atomicWriteText(target, content, pendingRoot = null) {
  const absolute = path.resolve(target);
  const parent = path.dirname(absolute);
  const pending = path.resolve(pendingRoot ?? path.join(parent, '.pending'));
  fs.mkdirSync(parent, { recursive: true });
  fs.mkdirSync(pending, { recursive: true });
  const temporary = path.join(pending, `${crypto.randomUUID()}.tmp`);
  try {
    const fd = fs.openSync(temporary, 'wx');
    try { fs.writeFileSync(fd, content, 'utf8'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    renameWithRetry(temporary, absolute);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch {}
    throw error;
  }
  return absolute;
}

export function atomicWriteJson(target, value, pendingRoot = null) {
  return atomicWriteText(target, JSON.stringify(value, null, 2) + '\n', pendingRoot);
}

export function acquireFileLock(lockFile, options = {}) {
  const file = path.resolve(lockFile);
  const timeoutMs = Number(options.timeoutMs ?? 5000);
  const staleMs = Number(options.staleMs ?? 30000);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const started = Date.now();
  while (true) {
    try {
      const fd = fs.openSync(file, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      fs.closeSync(fd);
      return () => { try { fs.rmSync(file, { force: true }); } catch {} };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        const stat = fs.statSync(file);
        if (Date.now() - stat.mtimeMs > staleMs) { fs.rmSync(file, { force: true }); continue; }
      } catch {}
      if (Date.now() - started >= timeoutMs) throw new Error(`获取状态锁超时: ${file}`);
      sleep(DELAYS[Math.min(DELAYS.length - 1, Math.floor((Date.now() - started) / 100))]);
    }
  }
}

export function withFileLock(lockFile, action, options = {}) {
  const release = acquireFileLock(lockFile, options);
  try { return action(); } finally { release(); }
}

export function appendJsonLineLocked(target, value, lockFile) {
  return withFileLock(lockFile, () => {
    const absolute = path.resolve(target);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    const fd = fs.openSync(absolute, 'a');
    try { fs.writeFileSync(fd, JSON.stringify(value) + '\n', 'utf8'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
  });
}
