import { useEffect, useRef, useState } from 'react'

/**
 * 一条留言的字数上限。
 * 输入框的 maxLength 和提交时的兜底截断都用它 —— 只在这里定义一次，
 * 免得「框里能打 300、库里只收 128」这种对不上的事。
 */
export const MAX_MESSAGE_LEN = 300

interface Props {
  /**
   * 两套皮，不只是配色：
   *   note  —— 详情页的暗色面板（金色圆角按钮、`--v*` 一套 token）
   *   board —— 站级留言板（浅色页、实心按钮、`--danger` 一套 token）
   * 类名和文案都在 SKIN 里，调用方不必知道任何一条 class。
   */
  variant: 'note' | 'board'
  maxLength?: number
  placeholder: string
  /**
   * 提交。抛错 = 失败：草稿留在框里，界面给一条「没贴上去」。
   * 正常返回 = 成功：草稿清空、高度收回。
   */
  onSubmit: (text: string) => Promise<void>
  ariaLabel?: string
}

const SKIN = {
  note: {
    row: 'row',
    hint: 'hint',
    button: 'note-submit',
    error: 'annot-error',
    maxHeight: 140,
    idle: '匿名',
    busy: '上传中…',
    label: '上传',
    errorText: '没写上去 —— 文字还在框里，再点一次「上传」',
  },
  board: {
    row: 'board-row',
    hint: 'board-hint',
    button: 'solid-btn',
    error: 'board-error',
    maxHeight: 160,
    idle: '匿名 · Ctrl + Enter 发送',
    busy: '上传中…',
    label: '上传',
    errorText: '没贴上去 —— 文字还在框里，再点一次「上传」',
  },
} as const

/**
 * 留言输入区：自增高 textarea + 字数 + 发送按钮 + 失败提示。
 *
 * 两处留言（照片下面的、站级的）原本各写了一遍同样的东西 —— 自增高、
 * Ctrl/Cmd+Enter、发送中禁用、「失败不丢草稿」。差别只有 class 和几句文案，
 * 那些在 SKIN 里；状态机在这里。
 *
 * 失败提示的位置按 skin 分开：`.annot-error` 的上边距写的是 0、下边是
 * sp-4（设计成压在输入框上方），`.board-error` 正好相反。别为了「代码好看」
 * 把两条挪到同一个位置，那会动到现在已经调好的间距。
 */
export function Composer({
  variant,
  maxLength = MAX_MESSAGE_LEN,
  placeholder,
  onSubmit,
  ariaLabel,
}: Props) {
  const skin = SKIN[variant]
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  /* 草稿清空后把高度收回去：提交成功会走到这里 */
  useEffect(() => {
    if (!draft && areaRef.current) areaRef.current.style.height = 'auto'
  }, [draft])

  const send = async () => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    setFailed(false)
    try {
      await onSubmit(text)
      // 只有成功才清：没发出去的时候，最先要保住的是那几行字
      setDraft('')
    } catch {
      setFailed(true)
    } finally {
      setSending(false)
    }
  }

  const error = failed ? (
    <p className={skin.error} role="alert">
      {skin.errorText}
    </p>
  ) : null

  return (
    <>
      {variant === 'note' && error}
      <textarea
        ref={areaRef}
        value={draft}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => {
          setDraft(e.target.value)
          const el = e.currentTarget
          el.style.height = 'auto'
          el.style.height = `${Math.min(el.scrollHeight, skin.maxHeight)}px`
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            void send()
          }
        }}
      />
      <div className={skin.row}>
        <span className={skin.hint}>
          {draft.length > 0 ? `${draft.length} / ${maxLength}` : skin.idle}
        </span>
        <button
          type="button"
          className={skin.button}
          disabled={!draft.trim() || sending}
          onClick={() => void send()}
        >
          {sending ? skin.busy : skin.label}
        </button>
      </div>
      {variant === 'board' && error}
    </>
  )
}
