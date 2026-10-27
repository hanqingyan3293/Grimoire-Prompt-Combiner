# Grimoire repository rules

Before changing code, read the current .agent/AGENTS.md, .agent/SPEC.md, .agent/STATE.md, .agent/PLAN.md, .agent/GATES.md, and the relevant rows in .agent/MIGRATION_MATRIX.md.

`.agent/STATE.md` is the only authoritative record of what is true right now; `.agent/history/` holds superseded ledgers and must not be quoted as current status.

The project is a source-level migration and integration effort. Existing mature implementations must be migrated, vendored, wrapped, or adapted before reimplementation is considered. A similar-looking replacement is not completion.

The current working tree is user-owned. Do not reset, checkout, overwrite, or discard existing changes. Do not push GitHub. Do not create a completion commit before the final gates pass.
