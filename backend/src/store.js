// Tiny JSON-file persistence for bots, positions, and trade history.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function fileFor(name) {
  return path.join(dataDir, `${name}.json`);
}

export function load(name, fallback) {
  const target = fileFor(name);
  let raw;
  try {
    raw = fs.readFileSync(target, 'utf8');
  } catch {
    return fallback; // missing file — normal first run
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    // Corrupt file: quarantine it so the next save() can't destroy
    // possibly-recoverable data, and say so loudly.
    const quarantined = `${target}.corrupt-${Date.now()}`;
    try { fs.renameSync(target, quarantined); } catch { /* keep going */ }
    console.error(`[store] ${name}.json was unreadable (${err.message}) — quarantined to ${quarantined}, starting from fallback`);
    return fallback;
  }
}

export function save(name, value) {
  const target = fileFor(name);
  const tmp = `${target}.${process.pid}.tmp`;
  const json = JSON.stringify(value, null, 2);
  fs.writeFileSync(tmp, json);
  // Atomic rename can intermittently fail with EPERM on Windows when the
  // target is briefly locked (AV, indexer, concurrent read). Retry, then
  // fall back to a direct overwrite so a save is never silently lost.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.renameSync(tmp, target);
      return;
    } catch (err) {
      if (err.code !== 'EPERM' && err.code !== 'EACCES') throw err;
    }
  }
  try {
    fs.writeFileSync(target, json);
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* temp cleanup best-effort */ }
  }
}
