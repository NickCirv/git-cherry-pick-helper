#!/usr/bin/env node
'use strict';

import { execFileSync, spawnSync } from 'child_process';
import * as readline from 'readline';
import { existsSync } from 'fs';

// ── ANSI helpers ──────────────────────────────────────────────────────────────
const A = {
  reset:     '\x1b[0m',
  bold:      '\x1b[1m',
  dim:       '\x1b[2m',
  green:     '\x1b[32m',
  yellow:    '\x1b[33m',
  cyan:      '\x1b[36m',
  red:       '\x1b[31m',
  magenta:   '\x1b[35m',
  blue:      '\x1b[34m',
  white:     '\x1b[37m',
  bgBlue:    '\x1b[44m',
  bgGreen:   '\x1b[42m',
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
  clearLine:  '\x1b[2K\r',
  clearScreen:'\x1b[2J\x1b[H',
};

const c = (color, str) => `${color}${str}${A.reset}`;
const bold = (s) => c(A.bold, s);
const dim = (s) => c(A.dim, s);

// ── Git helpers (all via execFileSync — no shell injection) ──────────────────
function isGitRepo() {
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'pipe' });
    return true;
  } catch { return false; }
}

function getCurrentBranch() {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { stdio: 'pipe' })
      .toString().trim();
  } catch { return 'HEAD'; }
}

function getCommits({ branch = null, search = null, since = null } = {}) {
  const args = ['log', '--format=%H\t%aI\t%an\t%s'];
  if (branch) {
    args.push(branch);
  } else {
    args.push('--all');
  }
  args.push('-n', '200');
  if (since) args.push(`--since=${since}`);
  if (search) args.push(`--grep=${search}`, '-i');

  try {
    const out = execFileSync('git', args, { stdio: 'pipe' }).toString().trim();
    if (!out) return [];
    return out.split('\n').map(line => {
      const [hash, date, author, ...msgParts] = line.split('\t');
      return { hash: hash.trim(), date: date.trim(), author: author.trim(), message: msgParts.join('\t').trim() };
    }).filter(c => c.hash && c.hash.length === 40);
  } catch (err) {
    die(`Failed to fetch commits: ${err.message}`);
  }
}

function getCommitDiff(hash) {
  try {
    return execFileSync('git', ['show', '--stat', '--color=never', hash], { stdio: 'pipe' })
      .toString().split('\n').slice(0, 30).join('\n');
  } catch { return '(unable to load diff)'; }
}

function getStatus() {
  try {
    return execFileSync('git', ['status', '--porcelain'], { stdio: 'pipe' }).toString();
  } catch { return ''; }
}

function hasConflicts() {
  const s = getStatus();
  return s.split('\n').some(l => l.startsWith('UU') || l.startsWith('AA') || l.startsWith('DD'));
}

function isCherryPickInProgress() {
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'pipe' });
    const dir = execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'pipe' }).toString().trim();
    return existsSync(`${dir}/CHERRY_PICK_HEAD`);
  } catch { return false; }
}

function cherryPick(hashes) {
  const result = spawnSync('git', ['cherry-pick', ...hashes], { stdio: 'inherit' });
  return result.status;
}

function die(msg) {
  console.error(c(A.red, `\nError: ${msg}`));
  process.exit(1);
}

