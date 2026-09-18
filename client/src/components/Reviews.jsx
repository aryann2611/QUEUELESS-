import { useState } from 'react'
import { Star, MessageSquare, CornerDownRight } from 'lucide-react'
import { fmtDate, timeAgo, num } from '../lib/format.js'
import { Avatar, Badge, Button, Textarea, EmptyState, cx } from '../ui/index.jsx'

/** Read-only stars. `value` may be fractional (4.3 lights four and a third). */
export function Stars({ value = 0, size = 16, className }) {
  return (
    <span className={cx('stars', className)} role="img" aria-label={`${value} out of 5`} style={{ '--star': `${size}px` }}>
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = Math.max(0, Math.min(1, value - (i - 1)))
        return <span key={i} className="star" style={{ '--fill': `${fill * 100}%` }}><Star aria-hidden /><Star aria-hidden className="star-on" /></span>
      })}
    </span>
  )
}

/** Compact "★ 4.6 (23)" for cards and headers; renders nothing until there is a review. */
export function RatingPill({ rating, className }) {
  if (!rating?.count) return null
  return <span className={cx('rating-pill', className)}><Star aria-hidden />{rating.avg.toFixed(1)}<span className="muted">({num(rating.count)})</span></span>
}

const WORDS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent']

/** Clickable 1–5 picker with hover preview and keyboard support. */
export function StarPicker({ value, onChange, size = 32 }) {
  const [hover, setHover] = useState(0)
  const shown = hover || value || 0
  return (
    <div className="star-picker" role="radiogroup" aria-label="Rating" onMouseLeave={() => setHover(0)}>
      <div className="row gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} type="button" role="radio" aria-checked={value === i} aria-label={`${i} star${i === 1 ? '' : 's'} – ${WORDS[i]}`}
            className={cx('star-btn', i <= shown && 'on')} style={{ width: size, height: size }}
            onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(0)} onClick={() => onChange(i)}>
            <Star aria-hidden />
          </button>
        ))}
      </div>
      <span className="small muted" style={{ minHeight: 20 }}>{WORDS[shown]}</span>
    </div>
  )
}

/** Average, count and the 5→1 histogram. */
export function RatingSummary({ summary }) {
  if (!summary?.count) return null
  return (
    <div className="rating-summary">
      <div className="rating-big">
        <b className="num">{summary.avg.toFixed(1)}</b>
        <Stars value={summary.avg} size={18} />
        <span className="small muted">{num(summary.count)} review{summary.count === 1 ? '' : 's'}</span>
      </div>
      <ul className="rating-bars">
        {summary.byStar.map((b) => (
          <li key={b.star}><span className="xs muted num">{b.star}★</span><span className="bar"><span style={{ width: `${(b.count / summary.count) * 100}%` }} /></span><span className="xs muted num">{b.count}</span></li>
        ))}
      </ul>
    </div>
  )
}

/** One review with the optional owner reply; vendors get an inline reply box. */
export function ReviewItem({ review, canReply, onReply }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(review.reply?.text || '')
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    try { await onReply(review, text.trim()); setOpen(false) } finally { setBusy(false) }
  }
  return (
    <li className="review">
      <div className="review-head">
        <Avatar name={review.user?.name || '?'} size="sm" />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row gap-2 wrap"><b>{review.user?.name || 'Customer'}</b>{review.service && <Badge tone="neutral" size="sm">{review.service}</Badge>}</div>
          <div className="row gap-2 xs muted"><Stars value={review.rating} size={13} /><span title={fmtDate(review.createdAt)}>{timeAgo(review.createdAt)}</span></div>
        </div>
      </div>
      {review.comment && <p className="review-body">{review.comment}</p>}
      {review.reply && !open && (
        <div className="review-reply"><CornerDownRight aria-hidden /><div><span className="xs muted">Owner replied · {timeAgo(review.reply.at)}</span><p>{review.reply.text}</p></div></div>
      )}
      {canReply && !open && <Button variant="ghost" size="sm" icon={MessageSquare} onClick={() => setOpen(true)}>{review.reply ? 'Edit reply' : 'Reply'}</Button>}
      {canReply && open && (
        <form onSubmit={submit} className="stack gap-2 mt-2">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={500} placeholder="Thank them, or explain what you've changed." autoFocus />
          <div className="row gap-2"><Button type="submit" variant="primary" size="sm" loading={busy}>{text.trim() ? 'Post reply' : 'Remove reply'}</Button><Button type="button" size="sm" variant="ghost" onClick={() => { setOpen(false); setText(review.reply?.text || '') }}>Cancel</Button></div>
        </form>
      )}
    </li>
  )
}

export function ReviewList({ reviews, canReply, onReply, empty = 'No reviews yet.' }) {
  if (!reviews?.length) return <EmptyState icon={Star} title={empty} />
  return <ul className="review-list">{reviews.map((r) => <ReviewItem key={r._id} review={r} canReply={canReply} onReply={onReply} />)}</ul>
}
