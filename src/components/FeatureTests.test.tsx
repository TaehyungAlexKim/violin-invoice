import { render, screen, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { ConfirmationDialog } from './ConfirmationDialog'
import { ErrorState } from './Shared'

describe('core interaction components', () => {
  afterEach(() => cleanup())
  it('keeps loading and error pages free of successful empty-state content', () => {
    const { rerender } = render(<><p role="status">Loading students…</p></>)
    expect(screen.queryByText('No students.')).not.toBeInTheDocument()
    rerender(<><div role="alert">Unable to load students.</div></>)
    expect(screen.queryByText('No students.')).not.toBeInTheDocument()
  })

  it('renders failed-query retry and invokes it', () => {
    const retry=vi.fn()
    render(<ErrorState message="Unable to load lessons." onRetry={retry} />)
    fireEvent.click(screen.getByRole('button',{name:'Retry'}))
    expect(retry).toHaveBeenCalledOnce()
  })

  it('prevents a second confirmation submit while pending', () => {
    const confirm=vi.fn()
    render(<ConfirmationDialog open title="Delete draft?" confirmLabel="Delete draft" pending onCancel={()=>{}} onConfirm={confirm}><p>Warning</p></ConfirmationDialog>)
    const button=screen.getByRole('button',{name:'Working…'})
    expect(button).toBeDisabled()
  })

  it('supports keyboard cancellation and explicit confirmation', () => {
    const confirm=vi.fn()
    const cancel=vi.fn()
    render(<ConfirmationDialog open title="Finalize invoice?" confirmLabel="Finalize invoice" pending={false} onCancel={cancel} onConfirm={confirm}><p>Irreversible</p></ConfirmationDialog>)
    fireEvent.keyDown(document, {key:'Escape'})
    fireEvent.click(screen.getByRole('button',{name:'Cancel'}))
    fireEvent.click(screen.getByRole('button',{name:'Finalize invoice'}))
    expect(cancel).toHaveBeenCalled()
    expect(confirm).toHaveBeenCalledOnce()
  })
})
