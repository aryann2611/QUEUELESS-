import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { MapPin, Clock, Users, ArrowRight, Bell, CheckCircle2, AlertTriangle, Info, XCircle, CalendarDays, Ticket, Check } from 'lucide-react'
import { category, fmtKm, fmtMin, fmtDate, fmtTime, timeAgo } from '../lib/format.js'
import { useLiveEta } from '../lib/hooks.js'
import { RatingPill } from './Reviews.jsx'
import { Badge, Button, Card, LiveDot, AnimatedNumber, cx, fadeUp } from '../ui/index.jsx'

/** Shop in a list (nearby, home, search). */
export function ShopCard({ shop, selected, onSelect, compact, animate = true }) {
  const cat = category(shop.category)
  const Wrap = animate ? motion.article : 'article'
  return (
    <Wrap variants={animate ? fadeUp : undefined} layout={animate ? 'position' : undefined}
      className={cx('card card-hover shop-card', compact && 'card-sm', selected && 'selected')}
      onMouseEnter={() => onSelect?.(shop._id)} onFocus={() => onSelect?.(shop._id)}>
      {!compact && shop.image && <img src={shop.image} alt="" className="shop-card-cover" loading="lazy" onError={(e) => { e.currentTarget.remove() }} />}
      <div className="shop-card-head">
        <span className={cx('icon-box', shop.category)}><cat.icon aria-hidden /></span>
        <div className="grow" style={{ minWidth: 0 }}>
          <h3 className="truncate"><Link to={`/shop/${shop._id}`} className="stretched">{shop.name}</Link></h3>
          <div className="small muted row gap-2 wrap">
            <span>{cat.label}</span>
            {shop.rating?.count > 0 && <><span aria-hidden>·</span><RatingPill rating={shop.rating} /></>}
            {shop.distanceKm != null && <><span aria-hidden>·</span><span className="row gap-1"><MapPin style={{ width: 13 }} aria-hidden />{fmtKm(shop.distanceKm)}</span></>}
          </div>
        </div>
        <Badge tone={shop.isOpen ? 'open' : 'closed'}>{shop.isOpen ? <><LiveDot />Open</> : 'Closed'}</Badge>
      </div>
      <div className="shop-card-stats">
        <div><span className="faint xs">Serving</span><b className="num">{shop.currentNumber == null ? '–' : `#${shop.currentNumber}`}</b></div>
        <div><span className="faint xs">Waiting</span><b className="num">{shop.waitingCount}</b></div>
        <div><span className="faint xs">Est. wait</span><b className="num">~{fmtMin(shop.etaMinutes)}</b></div>
      </div>
      {!compact && (
        <div className="shop-card-foot">
          <Button variant="soft" size="sm" to={`/shop/${shop._id}`} style={{ position: 'relative', zIndex: 2 }}>View Queue<ArrowRight aria-hidden /></Button>
        </div>
      )}
    </Wrap>
  )
}

/** A customer's active token, compact. */
export function TokenCard({ ticket, className }) {
  const live = ticket.status === 'waiting' || ticket.status === 'serving'
  const eta = useLiveEta(ticket)
  return (
    <Link to={`/t/${ticket._id}`} className={cx('card card-hover token-card', ticket.status === 'serving' && 'is-serving', className)}>
      <div className="between">
        <div className="stack">
          <span className="eyebrow">Your token</span>
          <b className="truncate">{ticket.queue.name}</b>
        </div>
        <Badge tone={ticket.status === 'serving' ? 'success' : 'primary'}>{ticket.status === 'serving' ? 'Your turn' : <><LiveDot />Live</>}</Badge>
      </div>
      <div className="token-card-body">
        <span className="token-big gradient-text"><AnimatedNumber value={ticket.number} prefix="#" /></span>
        <div className="token-card-meta">
          <span><Users aria-hidden /><AnimatedNumber value={ticket.ahead} /> ahead</span>
          <span><Clock aria-hidden />~{fmtMin(eta)}</span>
          <span>Serving <b className="num">{ticket.currentNumber == null ? '–' : `#${ticket.currentNumber}`}</b></span>
        </div>
      </div>
      {live && <div className="progress"><span style={{ width: `${Math.max(6, 100 - Math.min(100, ticket.ahead * 12))}%` }} /></div>}
    </Link>
  )
}

