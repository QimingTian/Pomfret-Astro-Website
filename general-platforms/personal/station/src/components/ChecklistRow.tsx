import type { CheckStatus } from '../lib/types'

type ChecklistRowProps = {
  label: string
  status: CheckStatus
  detail: string
}

function lampClass(status: CheckStatus): string {
  switch (status) {
    case 'ok':
      return 'lamp lamp-ok'
    case 'warn':
      return 'lamp lamp-warn'
    case 'error':
      return 'lamp lamp-error'
    default:
      return 'lamp lamp-unknown'
  }
}

export function ChecklistRow({ label, status, detail }: ChecklistRowProps) {
  return (
    <li className="check-row">
      <span className={lampClass(status)} aria-hidden />
      <div className="check-body">
        <div className="check-label">{label}</div>
        <div className="check-detail">{detail}</div>
      </div>
    </li>
  )
}
