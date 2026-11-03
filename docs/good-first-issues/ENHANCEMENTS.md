# 10 enhancement good-first-issues

Ten newcomer-friendly **enhancement** issues, each scoped with files, task, and
acceptance criteria (every change ships a test — the repo rule). Drafts are the
`enh-*.md` files in this folder.

| # | Title | Area |
|---|---|---|
| enh-01 | `--top <n>` flag for `report` | CLI |
| enh-02 | `--out <file>` for `report --json` | CLI |
| enh-03 | `data-pw` / `data-e2e` test-id auto-detect | extractor |
| enh-04 | more context-restart patterns in `isStaleError` | errors |
| enh-05 | `npm run verify` script | tooling |
| enh-06 | `onHeal` callback option | API |
| enh-07 | `clearHealCache()` on the wrapped page | API |
| enh-08 | more `PREFERRED_TAGS` (`option`/`summary`/`td`/`th`) | extractor |
| enh-09 | `--since` / `--test` filters for `report` | CLI |
| enh-10 | per-mode `thresholds` config | API |

## Open them all (labelled `good first issue` + `help wanted` + `enhancement`)

Create the labels once (ignore "already exists"), then open the ten:

```powershell
cd E:\EB1A_Research\Application\PlaywrightExtentions\pw-self-heal
gh label create "good first issue" --color 7057ff --force
gh label create "help wanted"      --color 008672 --force
gh label create "enhancement"      --color a2eeef --force

Get-ChildItem docs/good-first-issues/enh-*.md | ForEach-Object {
  $lines = Get-Content $_.FullName -Encoding UTF8
  $title = ($lines[0] -replace '^#\s*','')
  $body  = ($lines[2..($lines.Count-1)] -join "`n")
  gh issue create --title $title --body $body `
    --label "good first issue" --label "help wanted" --label "enhancement"
}
```

That opens 10 enhancement issues. With the existing open issue #2, you'll have 11
open — comfortably over the 10 that goodfirstissue.dev wants. (Issue #3 is
labelled `test`; relabel it `enhancement` with `gh issue edit 3 --add-label enhancement`
if you want *every* open issue to be an enhancement.)