// ── Status command ─────────────────────────────────────────────────────────────
function cmdStatus() {
  if (!isGitRepo()) die('Not a git repository.');
  if (!isCherryPickInProgress()) {
    console.log(c(A.yellow, 'No cherry-pick in progress.'));
    return;
  }

  const statusOut = getStatus();
  const conflicted = statusOut.split('\n').filter(l =>
    l.startsWith('UU') || l.startsWith('AA') || l.startsWith('DD')
  );
  const staged = statusOut.split('\n').filter(l => l.match(/^[MADRC]/));

  console.log('\n' + bold(c(A.red, '── Cherry-Pick In Progress ──────────────────')));
  if (conflicted.length) {
    console.log(c(A.red, `\n  ${conflicted.length} conflict(s) to resolve:\n`));
    conflicted.forEach(l => console.log(c(A.red, `    ${l.slice(3)}`)));
    console.log(c(A.yellow, '\n  Resolution steps:'));
    console.log(dim('    1. Open conflicted files and resolve <<<<< ===== >>>>> markers'));
    console.log(dim('    2. Stage resolved files: git add <file>'));
    console.log(dim('    3. Run: gcph continue'));
    console.log(dim('    4. Or abort entirely: gcph abort'));
  } else if (staged.length) {
    console.log(c(A.green, '\n  All conflicts resolved. Staged files:'));
    staged.forEach(l => console.log(c(A.green, `    ${l}`)));
    console.log(c(A.cyan, '\n  Run: gcph continue'));
  } else {
    console.log(c(A.yellow, '\n  Cherry-pick in progress, no conflicts detected.'));
  }
  console.log();
}

// ── Continue command ──────────────────────────────────────────────────────────
function cmdContinue() {
  if (!isGitRepo()) die('Not a git repository.');
  if (!isCherryPickInProgress()) die('No cherry-pick in progress.');
  if (hasConflicts()) die('Unresolved conflicts remain. Fix them and stage with: git add <file>');

  const result = spawnSync('git', ['cherry-pick', '--continue'], { stdio: 'inherit' });
  process.exit(result.status ?? 0);
}

// ── Abort command ─────────────────────────────────────────────────────────────
function cmdAbort() {
  if (!isGitRepo()) die('Not a git repository.');
  if (!isCherryPickInProgress()) {
    console.log(c(A.yellow, 'No cherry-pick in progress to abort.'));
    return;
  }
  const result = spawnSync('git', ['cherry-pick', '--abort'], { stdio: 'inherit' });
  if (result.status === 0) console.log(c(A.green, 'Cherry-pick aborted.'));
  process.exit(result.status ?? 0);
}

// ── Non-interactive pick command ───────────────────────────────────────────────
function cmdPick(hashes) {
  if (!isGitRepo()) die('Not a git repository.');
  if (!hashes.length) die('Provide at least one commit hash: gcph pick <hash>');

  // Validate hashes look like git SHAs
  for (const h of hashes) {
    if (!/^[0-9a-f]{4,40}$/i.test(h)) die(`Invalid commit hash: ${h}`);
  }

  console.log(c(A.cyan, `\nCherry-picking ${hashes.length} commit(s)...\n`));
  const code = cherryPick(hashes);

  if (code === 0) {
    console.log(c(A.green, '\n✓ Cherry-pick successful.'));
  } else if (hasConflicts()) {
    console.log(c(A.red, '\n✗ Conflicts detected. Run: gcph status'));
  } else {
    console.log(c(A.red, `\n✗ Cherry-pick failed (exit ${code}).`));
  }
  process.exit(code);
}

// ── Help ──────────────────────────────────────────────────────────────────────
function showHelp() {
  console.log(`
${bold(c(A.cyan, 'git-cherry-pick-helper (gcph)'))} — Interactive cherry-pick TUI

${bold('Usage:')}
  gcph                         Browse all branches, select commits to cherry-pick
  gcph <branch>                Browse commits from a specific branch
  gcph --search "fix"          Filter commits by message
  gcph --since "1 week ago"    Limit to recent commits
  gcph pick <hash> [hash2...]  Non-interactive cherry-pick
  gcph status                  Show conflict status and resolution guide
  gcph continue                Continue after resolving conflicts
  gcph abort                   Abort current cherry-pick

${bold('TUI Controls:')}
  ↑ / ↓ or j / k    Navigate commits
  Space              Select / deselect commit
  Enter              Cherry-pick selected commits
  p                  Toggle preview pane (shows diff)
  q / Escape         Quit

${bold('Examples:')}
  gcph                         # browse all branches
  gcph main                    # browse main branch only
  gcph --search "hotfix"       # filter by keyword
  gcph --since "2 days ago"    # last 2 days
  gcph pick abc123 def456      # pick two commits directly
`);
}

// ── TUI ───────────────────────────────────────────────────────────────────────
const PREVIEW_WIDTH = 55;
const LIST_WIDTH = 75;

