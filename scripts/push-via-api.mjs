/**
 * Push local tree to GitHub via api.github.com (when git://github.com is blocked).
 * Usage:
 *   node scripts/push-via-api.mjs main
 *   node scripts/push-via-api.mjs pages
 */
import { execSync } from 'child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';

const owner = process.env.GITHUB_OWNER || 'z1994838315g';
const repo = process.env.GITHUB_REPO || 'genius-trader';
const mode = process.argv[2] || 'main';

function getToken() {
  if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) {
    return process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  }
  const out = execSync('git credential fill', {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
  });
  const m = out.match(/^password=(.+)$/m);
  if (!m) throw new Error('No GitHub password/token from credential helper');
  return m[1].trim();
}

const token = getToken();

async function api(method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'genius-trader-deploy',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  }
  return json;
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist' || name === 'dist-web') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

function listMainFiles() {
  const listed = execSync('git ls-files -z', { encoding: 'buffer' })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  return listed.map((f) => join(process.cwd(), f));
}

async function createBlob(contentBase64) {
  return api('POST', `/repos/${owner}/${repo}/git/blobs`, {
    content: contentBase64,
    encoding: 'base64',
  });
}

async function pushTree(files, rootDir, branch, message, force = false) {
  const treeItems = [];
  for (const abs of files) {
    const path = relative(rootDir, abs).split('\\').join('/');
    if (!path || path.startsWith('..')) continue;
    const buf = readFileSync(abs);
    const blob = await createBlob(buf.toString('base64'));
    treeItems.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
    console.log('blob', path);
  }
  const tree = await api('POST', `/repos/${owner}/${repo}/git/trees`, { tree: treeItems });
  console.log('tree', tree.sha);

  let parents = [];
  try {
    const ref = await api('GET', `/repos/${owner}/${repo}/git/ref/heads/${branch}`);
    parents = [ref.object.sha];
  } catch {
    /* new branch */
  }

  const commit = await api('POST', `/repos/${owner}/${repo}/git/commits`, {
    message,
    tree: tree.sha,
    parents,
  });
  console.log('commit', commit.sha);

  try {
    await api('PATCH', `/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      sha: commit.sha,
      force,
    });
  } catch {
    await api('POST', `/repos/${owner}/${repo}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha: commit.sha,
    });
  }
  console.log('updated', branch, commit.html_url || commit.sha);
  return commit;
}

if (mode === 'pages') {
  const root = join(process.cwd(), 'dist-web');
  if (!existsSync(root)) throw new Error('dist-web missing; run npm run build:web first');
  const files = walk(root);
  await pushTree(files, root, 'gh-pages', 'deploy: GitHub Pages web build', true);
} else {
  const files = listMainFiles();
  await pushTree(files, process.cwd(), 'main', 'Improve watch UI: full-day charts, brief modal, fund NAV, and money intent.', false);
}