/** Vertical queue timeline: serving → … → YOU. */
export function QueueTimeline({ currentNumber, waitingNumbers = [], mine, maxBefore = 5 }) {
  const idx = waitingNumbers.indexOf(mine)
  const before = idx > 0 ? waitingNumbers.slice(Math.max(0, idx - maxBefore), idx) : []
  const hidden = idx > maxBefore ? idx - maxBefore : 0
  const after = idx >= 0 ? waitingNumbers.slice(idx + 1, idx + 3) : waitingNumbers.slice(0, 4)
  const Item = ({ n, kind, label }) => (
    <motion.li layout className={cx('tl-item', kind)} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25 }}>
      <div className="tl-rail"><span className="tl-dot" /><span className="tl-line" /></div>
      <div className="tl-body"><span className="tl-num">#{n}</span><span className={cx('small', kind === 'you' ? 'strong' : 'muted')}>{label}</span></div>
    </motion.li>
  )
  return (
    <ol className="timeline" aria-label="Queue order">
      {currentNumber != null && <Item n={currentNumber} kind="serving" label="Serving now" />}
      {hidden > 0 && <li className="tl-more">+{hidden} more waiting</li>}
      {before.map((n) => <Item key={n} n={n} kind="waiting" label="Waiting" />)}
      {mine != null && idx >= 0 && <Item n={mine} kind="you" label="You" />}
      {after.map((n) => <Item key={n} n={n} kind="waiting" label="Waiting" />)}
      {mine == null && waitingNumbers.length > 4 && <li className="tl-more">+{waitingNumbers.length - 4} more waiting</li>}
    </ol>
  )
}

const APPT_LABEL = { booked: 'Confirmed', checked_in: 'Checked in', completed: 'Completed', cancelled: 'Cancelled' }
export function AppointmentCard({ a, onCancel, onCheckIn, onComplete, staff, busy }) {
  const tone = a.status
  return (
    <motion.article variants={fadeUp} layout className="card appt-card">
      <div className="between">
        <div className="stack gap-1" style={{ minWidth: 0 }}>
          <b className="truncate">{staff ? a.user?.name : a.queue?.name}</b>
          <span className="small muted">{a.service || (staff ? a.queue?.name : category(a.queue?.category).label)}</span>
        </div>
        <Badge tone={tone}>{APPT_LABEL[a.status] || a.status}</Badge>
      </div>
      <div className="appt-when">
        <span className="row gap-2"><CalendarDays aria-hidden />{fmtDate(a.at)}</span>
        <span className="row gap-2"><Clock aria-hidden />{fmtTime(a.at)}</span>
        {a.token && <span className="row gap-2"><Ticket aria-hidden />Token #{a.token.number}</span>}
      </div>
      {a.note && <p className="small muted">“{a.note}”</p>}
      <div className="row gap-2 wrap">
        {!staff && <Button variant="secondary" size="sm" to={`/shop/${a.queue?._id}`}>View</Button>}
        {a.status === 'booked' && onCancel && <Button variant="danger" size="sm" loading={busy} onClick={() => onCancel(a)}>Cancel</Button>}
        {staff && a.status === 'booked' && onCheckIn && <Button variant="primary" size="sm" icon={Check} loading={busy} onClick={() => onCheckIn(a)}>Check in</Button>}
        {staff && a.status === 'checked_in' && onComplete && <Button variant="secondary" size="sm" loading={busy} onClick={() => onComplete(a)}>Complete</Button>}
      </div>
    </motion.article>
  )
}

const NICON = { success: CheckCircle2, warning: AlertTriangle, danger: XCircle, info: Info }
export function NotificationCard({ n }) {
  const Icon = NICON[n.tone] || Bell
  return (
    <motion.li layout variants={fadeUp} className={cx('notif', !n.read && 'unread', `notif-${n.tone}`)}>
      <span className="notif-icon"><Icon aria-hidden /></span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="between"><b>{n.title}</b><span className="xs faint">{timeAgo(n.at)}</span></div>
        <p className="small muted">{n.body}</p>
        {n.tokenId && <Link to={`/t/${n.tokenId}`} className="small">View queue</Link>}
      </div>
    </motion.li>
  )
}

export function ServiceCard({ s, selected, onSelect, as = 'button' }) {
  const Cmp = as
  return (
    <Cmp type={as === 'button' ? 'button' : undefined} className={cx('service-card', selected && 'selected')} onClick={onSelect ? () => onSelect(s) : undefined} aria-pressed={onSelect ? !!selected : undefined}>
      <span className="stack gap-1" style={{ minWidth: 0 }}><b className="truncate">{s.name}</b><span className="small muted">~{fmtMin(s.minutes)}</span></span>
      {onSelect && <span className={cx('radio', selected && 'on')} aria-hidden />}
    </Cmp>
  )
}
