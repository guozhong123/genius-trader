import { execSync } from 'child_process';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const owner = 'guozhong123';
const repo = 'genius-trader';
const branch = 'gh-pages';
const root = 'dist-web';

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

function ghJson(args, input) {
  const out = execSync(`gh ${args}`, {
    input,
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return JSON.parse(out);
}

const files = walk(root);
const treeItems = [];
for (const abs of files) {
  const path = relative(root, abs).split('\\').join('/');
  const blob = ghJson(
    `api --method POST repos/${owner}/${repo}/git/blobs --input -`,
    JSON.stringify({
      content: readFileSync(abs).toString('base64'),
      encoding: 'base64',
    }),
  );
  treeItems.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
  console.log('blob', path);
}

const tree = ghJson(
  `api --method POST repos/${owner}/${repo}/git/trees --input -`,
  JSON.stringify({ tree: treeItems }),
);
console.log('tree', tree.sha);

let parents = [];
try {
  const ref = ghJson(`api repos/${owner}/${repo}/git/ref/heads/${branch}`);
  parents = [ref.object.sha];
} catch {
  /* new branch */
}

const commit = ghJson(
  `api --method POST repos/${owner}/${repo}/git/commits --input -`,
  JSON.stringify({
    message: 'deploy: GitHub Pages web build',
    tree: tree.sha,
    parents,
  }),
);
console.log('commit', commit.sha);

try {
  ghJson(
    `api --method PATCH repos/${owner}/${repo}/git/refs/heads/${branch} --input -`,
    JSON.stringify({ sha: commit.sha, force: true }),
  );
} catch {
  ghJson(
    `api --method POST repos/${owner}/${repo}/git/refs --input -`,
    JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
  );
}
console.log('branch updated', branch);
