import { Queue, Review } from './models.js';

export const pubReview = (r) => ({
  _id: r._id, rating: r.rating, comment: r.comment, service: r.service, createdAt: r.createdAt,
  user: r.user && { _id: r.user._id ?? r.user, name: r.user.name },
  reply: r.reply?.text ? { text: r.reply.text, at: r.reply.at } : null,
});

/** Recompute the shop's denormalised average after a review is written. */
export async function refreshRating(queueId) {
  const [agg] = await Review.aggregate([{ $match: { queue: queueId } }, { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } }]);
  const rating = { avg: agg ? Math.round(agg.avg * 10) / 10 : 0, count: agg?.count ?? 0 };
  await Queue.updateOne({ _id: queueId }, { rating });
  return rating;
}

/** Average, count, star histogram, per-service averages and the newest reviews for a shop. */
export async function reviewsFor(queueId, limit = 50) {
  const reviews = await Review.find({ queue: queueId }).sort('-createdAt').limit(limit).populate('user', 'name');
  const [agg] = await Review.aggregate([{ $match: { queue: queueId } }, { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } }]);
  const stars = await Review.aggregate([{ $match: { queue: queueId } }, { $group: { _id: '$rating', count: { $sum: 1 } } }]);
  const services = await Review.aggregate([{ $match: { queue: queueId, service: { $ne: '' } } }, { $group: { _id: '$service', avg: { $avg: '$rating' }, count: { $sum: 1 } } }, { $sort: { count: -1 } }]);
  return {
    avg: agg ? Math.round(agg.avg * 10) / 10 : 0,
    count: agg?.count ?? 0,
    byStar: [5, 4, 3, 2, 1].map((star) => ({ star, count: stars.find((s) => s._id === star)?.count ?? 0 })),
    byService: services.map((s) => ({ service: s._id, avg: Math.round(s.avg * 10) / 10, count: s.count })),
    reviews: reviews.map(pubReview),
  };
}