function formatDate(iso) {
  try {
    const d = new Date(iso);
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const dy = String(d.getDate()).padStart(2, '0');
    const hr = String(d.getHours()).padStart(2, '0');
    const mn = String(d.getMinutes()).padStart(2, '0');
    return `${dy}/${mo} ${hr}:${mn}`;
  } catch { return iso.slice(0, 10); }
}

function truncate(str, len) {
  if (str.length <= len) return str.padEnd(len);
  return str.slice(0, len - 1) + '…';
}

function renderTUI(state) {
  const { commits, cursor, selected, showPreview, message } = state;
  const termRows = process.stdout.rows || 30;
  const termCols = process.stdout.columns || 120;
  const listW = showPreview ? Math.min(LIST_WIDTH, termCols - PREVIEW_WIDTH - 3) : termCols - 2;
  const visibleRows = termRows - 7; // header + footer
  const scrollOffset = Math.max(0, cursor - Math.floor(visibleRows / 2));
  const visibleCommits = commits.slice(scrollOffset, scrollOffset + visibleRows);

  let out = A.clearScreen;
  out += A.hideCursor;

  // Header
  const currentBranch = getCurrentBranch();
  out += c(A.bgBlue, bold(` git-cherry-pick-helper `));
  out += c(A.dim, ` branch: ${c(A.cyan, currentBranch)}`);
  out += c(A.dim, `  commits: ${commits.length}`);
  if (selected.size > 0) out += c(A.yellow, `  selected: ${selected.size}`);
  out += '\n';
  out += c(A.dim, '─'.repeat(Math.min(termCols, 132))) + '\n';

  // Column headers
  const hashW = 9, dateW = 12, authorW = 14;
  const msgW = listW - hashW - dateW - authorW - 7;
  out += c(A.bold, ` ${'  '}${truncate('HASH', hashW)} ${truncate('DATE', dateW)} ${truncate('AUTHOR', authorW)} ${'MESSAGE'.padEnd(msgW)}`);
  if (showPreview) out += c(A.bold, `  PREVIEW`);
  out += '\n' + c(A.dim, '─'.repeat(Math.min(termCols, 132))) + '\n';

  // Commit rows + optional preview column
  const previewLines = showPreview && commits[cursor]
    ? getCommitDiff(commits[cursor].hash).split('\n')
    : [];

  visibleCommits.forEach((commit, i) => {
    const absIdx = scrollOffset + i;
    const isCursor = absIdx === cursor;
    const isSel = selected.has(commit.hash);
    const selMark = isSel ? c(A.green, '●') : ' ';
    const curMark = isCursor ? c(A.yellow, '▶') : ' ';

    const hash = c(isSel ? A.green : A.dim, truncate(commit.hash.slice(0, 8), hashW));
    const date = c(A.dim, truncate(formatDate(commit.date), dateW));
    const author = c(A.magenta, truncate(commit.author, authorW));
    const msg = isCursor
      ? c(A.white, truncate(commit.message, msgW))
      : truncate(commit.message, msgW);

    let row = isCursor
      ? `${A.bold}${curMark}${selMark}${hash} ${date} ${author} ${msg}${A.reset}`
      : `${curMark}${selMark}${hash} ${date} ${author} ${msg}`;

    if (showPreview) {
      const pLine = (previewLines[i] || '').slice(0, PREVIEW_WIDTH - 2);
      row += `  ${c(A.dim, pLine)}`;
    }

    out += row + '\n';
  });

  // Fill empty rows
  for (let i = visibleCommits.length; i < visibleRows; i++) out += '\n';

  // Footer
  out += c(A.dim, '─'.repeat(Math.min(termCols, 132))) + '\n';
  if (message) {
    out += `${c(A.yellow, message)}\n`;
  } else {
    out += dim('↑↓/jk navigate  Space select  Enter cherry-pick  p preview  q quit') + '\n';
  }

  process.stdout.write(out);
}

