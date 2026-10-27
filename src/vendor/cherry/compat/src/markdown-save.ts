type SaveDialog = Pick<Window['api']['dialog'], 'save'>

/** Source Markdown payload, saved through Grimoire's existing native text dialog. */
export function saveMarkdownExport(
  title: string,
  markdown: string,
  dialog: SaveDialog = window.api.dialog
): Promise<boolean> {
  return dialog.save(markdown, title + '.md')
}
