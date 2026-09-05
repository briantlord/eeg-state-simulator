# Publication privacy

The simulator generates synthetic signals locally. Raw reference recordings and local outputs
are excluded from Git. Public evidence consists of numerical summaries from declared public
datasets. Author attribution and the public repository account remain intentional.

Use your GitHub-provided noreply address for commits to this repository. In a new clone, enable
the publication hooks with `git config core.hooksPath .githooks`. The pre-commit hook checks the
index and commit email; the pre-push hook checks reachable history. CI repeats the history check.
GitHub secret scanning and push protection are enabled separately in repository settings.

`npm run privacy:check` checks tracked working files. `npm run privacy:history` checks reachable
Git objects and author/committer emails. These guards report locations and categories, without
printing matched values. They cover personal home-directory paths, private-key material, common
credential prefixes, credential filenames, and commit identities. They are a supplement to
GitHub's credential detection, not a guarantee that arbitrary encoded secrets will be found.

Keep machine paths relative to the repository, and resolve executables through PATH. Local
credential files are ignored; `.env.example` and `.env.template` are permitted only with safe
placeholders. Browser reports explicitly disable Git identity/diff capture and have a short CI
retention period. Do not distribute a ZIP of the entire development workspace: ignored caches,
logs, worktrees, and raw recording headers have different privacy boundaries from the static app.

The privacy cleanup rewrites published history. Re-clone older copies instead of merging their
old history into the cleaned branch. Changing Git identity does not retroactively remove older
copies, forks, or GitHub cached commit views. GitHub Support controls server-side cache removal.
Cloud-sync sharing and exclusion settings are managed separately from Git ignore rules.
