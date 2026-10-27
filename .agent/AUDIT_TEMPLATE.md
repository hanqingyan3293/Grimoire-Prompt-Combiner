# Migration completeness audit template

## Source project

- Project:
- Snapshot/path:
- Version/commit:
- License evidence:

## Capability checklist

| Capability | Source file/symbol | Grimoire file/symbol | Migration status | Behavior parity | Evidence | Gap/action |
|---|---|---|---|---|---|---|
| | | | | | | |

## Anti-shortcut checks

- [ ] Source implementation was opened, not only README.
- [ ] Source UI structure was compared.
- [ ] Loading, empty, error, streaming, retry, and cancellation states were checked.
- [ ] Keyboard, context menu, drag/drop, and resize behavior were checked.
- [ ] Persistence and recovery behavior were checked.
- [ ] UI behavior uses application contracts and does not branch on a concrete runtime.
- [ ] Agent behavior enters through AgentRuntime; composed kernel/policy/provider choices are documented.
- [ ] Agent-facing capability calls enter through Tool Registry and Permission Policy.
- [ ] Workspace infrastructure is behind the Workspace adapter and does not own Grimoire business state.
- [ ] Domain services are callable from both panels and tools without direct vendor-storage access.
- [ ] No simplification was justified only by time or complexity.
- [ ] Any reimplementation has complete proof and explicit approval.

## Gate result

- Automated:
- Functional:
- Migration audit:
- Final status:
