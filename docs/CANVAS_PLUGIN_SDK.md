# Grimoire Canvas Static Plugin SDK

## Scope

The canvas plugin system is a compile-time extension contract for built-in Grimoire nodes. It is not a remote plugin loader. A plugin is a plain manifest imported by the application build and registered through `registerCanvasPlugin`.

Current API version: `1`.

## Security model

- Only manifests with `builtin: true` are accepted.
- Capabilities must come from the fixed `CanvasPluginCapability` union.
- Every node capability must also be declared by its parent plugin.
- Node configuration is sanitized by `validateCanvasDocument`.
- The manifest contains data only. It cannot carry functions, URLs, scripts, file paths, network handlers, or executable source.
- Remote loading, dynamic URL imports, `eval`, `new Function`, arbitrary file access, and arbitrary network access are forbidden.

## Manifest

```ts
const plugin: CanvasPluginManifest = {
  apiVersion: 1,
  id: 'grimoire.example',
  name: 'Example built-in nodes',
  version: '1.0.0',
  builtin: true,
  capabilities: ['prompt.apply'],
  nodes: [{
    kind: 'prompt',
    title: 'Prompt',
    description: 'Editable prompt text',
    defaultSize: { width: 320, height: 210 },
    minimapColor: '#a855f7',
    creatable: true,
    capabilities: ['prompt.apply'],
    ports: [
      { id: 'tags', label: 'Tags', direction: 'input', dataType: 'tags' },
      { id: 'prompt', label: 'Prompt', direction: 'output', dataType: 'prompt' },
    ],
  }],
}
```

Plugin IDs and port IDs use lowercase ASCII letters, numbers, dots, and hyphens. Node kinds are a closed TypeScript union and must be added to the shared canvas types before a new built-in node can be registered.

## Capabilities

The current capability allowlist is defined in `src/shared/canvas-plugin.ts`. A capability describes a narrow host action. It does not grant direct access to Electron, Node.js, the network, or the file system. Renderer actions must still use an existing validated Preload API.

Before adding a capability:

1. Define its exact data contract and failure behavior.
2. Add runtime validation in the owning IPC handler.
3. Add it to the shared allowlist.
4. Declare it in the plugin and node manifest.
5. Check it again immediately before the host action.
6. Add success, denial, malformed-input, and retry tests.

## Ports and connections

Ports have a direction and one fixed data type: `prompt`, `image`, or `tags`. Typed connections require compatible output and input types. Connection creation and reconnection reject self-links, duplicates, incompatible ports, ambiguous port choices, and directed cycles.

Connections transfer data only after the user selects a connection and chooses **Sync connection**. Synchronization never executes a downstream WD14 or ComfyUI node and never recursively continues through the graph. This explicit rule prevents accidental task storms and infinite execution chains.

Legacy version 1 connections without ports remain readable and removable. They are visual-only and cannot synchronize data.

## Adding a built-in node

1. Extend `CanvasNodeKind` and, if needed, the closed configuration schema.
2. Add a manifest contribution with minimal capabilities and typed ports.
3. Add document sanitization and validation.
4. Register the node through the static registry.
5. Implement renderer UI with existing design-system controls.
6. Route side effects through an existing validated Preload API.
7. Update project package reference mapping and snapshot rules.
8. Add manifest, execution, state reconciliation, data-flow, package round-trip, TypeScript, and production-build tests.

## Diagnostics

The Canvas toolbar includes an **Plugin diagnostics** view. It lists loaded built-in plugin IDs, versions, API versions, contributed nodes, and declared capabilities. It does not provide installation or editing controls.
