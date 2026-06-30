# Ribix IDE — Fork Upstream-Rebase Runbook

**Purpose:** A concrete, repeatable procedure for rebasing the Ribix IDE fork onto a newer Code-OSS (VS Code OSS) release. Follow it top to bottom; the conflict and verification sections tell you *where* the fork diverges from upstream so you are not guessing.

**Audience:** A new engineer landing their first upstream bump.

**Base today:** Code-OSS `1.99.3` (see `absolute-docs/Build_Guide.md`).

---

## 0. Before you start

- The fork's Ribix code lives almost entirely under `src/vs/workbench/contrib/ribix/` plus a handful of **registration seams** in upstream files (listed in §3). Conflicts cluster at those seams — the contrib directory itself rarely conflicts because upstream does not touch it.
- This is a **rebase**, not a merge: we replay Ribix commits on top of the new upstream tag so history stays linear and the diff against upstream stays reviewable.
- Budget roughly **half a day** for a single minor bump: most of the time is conflict resolution at the seams and the regression pass, not the build (the build itself is ~8–10 min, see §6).

### Node version pin

The fork pins Node to the version in `.nvmrc` (currently **`20.18.2`**). Use it exactly — a different major (or even a newer minor with a different V8/`node-gyp` behavior) can break native-module compilation and the `gulp` build.

```bash
nvm install         # installs the version from .nvmrc
nvm use             # 20.18.2
node -v             # confirm: v20.18.2
```

If the upstream bump itself changes the required Node version, upstream's `.nvmrc`/`remote/.nvmrc`/`build/.nvmrc` will conflict in §4 — take **upstream's** Node pin (it matches the new Electron/`node-gyp` expectations), then update any Ribix doc that quotes the old version.

---

## 1. Pin the upstream tag

Add the upstream Code-OSS remote once, then fetch the exact tag you are moving to. **Always pin a tag**, never `main` — rebasing onto a moving branch makes the conflict set non-reproducible.

```bash
# one-time
git remote add upstream https://github.com/microsoft/vscode.git

# fetch tags only (fast; avoids pulling all of upstream's branch history)
git fetch upstream --tags

# pick the concrete release you are moving to, e.g. 1.100.0
export UPSTREAM_TAG=1.100.0
git rev-parse "$UPSTREAM_TAG^{commit}"   # confirm the tag resolves
```

Record `$UPSTREAM_TAG` in the PR description so the bump is reproducible.

---

## 2. Branch and start the rebase

```bash
git checkout -b rebase/oss-$UPSTREAM_TAG
git rebase --onto "$UPSTREAM_TAG" <current-oss-base> rebase/oss-$UPSTREAM_TAG
```

`<current-oss-base>` is the upstream commit the fork currently sits on (the previous tag, e.g. `1.99.3`). If you do not know it, find the last commit authored by `microsoft/vscode` before the Ribix history begins:

```bash
git log --oneline --first-parent | tail -n 30   # locate the upstream/Ribix boundary
```

Rebase will stop on the first conflicting commit. Resolve, `git add -A`, `git rebase --continue`, repeat. To bail out at any point: `git rebase --abort`.

---

## 3. Expect conflicts at the registration seams

Ribix wires itself into upstream at a small, known set of files. **These are where ~90% of conflicts land.** When a conflict appears here, the resolution is almost always "keep upstream's surrounding code, re-apply the Ribix insertion" — not a logic merge.

| Seam | File | What Ribix added / why it conflicts |
| --- | --- | --- |
| Contribution registration | `src/vs/workbench/contrib/ribix/browser/ribix.contribution.ts` | The master list of `import './…'` side-effect registrations for every Ribix service, pane, action, and the diff-annotation widget. Conflicts when upstream reshuffles contribution-registration patterns. Keep all Ribix imports; re-order to match any new upstream convention. |
| Main-process channel registration | `src/vs/code/electron-main/app.ts` | Ribix registers IPC channels (`ribix-channel-metrics`, `ribix-channel-update`, `ribix-channel-llmMessage`, `ribix-channel-scm`, `ribix-channel-mcp`, `ribix-channel-ribixAuth`, `ribix-channel-ribixBrowser`) and the `import { RibixBrowserChannel }` near the top. Upstream edits `app.ts` frequently, so the `registerChannel(...)` block and the import will conflict. Re-apply **every** `ribix-channel-*` registration after upstream's own channels. |
| Settings pane | `src/vs/workbench/contrib/ribix/browser/ribixSettingsPane.ts` | Ribix's settings UI. Conflicts when upstream changes the settings/editor-pane base classes or registration APIs it extends. Re-target to the new base API; keep the Ribix settings schema intact. |

Secondary seams that occasionally conflict:

