import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

export function ConfirmationDialog({
  open,
  title,
  children,
  confirmLabel,
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  pending?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
  if (!open) return null
  return <dialog ref={dialogRef} className="confirmation-dialog" aria-labelledby="confirmation-title"
    onCancel={(event) => { event.preventDefault(); if (!pending) onCancel() }}>
    <h2 id="confirmation-title">{title}</h2>
    <div className="confirmation-content">{children}</div>
    <div className="actions dialog-actions">
      <button type="button" onClick={onCancel} disabled={pending}>Cancel</button>
      <button type="button" className="danger" onClick={onConfirm} disabled={pending}>
        {pending ? 'Working…' : confirmLabel}
      </button>
    </div>
  </dialog>
}
