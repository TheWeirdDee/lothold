// Checks that every relative link and image in the Markdown files actually resolves to a file in the
// repository, so a rename or a new screenshot cannot quietly break the documentation.
//   npm run docs:check
// It deliberately ignores prose: only local link targets are asserted, never wording.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type BrokenLink = { file: string; link: string; target: string };

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'server-dist', 'data', 'test-results', 'out', 'cache']);

function markdownFiles(root: string, dir = root, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') && dir !== root) continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      markdownFiles(root, path, acc);
    } else if (name.toLowerCase().endsWith('.md')) acc.push(path);
  }
  return acc;
}

/** Local link/image targets that do not exist, relative to `root`. */
export function findBrokenLinks(root: string): BrokenLink[] {
  const broken: BrokenLink[] = [];
  // Inline links and images, plus HTML <img src> / <a href> attributes.
  const pattern = /!?\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)|<(?:img|a|source)\b[^>]*\b(?:src|href)\s*=\s*"([^"]+)"/gi;
  for (const file of markdownFiles(root)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(pattern)) {
      const raw = (m[1] ?? m[2] ?? '').trim();
      if (!raw) continue;
      if (/^(https?:|mailto:|tel:|data:)/i.test(raw)) continue;
      if (raw.startsWith('#')) continue;
      const [path] = raw.split('#');
      if (!path) continue;
      const target = resolve(dirname(file), decodeURIComponent(path));
      if (!existsSync(target)) broken.push({ file: file.slice(root.length + 1), link: raw, target: target.slice(root.length + 1) });
    }
  }
  return broken;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const broken = findBrokenLinks(root);
  if (broken.length) {
    for (const b of broken) console.error(`BROKEN ${b.file} -> ${b.link} (resolved ${b.target})`);
    console.error(`${broken.length} broken local link(s) in the documentation.`);
    process.exitCode = 1;
  } else {
    console.log('All local documentation links and image paths resolve.');
  }
}