# Grimoire migration implementation procedure

## Before each change

1. Read .agent/AGENTS.md, .agent/STATE.md, .agent/GATES.md, and the relevant matrix rows.
2. Locate the source implementation and its actual license.
3. Choose the highest available migration method.
4. Check the affected application contract and forbidden dependency directions in .agent/SPEC.md.
5. Record the decision in .agent/DECISIONS.md before coding.
6. Protect existing user changes and business data.

## During implementation

- Preserve source file structure inside src/vendor/project when vendoring.
- Put Grimoire-specific code in src/integrations/project.
- Keep renderer code on application contracts; do not add concrete-runtime branches to UI components.
- Route agent-facing Prompt, Tag, Image, Canvas, File, Search, MCP, WD14, and Workspace operations through Tool Registry and Permission Policy.
- Keep Dockview or another docking library behind the Workspace adapter; panel semantics and persistence stay in Grimoire.
- Keep Prompt, Tag, Image, WD14, Canvas, and asset business rules in services that can be called by both panels and tools.
- Keep secrets in the main process.
- Do not bypass Tool Registry or Permission Policy.
- Do not delete old data or old compatibility readers.
- Do not use TODO or FIXME for core behavior.
- If migration fails, stop that row and record the blocker; do not silently downgrade it.

## After each milestone

Run, in order:

~~~text
npx tsc --noEmit -p tsconfig.json        # G1
npx tsc -p tsconfig.node.json --noEmit   # G2
npx vitest run                           # G3 (3 consecutive runs)
cd src/vendor/cherry/compat && npx vitest run   # G4
npm run typecheck:cherry-compat          # G5 (owned=0, source ratchet)
npm run build                            # G6
npm run check:migration-matrix           # G7
npm run check:cherry-css                 # G8
mock provider/MCP smoke tests
Electron/manual smoke flow
migration completeness audit
~~~

Update STATE.md (measured numbers + any new defect) and MIGRATION_MATRIX.md (row status). Do not enter the next phase while a gate is failing. Gate definitions live in GATES.md; they are not negotiable case by case.

## Completion behavior

Do not create a completion commit until the final gate passes. Local recovery archives are allowed; GitHub push and remote release creation are not.