- `product.json` — Ribix branding, `updateUrl`, extension gallery overrides. Take Ribix values; merge in any new upstream keys.
- `src/vs/workbench/workbench.common.main.ts` / `workbench.desktop.main.ts` — if upstream moves where contributions are imported.
- `.nvmrc` / `build/.nvmrc` — Node pin (see §0).
- `package.json` / `package-lock.json` — dependency and `scripts` drift. Prefer upstream's lockfile, then re-add Ribix-only deps (e.g. `playwright`, used by the browser channel).

**Conflict-resolution rule of thumb:** if the conflict is in a file under `src/vs/workbench/contrib/ribix/`, the Ribix side is authoritative. If it is in an upstream file, keep upstream's structure and surgically re-insert the Ribix lines.

---

## 4. Reinstall dependencies

After the rebase completes, the dependency tree may have moved (Electron, TypeScript, `node-gyp` targets).

```bash
nvm use                # 20.18.2 (or upstream's new pin if it changed)
npm install            # rebuilds native modules against the new Electron/Node ABI
```

If native modules fail to build, you are almost certainly on the wrong Node version or missing the platform toolchain (Windows: Visual Studio Build Tools w/ "Desktop development with C++"; macOS: Xcode CLT; Linux: build-essential + python3). See `Build_Guide.md` → Troubleshooting.

---

## 5. Rebuild the React layer

The Ribix command-center UI (mission detail, diff-annotation surfacing, etc.) is a separate React bundle that is **not** built by `gulp`. Rebuild it explicitly:

```bash
npm run buildreact
```

This runs `src/vs/workbench/contrib/ribix/browser/react/build.js`. If React-layer components fail to compile after the bump, it is usually a `react` / `@types/react` version change in the upstream dependency tree — pin them back to the versions the Ribix React layer expects.

---

## 6. Compile (gulp) and watch

```bash
npm run compile        # === npm run typecheck === gulp compile
```

- **Expect ~8–10 minutes** for a clean `gulp compile` on the pinned Node version. This is the long pole of the loop; do not assume it hung before ~12 min.
- For iterative work during conflict resolution, use the watch build instead of full compiles:

  ```bash
  npm run watch-client   # incremental; first pass is slow, then fast
  ```

A clean `compile` is the gate: it is the full TypeScript typecheck across the workspace. If it passes, the seams are wired correctly.

---

## 7. Regression checklist

`compile` passing only proves it builds. Launch the rebuilt IDE and walk these Ribix-critical flows — each one exercises a different seam, so a broken seam shows up here even when compilation succeeded:

- [ ] **Mission run** — create a mission, submit for planning, approve the plan, watch agents execute to completion. Confirms the contribution registrations (§3, `ribix.contribution.ts`) and the orchestration/agent services are wired.
- [ ] **Auto-trigger** — edit and save a watched file; confirm the auto-on-change watcher spawns a mission/run and findings appear in the Problems panel (G-AUTOTRIGGER path).
- [ ] **OAuth / sign-in** — sign in via the Ribix auth flow; confirm the token round-trips. Exercises the `ribix-channel-ribixAuth` channel registration in `app.ts`.
- [ ] **Autocomplete** — type in an editor; confirm inline Ribix completions appear.
- [ ] **Cmd+K (quick edit)** — invoke quick edit on a selection; confirm the inline edit applies. Exercises the keybinding/action registrations.
- [ ] **Settings pane** — open Ribix settings; confirm the pane renders and a setting round-trips. Confirms the `ribixSettingsPane.ts` seam.
- [ ] **Browser/UX-vision (if a UI-touching change is in flight)** — run a QA mission on a UI change; confirm UX-vision notes render in mission detail and that browser-tool failure degrades to text-only. Exercises the `ribix-channel-ribixBrowser` channel + diff-annotation widget.

If a flow is dead, map it back to its seam in §3 and re-check that conflict's resolution — the build can pass while a re-inserted registration is subtly wrong (e.g. dropped from the `registerChannel` block).

---

## 8. Land it

```bash
# from the rebased branch
git push --force-with-lease origin rebase/oss-$UPSTREAM_TAG
```

Open a PR. Include in the description:

- The pinned upstream tag (`$UPSTREAM_TAG`) and the previous base tag.
- The Node pin used (and whether it changed).
- Which seams conflicted and how each was resolved.
- Confirmation that `npm run buildreact` + `npm run compile` are green and the §7 checklist passed.

Force-push uses `--force-with-lease` so a stale local branch cannot clobber a teammate's update.

---

## References

- **Build / packaging:** `absolute-docs/Build_Guide.md`
- **Contribution seam:** `src/vs/workbench/contrib/ribix/browser/ribix.contribution.ts`
- **Channel-registration seam:** `src/vs/code/electron-main/app.ts`
- **Settings-pane seam:** `src/vs/workbench/contrib/ribix/browser/ribixSettingsPane.ts`
- **Node pin:** `.nvmrc`
- **Upstream:** https://github.com/microsoft/vscode (tags = releases)
