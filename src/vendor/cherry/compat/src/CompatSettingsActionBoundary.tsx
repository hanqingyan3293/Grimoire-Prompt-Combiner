import type { ReactNode } from 'react'

/** React-owned native boundary for source skill/task pages without a readOnly API.
 * It disables in-page form controls and buttons, including search/retry/back;
 * safe anchors and the parent's settings sidebar remain outside that restriction.
 * Source reads and render effects still run through the real refusal transports.
 * No source-owned DOM properties, attributes or event state are rewritten.
 * This is UI admission, not an execution service or main-process security policy.
 */
export function CompatSettingsActionBoundary({
  children,
  label,
  describedBy
}: {
  children: ReactNode
  label: string
  describedBy: string
}) {
  return (
    <fieldset
      disabled
      aria-label={label}
      aria-describedby={describedBy}
      className="m-0 flex min-h-0 min-w-0 flex-1 flex-col border-0 p-0">
      {children}
    </fieldset>
  )
}
