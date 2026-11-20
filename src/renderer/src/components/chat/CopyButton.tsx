import { useEffect, useRef, useState } from 'react'
import { IconCheck, IconCopy } from '../Icons'

/** Botón de copiar con confirmación breve («Copiado») */
export function CopyButton(p: {
  text: string | (() => string)
  label?: string
  title?: string
  className?: string
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = (): void => {
    const value = typeof p.text === 'function' ? p.text() : p.text
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <button type="button" className={`cr-copy ${p.className ?? ''}`} onClick={copy} title={p.title ?? 'Copiar'}>
      {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
      <span>{copied ? 'Copiado' : (p.label ?? 'Copiar')}</span>
    </button>
  )
}
