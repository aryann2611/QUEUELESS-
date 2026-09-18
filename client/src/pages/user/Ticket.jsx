import { useEffect, useState } from 'react'
import { Link, Navigate, useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Users, Clock, MapPin, Navigation, Bell, LogOut, Check, Ticket as TicketIcon, PartyPopper } from 'lucide-react'
import { api } from '../../api.js'
import { useFetch, useTicketUpdates, useQueueWatch, useLiveEta } from '../../lib/hooks.js'
import { pushState, subscribePush } from '../../lib/push.js'
import { useNotifications } from '../../lib/notifications.jsx'
import { directionsUrl } from '../../lib/geo.js'
import { fmtMin, category } from '../../lib/format.js'
import { Button, Badge, LiveDot, AnimatedNumber, Skeleton, ErrorState, EmptyState, PageTransition, Alert, Textarea, cx } from '../../ui/index.jsx'
import { Modal } from '../../ui/Modal.jsx'
import { QueueTimeline } from '../../components/Cards.jsx'
import { StarPicker, Stars } from '../../components/Reviews.jsx'
import { useToast } from '../../ui/Toast.jsx'

/** Counts down the shop's grace period — how long the customer still has to reach the counter. */
function ArriveBy({ at }) {
  const [, tick] = useState(0)
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(i) }, [])
  const left = new Date(at) - Date.now()
  if (left <= 0) return <>Check in at the counter now — your token can be skipped.</>
  const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000)
  return <>You have <b className="num">{m}:{String(s).padStart(2, '0')}</b> to get there.</>
}

/** Rate a served visit: stars, an optional comment, one submission per token. */
function ReviewForm({ ticket, onDone }) {
  const toast = useToast()
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault()
    if (!rating) return toast.error('Pick a star rating first.')
    setBusy(true)
    try {
      const { review } = await api(`/api/queues/${ticket.queue._id}/reviews`, { method: 'POST', body: { tokenId: ticket._id, rating, comment } })
      onDone({ rating: review.rating, comment: review.comment })
      toast.success('Thanks for the review!')
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} className="review-form mt-5">
      <b>How was your visit{ticket.service ? ` for ${ticket.service}` : ''}?</b>
      <StarPicker value={rating} onChange={setRating} />
      {rating > 0 && <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={500} placeholder={`Anything ${ticket.queue.name} should know? (optional)`} />}
      {rating > 0 && <Button type="submit" variant="primary" loading={busy}>Submit review</Button>}
    </form>
  )
}

const FINAL = {
  served: { title: 'Service completed.', body: 'Thanks for using QueueLess.', icon: PartyPopper },
  skipped: { title: 'Your token was skipped.', body: 'Ask at the counter to be called again, or take a new token.', icon: TicketIcon },
  left: { title: 'You left the queue.', body: 'You can join again any time.', icon: LogOut },
}

/** /queue → the user's active ticket (or an empty state). */
export function MyQueue() {
  const { data, loading, error, reload } = useFetch('/api/tokens/mine')
  if (loading) return <div className="container page"><Skeleton h={320} r={16} /></div>
  if (error) return <div className="container page"><ErrorState onRetry={reload}>We couldn't load your queue.</ErrorState></div>
  const t = data.tickets[0]
  if (t) return <Navigate to={`/t/${t._id}`} replace />
  return (
    <PageTransition className="container page">
      <div className="page-head"><div><h1>My queue</h1><p className="sub">Your live token, position and estimated wait.</p></div></div>
      <EmptyState icon={TicketIcon} title="You're not in a queue." actions={<Button variant="primary" to="/nearby" icon={MapPin}>Find Nearby</Button>}>Find a nearby service and join a queue.</EmptyState>
    </PageTransition>
  )
}

