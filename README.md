<div align="center">

# git-cherry-pick-helper

**Browse commits across branches in a terminal TUI and cherry-pick them with conflict guidance**

[![License: MIT](https://img.shields.io/badge/license-MIT-green?labelColor=0B0A09)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?labelColor=0B0A09)](package.json)
[![Node](https://img.shields.io/badge/node-%3E%3D18-blue?labelColor=0B0A09)](package.json)

</div>

## Install

```bash
npx github:NickCirv/git-cherry-pick-helper
```

Or install globally:

```bash
npm install -g github:NickCirv/git-cherry-pick-helper
```

## Usage

```bash
gcph                          # browse all branches interactively
gcph <branch>                 # browse a specific branch
gcph --search "hotfix"        # filter commits by message
gcph --since "3 days ago"     # limit to recent commits
gcph pick abc1234 def5678     # non-interactive: cherry-pick by hash
gcph status                   # show conflict status + resolution steps
gcph continue                 # continue after resolving conflicts
gcph abort                    # abort the current cherry-pick
```

| Key | Action |
|-----|--------|
| `↑` / `↓` or `j` / `k` | Navigate commits |
| `Space` | Select / deselect commit |
| `Enter` | Cherry-pick selected commits |
| `p` | Toggle diff preview pane |
| `q` / `Escape` | Quit |

## What it does

Launches a scrollable terminal TUI showing up to 200 commits across all branches (or a filtered subset). Select one or more commits with `Space`, then press `Enter` to cherry-pick them. When conflicts occur, `gcph status` prints the conflicted files and an exact resolution workflow; `gcph continue` and `gcph abort` wrap the underlying git commands. All git calls use `execFileSync` with explicit argument arrays — no shell injection possible.

---

<sub>Zero dependencies · Node 18+ · MIT · by <a href="https://github.com/NickCirv">NickCirv</a></sub>
