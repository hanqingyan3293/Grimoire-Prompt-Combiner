# License and attribution audit

This file records findings from actual LICENSE files and source headers. README claims are not sufficient evidence.

| Project | Local snapshot | Initial signal | Required action | Copy status |
|---|---|---|---|---|
| Grimoire | current repository | AGPL-3.0-only in package metadata | Preserve project license and notices | Baseline |
| Cherry Studio 2.1.4 | 项目参考/cherry-studio-main/LICENSE | AGPL-3.0 actual license header | Preserve AGPL text, copyright, source notices, and modifications | Direct copying requires notice audit |
| OpenCode | 项目参考/opencode-dev/LICENSE | MIT actual license header | Preserve MIT notice for copied/adapted files | Copy compatible after file audit |
| Pi 0.0.3 snapshot | 项目参考/pi-main/LICENSE | MIT actual license header | Preserve MIT notice for copied/adapted files | Copy compatible after file audit |
| Dockview core 8.4.0 | 项目参考/dockview-master/packages/dockview-core | Root LICENSE not found in initial scan | Inspect package metadata and Enterprise boundary before copying | BLOCKED pending package audit |
| Infinite Canvas main and 0.18.0 | 无限参考/*/LICENSE | MIT actual license headers in both snapshots | Preserve MIT notices and compare snapshot differences | Copy compatible after file audit |
| idecn | 项目参考/idecn-main/LICENSE | MIT actual license header | Preserve MIT notice | Copy compatible after file audit |
| Prompt Studio 1.0.0 | 项目参考/prompt-studio-main/LICENSE | MIT actual license header | Preserve MIT notice | Copy compatible after file audit |
| PromptManager | 项目参考/PromptManager-master/LICENSE.md | MIT actual license header | Preserve MIT notice | Copy compatible after file audit |
| BooruDatasetTagManager | 项目参考/BooruDatasetTagManager-master/LICENSE | MIT actual license header | Preserve MIT notice | Copy compatible after file audit |
| TagMaster 1.2.0 | 项目参考/TagMaster-master | Root LICENSE not found in initial scan | Do not copy code until license provenance is verified | BLOCKED pending license provenance |
| TagStudio | 项目参考/TagStudio-main/LICENSE | GPL-3.0 actual license header | Compatibility and file scope must be approved before copying | ADAPTER/PARTIAL_EXTRACTION preferred |
| SD Image Sorter | 项目参考/sd-image-sorter-main/LICENSE | MIT actual license header | Preserve MIT notice | Copy compatible after file audit |
| Hydrus | 项目参考/hydrus-master/LICENSE | WTFPL v3 actual license header | Review compatibility and attribution requirements | ADAPTER preferred |
| Allusion | 项目参考/Allusion-master/LICENSE | GPL-3.0 actual license header | Compatibility and file scope must be approved before copying | ADAPTER/PARTIAL_EXTRACTION preferred |

## Rules

- No source code is copied solely because a README calls it MIT, GPL, or AGPL.
- Copied or substantially adapted files retain required attribution and license text.
- If a source license is incompatible or unclear, stop direct copying and use a clean-room adapter or wait for a decision.
- Update THIRD_PARTY_NOTICES.md whenever a migration row becomes VENDORED or substantially adapted.
