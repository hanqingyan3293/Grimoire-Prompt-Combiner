# Cherry Studio 2.1.4 source closure

- Source snapshot: 项目参考/cherry-studio-main
- Version: 2.1.4
- Vendored root: src/vendor/cherry/source
- Current closure size: 8,084 files
- Root license: AGPL-3.0

Included source areas:

- src/renderer/components
- src/renderer/pages
- src/renderer/routes
- src/renderer/i18n
- src/renderer/windows
- src/shared
- src/main
- packages/ui
- packages/aiCore
- packages/provider-registry
- packages/ai-sdk-provider

The closure was copied only when the destination file was absent. The initial 597-file Cherry closure had zero content conflicts with the 2.1.4 snapshot.

The source snapshot declares 357 packages that are not present in the Grimoire manifest. Those dependencies remain a recorded compatibility-build blocker. The vendor is kept intact for source audit and incremental integration; the production app uses Grimoire adapters and the CherryHostBridge until each source slice has a verified dependency boundary.

Grimoire-specific changes belong under src/integrations/cherry, src/renderer/vendor/cherry, and the Host Bridge. Do not edit the vendored source to hide missing dependencies or replace source behavior with a visual imitation.
