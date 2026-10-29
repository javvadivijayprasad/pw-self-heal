# Good first issues — drafts

Drafts kept in the repo (per the contributor-growth playbook, Phase 4). Each file
here is a ready-to-open issue: the first `#` line is the title, the rest is the
body. Open them on GitHub once reviewed.

Every draft is scoped so a newcomer can finish it without understanding the whole
codebase: it names the files to touch, the exact change, and the acceptance
criteria (including "add a test" — this repo's rule is every change ships tested).

## Labels to create first

On GitHub → Issues → Labels (or `gh label create`):

| Label | Color | Purpose |
|---|---|---|
| `good first issue` | `#7057ff` | newcomer-friendly (GitHub surfaces these specially) |
| `help wanted` | `#008672` | open for contribution |
| `documentation` | `#0075ca` | docs-only |
| `enhancement` | `#a2eeef` | feature/code |
| `test` | `#bfd4f2` | test coverage |

## The drafts

| # | Title | Kind |
|---|---|---|
| 01 | Auto-detect more test-id attributes (`data-qa-id`, `data-automation-id`) | enhancement |
| 02 | Reach 100% branch coverage in `features.ts` (handle/remove the unreachable branch) | test |
| 03 | Add a "Troubleshooting" section to the README | documentation |
| 04 | Add `--json` output to the `pw-self-heal report` CLI | enhancement |
| 05 | Recognize one more context-restart error in `isStaleError` | enhancement |
| 06 | Add an `npm run verify` script and document it in CONTRIBUTING | enhancement |

## Opening them (after review)

With the GitHub CLI (`gh`), from the repo root:

```powershell
# create labels once (ignore "already exists")
gh label create "good first issue" --color 7057ff --description "Good for newcomers"
gh label create "help wanted" --color 008672

# open each issue from its draft (title = first line, body = rest)
Get-ChildItem docs/good-first-issues/0*.md | ForEach-Object {
  $lines = Get-Content $_.FullName -Encoding UTF8
  $title = ($lines[0] -replace '^#\s*', '')
  $body  = ($lines[1..($lines.Count-1)] -join "`n")
  gh issue create --title $title --body $body --label "good first issue" --label "help wanted"
}
```

Review each draft, adjust labels per the table above, then open. Don't open all
at once if you can't respond to them — a handful of well-tended issues beats a
wall of ignored ones.
