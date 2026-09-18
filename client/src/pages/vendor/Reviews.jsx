import { Star, MessageSquare, TrendingUp } from 'lucide-react'
import { api } from '../../api.js'
import { useVendor } from './VendorContext.jsx'
import { useFetch } from '../../lib/hooks.js'
import { num } from '../../lib/format.js'
import { StatCard, Skeleton, ErrorState, PageTransition, Button, Alert } from '../../ui/index.jsx'
import { useToast } from '../../ui/Toast.jsx'
import { RatingSummary, ReviewList, Stars } from '../../components/Reviews.jsx'

export default function Reviews() {
  const { shop, shopId } = useVendor()
  const toast = useToast()
  const { data, loading, error, reload, setData } = useFetch(`/api/queues/${shopId}/reviews`)
  if (!shop) return null

  async function reply(review, text) {
    try {
      const r = await api(`/api/queues/${shopId}/reviews/${review._id}`, { method: 'PATCH', body: { reply: text } })
      setData((d) => ({ ...d, reviews: d.reviews.map((x) => (x._id === review._id ? r.review : x)) }))
      toast.success(text ? 'Reply posted.' : 'Reply removed.')
    } catch (e) { toast.error(e.message); throw e }
  }

  const unanswered = data?.reviews.filter((r) => !r.reply && r.comment).length ?? 0
  const recent = data?.reviews.slice(0, 10) ?? []
  const recentAvg = recent.length ? recent.reduce((s, r) => s + r.rating, 0) / recent.length : 0
  const low = data?.byStar.filter((b) => b.star <= 3).reduce((n, b) => n + b.count, 0) ?? 0

  return (
    <PageTransition className="stack gap-6">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><h1>Reviews</h1><p className="sub">What customers said after being served at {shop.name}. Replies are public.</p></div>
        <Button variant="secondary" size="sm" onClick={reload}>Refresh</Button>
      </div>
      {error ? <ErrorState onRetry={reload}>We couldn't load reviews.</ErrorState> : loading && !data ? <Skeleton h={320} r={16} /> : (
        <>
          <div className="grid grid-4">
            <StatCard label="Average rating" value={data.count ? data.avg.toFixed(1) : '–'} sub={data.count ? <Stars value={data.avg} size={14} /> : 'no reviews yet'} icon={Star} accent animated={false} />
            <StatCard label="Reviews" value={data.count} sub="from served visits" icon={MessageSquare} />
            <StatCard label="Last 10" value={recent.length ? recentAvg.toFixed(1) : '–'} sub={recent.length && data.count > 10 ? (recentAvg >= data.avg ? 'holding or improving' : 'below your average') : 'recent trend'} icon={TrendingUp} animated={false} />
            <StatCard label="Needs a reply" value={unanswered} sub={`of the latest ${data.reviews.length}, with a comment`} icon={MessageSquare} animated={false} />
          </div>

          {low > 0 && <Alert tone="warning">{low} review{low === 1 ? '' : 's'} rated 3 stars or below. A short reply shows customers you listen — and it's public.</Alert>}

          {data.count > 0 && (
            <section className="card stack gap-5">
              <RatingSummary summary={data} />
              {data.byService.length > 0 && (
                <div>
                  <h3 className="mb-3">By service</h3>
                  <div className="table-wrap"><table className="table">
                    <thead><tr><th>Service</th><th>Rating</th><th>Reviews</th></tr></thead>
                    <tbody>{data.byService.map((s) => (
                      <tr key={s.service}><td className="strong">{s.service}</td><td><span className="row gap-2"><Stars value={s.avg} size={13} /><span className="num">{s.avg.toFixed(1)}</span></span></td><td className="muted">{num(s.count)}</td></tr>
                    ))}</tbody>
                  </table></div>
                </div>
              )}
            </section>
          )}

          <section className="card">
            <div className="between mb-4"><div><h3>All reviews</h3><p className="small muted">Newest first. Reply to thank customers or explain what you've fixed.</p></div></div>
            <ReviewList reviews={data.reviews} canReply onReply={reply} empty="No reviews yet — they appear once a served customer rates their visit." />
          </section>
        </>
      )}
    </PageTransition>
  )
}
