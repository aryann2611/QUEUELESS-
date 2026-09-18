import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { MapPin, Clock, Phone, Mail, Navigation, CalendarDays, Ticket, ArrowLeft, Users } from 'lucide-react'
import { api, isActive } from '../api.js'
import { useAuth } from '../auth.jsx'
import { useFetch, useQueueWatch, applyUpdate, useTicketUpdates } from '../lib/hooks.js'
import { readSavedLocation, haversineKm, directionsUrl } from '../lib/geo.js'
import { category, fmtKm, fmtMin, fmtAddress, fmtHour } from '../lib/format.js'
import { Button, Badge, LiveDot, AnimatedNumber, Skeleton, ErrorState, PageTransition, cx } from '../ui/index.jsx'
import { GoogleMap } from '../components/Map.jsx'
import { ServiceCard, QueueTimeline } from '../components/Cards.jsx'
import { JoinQueueModal } from '../components/JoinQueue.jsx'
import { BookAppointmentModal } from '../components/BookAppointment.jsx'
import { RatingPill, RatingSummary, ReviewList } from '../components/Reviews.jsx'

export default function Shop() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const { data, error, loading, reload, setData } = useFetch(`/api/queues/${id}`)
  const reviews = useFetch(`/api/queues/${id}/reviews`)
  const [join, setJoin] = useState(false)
  const [book, setBook] = useState(false)
  const [mine, setMine] = useState(null)
  const [imgOk, setImgOk] = useState(true)
  const [allReviews, setAllReviews] = useState(false)
  const me = readSavedLocation()

  useQueueWatch([id], (u) => setData((d) => d && { ...d, queue: applyUpdate(d.queue, u), waiting: u.waitingNumbers.map((n) => ({ _id: n, number: n })) }))
  useEffect(() => { if (user) api('/api/tokens/mine').then((d) => setMine(d.tickets.find((t) => t.queue._id === id) || null)).catch(() => {}) }, [id, user])
  useTicketUpdates((t) => { if (t.queue._id === id) setMine(isActive(t) ? t : null) })

  if (error) return <div className="container page"><ErrorState onRetry={reload}>We couldn't load this shop.</ErrorState></div>
  const shop = data?.queue
  const cat = category(shop?.category)
  const distance = shop?.location && me ? haversineKm(me, shop.location) : null

  return (
    <PageTransition className="shop">
      <div className={cx('shop-hero', shop?.image && imgOk && 'has-img')}>
        {shop?.image && imgOk && (
          <motion.img src={shop.image} alt="" className="shop-hero-img" onError={() => setImgOk(false)}
            initial={{ scale: 1.08, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }} />
        )}
        <div className="shop-hero-overlay" />
        <div className="container shop-hero-inner">
          <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => (history.length > 1 ? navigate(-1) : navigate('/nearby'))} className="shop-back">Back</Button>
          {loading || !shop ? <div className="stack gap-3"><Skeleton w={220} h={34} /><Skeleton w={160} /></div> : (
            <div className="shop-title">
              <span className={cx('icon-box', shop.category)} style={{ width: 52, height: 52 }}><cat.icon aria-hidden style={{ width: 24, height: 24 }} /></span>
              <div className="grow" style={{ minWidth: 0 }}>
                <h1>{shop.name}</h1>
                <div className="row gap-3 wrap small mt-2">
                  <Badge tone={shop.isOpen ? 'open' : 'closed'}>{shop.isOpen ? <><LiveDot />Open</> : 'Closed'}</Badge>
                  <span>{cat.label}</span>
                  <RatingPill rating={shop.rating} />
                  {distance != null && <span className="row gap-1"><MapPin aria-hidden style={{ width: 14 }} />{fmtKm(distance)} away</span>}
                  {shop.hours?.open && <span className="row gap-1"><Clock aria-hidden style={{ width: 14 }} />{fmtHour(shop.hours.open)} – {fmtHour(shop.hours.close)}</span>}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="container shop-body">
        <div className="shop-main">
          {/* LIVE QUEUE */}
          <section className="card live-panel">
            <div className="between mb-4"><span className="eyebrow row gap-2"><LiveDot off={!shop?.isOpen} />Live queue</span>{mine && <Badge tone="primary"><Ticket aria-hidden />You hold #{mine.number}</Badge>}</div>
            {loading || !shop ? <div className="live-stats">{[1, 2, 3].map((i) => <div key={i}><Skeleton w={80} h={12} /><Skeleton w={90} h={40} className="mt-2" /></div>)}</div> : (
              <div className="live-stats">
                <div><span className="stat-label">Currently serving</span><span className="stat-value gradient-text">{shop.currentNumber == null ? '–' : <AnimatedNumber value={shop.currentNumber} prefix="#" />}</span></div>
                <div><span className="stat-label">People waiting</span><span className="stat-value"><AnimatedNumber value={shop.waitingCount} /></span></div>
                <div><span className="stat-label">Estimated wait</span><span className="stat-value">{shop.waitingCount ? <AnimatedNumber value={shop.etaMinutes} suffix=" min" /> : 'No wait'}</span></div>
              </div>
            )}
            {shop && shop.waitingCount > 0 && <div className="mt-5"><QueueTimeline currentNumber={shop.currentNumber} waitingNumbers={data.waiting.map((t) => t.number)} mine={mine?.number} /></div>}
          </section>

          {/* SERVICES */}
          {shop?.services?.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-3" style={{ fontSize: '1.125rem' }}>Services</h2>
              <div className="grid grid-2">{shop.services.map((s) => <ServiceCard key={s.name} s={s} as="div" />)}</div>
            </section>
          )}

          {/* ABOUT */}
          {shop && (
            <section className="mt-6">
              <h2 className="mb-3" style={{ fontSize: '1.125rem' }}>About</h2>
              <div className="card stack gap-3">
                {shop.description && <p className="muted">{shop.description}</p>}
                <ul className="info-list">
                  {fmtAddress(shop.address) && <li><MapPin aria-hidden /><span>{fmtAddress(shop.address)}</span></li>}
                  {shop.hours?.open && <li><Clock aria-hidden /><span>Open {fmtHour(shop.hours.open)} – {fmtHour(shop.hours.close)}</span></li>}
                  {shop.phone && <li><Phone aria-hidden /><a href={`tel:${shop.phone}`}>{shop.phone}</a></li>}
                  {shop.email && <li><Mail aria-hidden /><a href={`mailto:${shop.email}`}>{shop.email}</a></li>}
                  <li><Users aria-hidden /><span>~{fmtMin(shop.avgServiceMinutes)} per customer on average</span></li>
                </ul>
              </div>
            </section>
          )}

          {/* REVIEWS */}
          {shop && (
            <section className="mt-6">
              <h2 className="mb-3" style={{ fontSize: '1.125rem' }}>Reviews</h2>
              <div className="card stack gap-5">
                {reviews.data?.count ? <RatingSummary summary={reviews.data} /> : <p className="muted small">No reviews yet. Customers can rate a visit once they've been served — yours could be the first.</p>}
                {reviews.data?.count > 0 && <ReviewList reviews={allReviews ? reviews.data.reviews : reviews.data.reviews.slice(0, 6)} />}
                {reviews.data?.reviews.length > 6 && !allReviews && <Button variant="secondary" size="sm" onClick={() => setAllReviews(true)} style={{ alignSelf: 'center' }}>Show more reviews</Button>}
              </div>
            </section>
          )}

          {/* MAP */}
          {shop?.location && (
            <section className="mt-6">
              <h2 className="mb-3" style={{ fontSize: '1.125rem' }}>Location</h2>
              <GoogleMap markers={[{ id: shop._id, position: shop.location, category: shop.category, label: shop.currentNumber != null ? `#${shop.currentNumber}` : '•', title: shop.name }]} user={me} selected={shop._id} className="map-rounded" style={{ height: 280 }} />
            </section>
          )}
        </div>

        {/* ACTIONS */}
        <aside className="shop-aside">
          <div className="card shop-actions">
            {mine ? (
              <>
                <span className="eyebrow">Your token</span>
                <span className="token-hero gradient-text num">#{mine.number}</span>
                <p className="small muted">{mine.status === 'serving' ? "It's your turn — head in." : `${mine.ahead} ahead · ~${fmtMin(mine.etaMinutes)}`}</p>
                <Button variant="primary" size="lg" block to={`/t/${mine._id}`}>Track my queue</Button>
              </>
            ) : (
              <>
                <div className="stack gap-1"><b>Take a token</b><span className="small muted">{shop?.isOpen ? `${shop.waitingCount} waiting · ~${fmtMin(shop.etaMinutes)}` : 'The queue is closed right now.'}</span></div>
                <Button variant="primary" size="lg" block icon={Ticket} disabled={!shop?.isOpen} onClick={() => setJoin(true)}>Join Queue</Button>
              </>
            )}
            <Button variant="secondary" block icon={CalendarDays} disabled={!shop} onClick={() => (user ? setBook(true) : navigate('/login', { state: { from: `/shop/${id}` } }))}>Book Appointment</Button>
            {shop?.location && <Button variant="ghost" block icon={Navigation} href={directionsUrl(shop.location, shop.name)} target="_blank" rel="noreferrer">Get Directions</Button>}
          </div>
        </aside>
      </div>

      {/* Mobile sticky action bar */}
      {shop && (
        <div className="shop-sticky only-mobile-flex">
          {mine
            ? <><div className="stack" style={{ minWidth: 0 }}><b className="num">Your token #{mine.number}</b><span className="xs muted">{mine.status === 'serving' ? 'Your turn now' : `${mine.ahead} ahead · ~${fmtMin(mine.etaMinutes)}`}</span></div><Button variant="primary" size="lg" to={`/t/${mine._id}`}>Track my queue</Button></>
            : <><div className="stack" style={{ minWidth: 0 }}><b className="num">{shop.waitingCount} waiting</b><span className="xs muted">~{fmtMin(shop.etaMinutes)} wait</span></div><Button variant="primary" size="lg" disabled={!shop.isOpen} onClick={() => setJoin(true)} icon={Ticket}>Join Queue</Button></>}
        </div>
      )}

      {shop && <JoinQueueModal shop={shop} open={join} onClose={() => setJoin(false)} onJoined={setMine} />}
      {shop && <BookAppointmentModal shop={shop} open={book} onClose={() => setBook(false)} />}
    </PageTransition>
  )
}