export default function Ticket() {
  const { tokenId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [ticket, setTicket] = useState(null)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const { refreshPush } = useNotifications()
  const [push, setPush] = useState(null)
  const [enabling, setEnabling] = useState(false)

  useEffect(() => { api(`/api/tokens/${tokenId}`).then((d) => setTicket(d.ticket)).catch((e) => setError(e.message)) }, [tokenId])
  useEffect(() => { pushState().then(setPush) }, [])
  useTicketUpdates((t) => { if (t._id === tokenId) setTicket(t) })
  const eta = useLiveEta(ticket)
  // refresh waiting numbers (timeline) on any queue change too
  useQueueWatch(ticket ? [ticket.queue._id] : [], (u) => setTicket((t) => t && { ...t, currentNumber: u.currentNumber, waitingNumbers: u.waitingNumbers, queue: { ...t.queue, isOpen: u.isOpen, avgServiceMinutes: u.avgServiceMinutes } }))

  async function enablePush() {
    setEnabling(true)
    try {
      await subscribePush()
      toast.success("We'll notify you.", { description: 'You can close this tab — your phone gets the call.' })
    } catch (e) { toast.error(e.message) } finally {
      setPush(await pushState())
      refreshPush()
      setEnabling(false)
    }
  }

  async function leave() {
    setLeaving(true)
    try {
      setTicket((await api(`/api/tokens/${tokenId}`, { method: 'DELETE' })).ticket)
      toast.info('Queue left.')
      setConfirm(false)
    } catch (e) { setError(e.message) } finally { setLeaving(false) }
  }

  if (error && !ticket) return <div className="container page"><ErrorState onRetry={() => navigate(0)}>{error}</ErrorState></div>
  if (!ticket) return <div className="container page ticket-page"><Skeleton h={120} r={16} /><Skeleton h={220} r={16} className="mt-4" /></div>

  const done = FINAL[ticket.status]
  const serving = ticket.status === 'serving'
  const near = ticket.status === 'waiting' && ticket.ahead <= 2
  const cat = category(ticket.queue.category)

  return (
    <PageTransition className="container page ticket-page">
      <div className="ticket-head">
        <div className="row gap-3" style={{ minWidth: 0 }}>
          <span className={cx('icon-box', ticket.queue.category)}><cat.icon aria-hidden /></span>
          <div style={{ minWidth: 0 }}><Link to={`/shop/${ticket.queue._id}`} className="ticket-shop truncate">{ticket.queue.name}</Link><div className="small muted">{ticket.service || cat.label}{ticket.priority && <> · <Badge tone="priority">{ticket.express ? 'Express' : 'Priority'}</Badge></>}</div></div>
        </div>
        {done ? <Badge tone={ticket.status}>{ticket.status}</Badge> : <Badge tone={serving ? 'success' : 'open'} size="lg"><LiveDot />{serving ? 'Your turn' : 'LIVE'}</Badge>}
      </div>

      <AnimatePresence mode="wait">
        {done ? (
          <motion.div key="done" className="card ticket-final" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <span className="success-check" style={{ background: ticket.status === 'served' ? undefined : 'var(--surface-3)', color: ticket.status === 'served' ? undefined : 'var(--text-2)' }}><done.icon aria-hidden /></span>
            <h2>{done.title}</h2>
            <p className="muted">{done.body}</p>
            <span className="eyebrow mt-3">Token</span><span className="num" style={{ fontSize: '2rem', fontWeight: 700 }}>#{ticket.number}</span>
            {ticket.status === 'served' && (ticket.review
              ? <div className="stack gap-1 mt-5" style={{ alignItems: 'center' }}><span className="small muted">You rated this visit</span><Stars value={ticket.review.rating} size={22} />{ticket.review.comment && <p className="small muted" style={{ maxWidth: 360 }}>“{ticket.review.comment}”</p>}</div>
              : <ReviewForm ticket={ticket} onDone={(review) => setTicket((t) => ({ ...t, review }))} />)}
            <div className="row gap-2 wrap mt-4" style={{ justifyContent: 'center' }}><Button variant="primary" to="/nearby" icon={MapPin}>Find another queue</Button><Button variant="secondary" to="/app">Home</Button></div>
          </motion.div>
        ) : (
          <motion.div key="live" className="ticket-grid" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <motion.div className={cx('card ticket-main', serving && 'is-serving')}
              animate={serving ? { scale: [1, 1.015, 1] } : undefined}
              transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}>
              {serving && (
                <Alert tone="success" icon={Check} className="mb-4">
                  <b>It's your turn.</b>{' '}
                  {ticket.queue.counters > 1 && ticket.counter ? <>Go to <b>counter {ticket.counter}</b> now.</> : 'Please go to the counter now.'}
                  {ticket.arriveBy && !ticket.arrivedAt && <> <ArriveBy at={ticket.arriveBy} /></>}
                  {ticket.arrivedAt && <> Checked in — the counter knows you're here.</>}
                </Alert>
              )}
              {near && !serving && <Alert tone="warning" icon={Bell} className="mb-4"><b>Get ready.</b> Only {ticket.ahead} {ticket.ahead === 1 ? 'person' : 'people'} ahead — head back now.</Alert>}
              <span className="eyebrow">Your token</span>
              <motion.span key={ticket.status} className="token-hero gradient-text num"
                initial={{ scale: 0.94, opacity: 0.6 }} animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 260, damping: 18 }} style={{ display: 'inline-block' }}>
                <AnimatedNumber value={ticket.number} prefix="#" />
              </motion.span>
              <div className="ticket-stats">
                <div><span className="stat-label">{serving && ticket.counter && ticket.queue.counters > 1 ? 'Your counter' : 'Currently serving'}</span><span className="stat-value">{serving && ticket.counter && ticket.queue.counters > 1 ? ticket.counter : ticket.currentNumber == null ? '–' : <AnimatedNumber value={ticket.currentNumber} prefix="#" />}</span></div>
                <div><span className="stat-label"><Users aria-hidden />Ahead</span><span className="stat-value"><AnimatedNumber value={ticket.ahead} /></span></div>
                <div><span className="stat-label"><Clock aria-hidden />Estimated</span><span className="stat-value">{serving ? 'Now' : <AnimatedNumber value={eta} suffix=" min" />}</span></div>
              </div>
              <div className="progress mt-4" aria-hidden><motion.span animate={{ width: `${serving ? 100 : Math.max(6, 100 - Math.min(96, ticket.ahead * 12))}%` }} transition={{ duration: 0.5 }} /></div>
              <p className="small muted mt-3">{serving ? 'Show this token at the counter.' : "You can leave now. We'll notify you when your turn is approaching."}</p>
              <div className="row gap-2 wrap mt-4">
                {push === 'off' && <Button variant="secondary" size="sm" icon={Bell} loading={enabling} onClick={enablePush}>Notify me when it's my turn</Button>}
                {ticket.queue.location && <Button variant="secondary" size="sm" icon={Navigation} href={directionsUrl(ticket.queue.location, ticket.queue.name)} target="_blank" rel="noreferrer">Get Directions</Button>}
                {ticket.status === 'waiting' && <Button variant="danger" size="sm" icon={LogOut} onClick={() => setConfirm(true)}>Leave Queue</Button>}
              </div>
              {error && <Alert tone="error" className="mt-3">{error}</Alert>}
            </motion.div>
            <aside className="card">
              <div className="between mb-4"><h3>Queue timeline</h3><span className="small muted">{ticket.waitingNumbers?.length ?? 0} waiting</span></div>
              <QueueTimeline currentNumber={ticket.currentNumber} waitingNumbers={ticket.waitingNumbers || []} mine={ticket.status === 'waiting' ? ticket.number : null} />
              {serving && <p className="small muted mt-3">You're being served right now.</p>}
            </aside>
          </motion.div>
        )}
      </AnimatePresence>

      <Modal open={confirm} onClose={() => setConfirm(false)} title="Leave the queue?" center footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>Stay</Button><Button variant="danger" loading={leaving} onClick={leave}>Leave Queue</Button></>}>
        <p className="muted">You'll lose token <b>#{ticket.number}</b> at {ticket.queue.name}. You can join again later, but you'll get a new number.</p>
      </Modal>
    </PageTransition>
  )
}