async function runTUI(opts) {
  const { branch, search, since } = opts;

  if (!isGitRepo()) die('Not a git repository.');

  const commits = getCommits({ branch, search, since });
  if (!commits.length) {
    console.log(c(A.yellow, 'No commits found matching your criteria.'));
    return;
  }

  const state = {
    commits,
    cursor: 0,
    selected: new Set(),
    showPreview: false,
    message: '',
  };

  // Enter raw mode
  const { stdin } = process;
  if (!stdin.isTTY) die('TTY required for interactive mode. Use: gcph pick <hash>');

  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  process.stdout.write(A.hideCursor);
  renderTUI(state);

  const cleanup = () => {
    process.stdout.write(A.showCursor);
    try { stdin.setRawMode(false); } catch {}
    stdin.pause();
  };

  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('exit', cleanup);

  for await (const key of stdin) {
    state.message = '';

    // Arrow keys / escape sequences
    if (key === '\x1b[A' || key === 'k') {        // up
      state.cursor = Math.max(0, state.cursor - 1);
    } else if (key === '\x1b[B' || key === 'j') { // down
      state.cursor = Math.min(commits.length - 1, state.cursor + 1);
    } else if (key === ' ') {                       // select/deselect
      const h = commits[state.cursor].hash;
      if (state.selected.has(h)) state.selected.delete(h);
      else state.selected.add(h);
    } else if (key === 'p') {                       // preview toggle
      state.showPreview = !state.showPreview;
    } else if (key === '\r' || key === '\n') {      // cherry-pick
      const hashes = [...state.selected];
      if (!hashes.length) {
        state.message = 'No commits selected. Press Space to select commits.';
        renderTUI(state);
        continue;
      }
      cleanup();
      process.stdout.write(A.clearScreen);
      console.log(c(A.cyan, `\nCherry-picking ${hashes.length} commit(s)...\n`));
      const code = cherryPick(hashes);
      if (code === 0) {
        console.log(c(A.green, '\n✓ Cherry-pick successful.'));
      } else if (hasConflicts()) {
        console.log(c(A.red, '\n✗ Conflicts detected.'));
        console.log(dim('  Run: gcph status    — to see conflicted files'));
        console.log(dim('  Run: gcph continue  — after resolving conflicts'));
        console.log(dim('  Run: gcph abort     — to cancel'));
      } else {
        console.log(c(A.red, `\n✗ Cherry-pick failed (exit ${code}).`));
      }
      process.exit(code);
    } else if (key === 'q' || key === '\x1b') {    // quit
      cleanup();
      process.stdout.write(A.clearScreen);
      console.log(dim('Bye.'));
      process.exit(0);
    }

    renderTUI(state);
  }
}

// ── Argument parsing ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);

function parseArgs(args) {
  const opts = { branch: null, search: null, since: null, hashes: [] };
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === '--search' || a === '-s') {
      opts.search = args[++i];
    } else if (a === '--since') {
      opts.since = args[++i];
    } else if (!a.startsWith('-') && !opts.branch && opts.hashes.length === 0) {
      opts.branch = a;
    } else if (!a.startsWith('-')) {
      opts.hashes.push(a);
    }
    i++;
  }
  return opts;
}

// ── Entry point ───────────────────────────────────────────────────────────────
const cmd = args[0];

if (!args.length || (args.length && !['pick','status','continue','abort','--help','-h'].includes(cmd) && !cmd.startsWith('-'))) {
  // Could be: gcph, gcph <branch>, gcph --search X, gcph --since X
  if (cmd === '--help' || cmd === '-h') {
    showHelp();
    process.exit(0);
  }
  const opts = parseArgs(args);
  await runTUI(opts);
} else if (cmd === '--help' || cmd === '-h') {
  showHelp();
  process.exit(0);
} else if (cmd === 'status') {
  cmdStatus();
} else if (cmd === 'continue') {
  cmdContinue();
} else if (cmd === 'abort') {
  cmdAbort();
} else if (cmd === 'pick') {
  const hashes = args.slice(1);
  cmdPick(hashes);
} else {
  // If first arg starts with -- it's a flag mode
  const opts = parseArgs(args);
  await runTUI(opts);
}
