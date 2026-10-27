# Cherry Studio AI UI source vendor

- Source: local 项目参考/cherry-studio-main
- Version: 2.1.4
- License: AGPL-3.0; see the adjacent LICENSE file.
- Migrated source areas: chat shell, messages, Markdown, chat primitives, resource lists, Composer, ModelSelector, and shared UI data types, including source tests.
- This directory preserves source file relationships. It is not a separate application or database.
- Grimoire-specific IPC, persistence, security, theme, and ViewModel bridges belong under src/integrations/cherry and must not be silently mixed into the vendored source.
- Production entry migration is tracked in .agent/MIGRATION_MATRIX.md.
