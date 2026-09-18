import { Queue, Token, Review } from './models.js';
import { fail } from './auth.js';
import { sendPush } from './push.js';
import { paymentsEnabled } from './payments.js';

export const ACTIVE = ['waiting', 'serving'];
/** Shops from before verification existed have no status and count as approved. */
export const approved = (queue) => (queue.status ?? 'approved') === 'approved';
const ORDER = { priority: -1, number: 1 };
// ponytail: UTC day boundary; add a per-queue timezone if clinics want local midnight
export const today = () => new Date().toISOString().slice(0, 10);
export const startOfToday = () => new Date(today());

/** Minutes a token takes: its service's duration, else the shop's rolling average. */
export const minutesFor = (queue, token) => queue.services?.find((s) => s.name === token?.service)?.minutes ?? queue.avgServiceMinutes;
/** Wall-clock wait for a list of tokens ahead, spread over the shop's counters. */
export const etaFor = (queue, tokens) => Math.round(tokens.reduce((sum, t) => sum + minutesFor(queue, t), 0) / Math.max(1, queue.counters || 1));

/** Where an uploaded (data URI) cover is served from; links pass through untouched. */
export const coverPath = (queue) => `/api/queues/${queue._id}/cover`;
export const coverUrl = (queue) => (queue.image?.startsWith('data:') ? coverPath(queue) : queue.image);

export const summary = (queue, waiting = []) => ({
  _id: queue._id,
  name: queue.name,
  description: queue.description,
  category: queue.category,
  status: queue.status || 'approved',
  image: coverUrl(queue),
  rating: { avg: queue.rating?.avg ?? 0, count: queue.rating?.count ?? 0 },
  phone: queue.phone,
  email: queue.email,
  address: queue.address,
  hours: queue.hours,
  services: queue.services,
  counters: queue.counters || 1,
  graceMinutes: queue.graceMinutes || 0,
  express: paymentsEnabled && queue.express?.enabled && queue.express.price > 0 ? { price: queue.express.price, perHour: queue.express.perHour } : null,
  location: queue.location?.coordinates ? { lng: queue.location.coordinates[0], lat: queue.location.coordinates[1] } : null,
  isOpen: queue.isOpen,
  avgServiceMinutes: queue.avgServiceMinutes,
  owner: queue.owner,
  currentNumber: queue.currentToken?.number ?? null,
  waitingCount: waiting.length,
  etaMinutes: etaFor(queue, waiting),
  ...(queue.distance !== undefined && { distanceKm: Math.round(queue.distance / 100) / 10 }),
});

/** Express slots left in the current rolling hour. */
export const expressSlotsLeft = async (queue) =>
  Math.max(0, (queue.express?.perHour || 0) - await Token.countDocuments({ queue: queue._id, 'express.paymentId': { $exists: true }, createdAt: { $gte: new Date(Date.now() - 3600e3) } }));

export async function joinQueue(queue, userId, { priority = false, service = '', express } = {}) {
  if (queue.status === 'suspended') throw fail(403, 'this business is suspended');
  if (!approved(queue)) throw fail(403, 'this business is awaiting verification');
  if (!queue.isOpen) throw fail(400, 'queue is closed');
  if (await Token.exists({ queue: queue._id, user: userId, status: { $in: ACTIVE } })) throw fail(409, 'already in this queue');
  const day = today();
  const bumped = await Queue.findOneAndUpdate(
    { _id: queue._id },
    [{ $set: { counterDate: day, counter: { $cond: [{ $eq: ['$counterDate', day] }, { $add: ['$counter', 1] }, 1] } } }],
    { new: true });
  return Token.create({ queue: queue._id, user: userId, number: bumped.counter, priority: priority || !!express, service, ...(express && { express }) });
}

const locks = new Map(); // ponytail: in-process per-queue mutex; use a CAS on queue.currentToken if >1 server process
const withLock = (key, fn) => { const run = (locks.get(key) ?? Promise.resolve()).then(fn, fn); locks.set(key, run.catch(() => {})); return run; };
/** mode: 'next' | 'skip' | 'complete'. counter: which counter (1..queue.counters) is acting. */
/** `only`: the token the caller means to act on; a no-op if that counter has since moved on or the customer was checked in (the sweeper decides who is late outside the lock). */
export const callNext = (queueId, mode, counter = 1, only) => withLock(String(queueId), () => advance(queueId, mode, counter, only));

async function advance(queueId, mode, counter, only) {
  const queue = await Queue.findById(queueId);
  const now = new Date();
  counter = Math.min(Math.max(1, Number(counter) || 1), queue.counters || 1);
  // the token this counter is currently serving (legacy tokens without a counter belong to counter 1)
  const done = await Token.findOne({ queue: queue._id, status: 'serving', $or: [{ counter }, ...(counter === 1 ? [{ counter: null }] : [])] });
  if (only && (String(done?._id) !== String(only) || done.arrivedAt)) return { queue, done: null, next: null };
  if (done) {
    done.status = mode === 'skip' ? 'skipped' : 'served';
    done.doneAt = now;
    await done.save();
    const minutes = (now - done.calledAt) / 60000;
    if (mode !== 'skip' && minutes > 0 && minutes < 120) queue.avgServiceMinutes = 0.7 * queue.avgServiceMinutes + 0.3 * minutes;
  }
  // 'complete' marks the current token served without calling the next one
  const next = mode === 'complete' ? null : await Token.findOneAndUpdate(
    { queue: queue._id, status: 'waiting' }, { status: 'serving', calledAt: now, counter, arrivedAt: null }, { sort: ORDER, new: true });
  queue.currentToken = next?._id ?? (await Token.findOne({ queue: queue._id, status: 'serving' }).sort('-calledAt'))?._id ?? null;
  await queue.save();
  return { queue, done, next };
}

/** Counters were reduced: return anyone served above the new limit to the front, like a recall. Otherwise they are invisible to staff and the sweeper skips the wrong person. */
const release = async (queue) => {
  const stranded = await Token.find({ queue: queue._id, status: 'serving', counter: { $gt: queue.counters || 1 } }).select('_id');
  if (!stranded.length) return [];
  const ids = stranded.map((t) => t._id);
  await Token.updateMany({ _id: { $in: ids } }, {
    $set: { status: 'waiting', priority: true, pushed: [] },
    $unset: { counter: '', calledAt: '', arrivedAt: '', doneAt: '' },
  });
  if (ids.some((id) => String(id) === String(queue.currentToken))) {
    queue.currentToken = (await Token.findOne({ queue: queue._id, status: 'serving' }).sort('-calledAt'))?._id ?? null;
    await queue.save();
  }
  return ids;
};
/** Same lock as callNext, so this can't race a counter that is mid-advance. */
export const releaseStranded = (queue) => withLock(String(queue._id), () => release(queue));

/** Staff confirmed the called customer showed up (stops the grace timer). */
export async function markArrived(queueId, tokenId) {
  const token = await Token.findOne({ _id: tokenId, queue: queueId, status: 'serving' });
  if (!token) throw fail(404, 'no such token being served');
  token.arrivedAt = new Date();
  return token.save();
}

/** Put a skipped token back at the front of the line. */
export async function recallToken(queueId, tokenId) {
  const token = await Token.findOne({ _id: tokenId, queue: queueId });
  if (!token) throw fail(404, 'token not found');
  if (token.status !== 'skipped') throw fail(400, `cannot recall: token is ${token.status}`);
  if (await Token.exists({ queue: queueId, user: token.user, status: { $in: ACTIVE } })) throw fail(409, 'customer already holds an active token');
  // pushed is cleared too, so the recalled customer gets the "it's your turn" push again when called
  Object.assign(token, { status: 'waiting', priority: true, calledAt: undefined, arrivedAt: undefined, doneAt: undefined, counter: undefined, pushed: [] });
  return token.save();
}

export async function leaveToken(token) {
  if (token.status !== 'waiting') throw fail(400, `cannot leave: token is ${token.status}`);
  token.status = 'left';
  return token.save();
}

/** Tokens in line before `token` (same ordering as the staff list). */
const beforeFilter = (token) => token.priority
  ? { priority: true, number: { $lt: token.number } }
  : { $or: [{ priority: true }, { number: { $lt: token.number } }] };

export async function ticketFor(token) {
  const queue = await Queue.findById(token.queue).populate('currentToken', 'number');
  let ahead = 0, etaMinutes = 0;
  if (token.status === 'waiting') {
    const before = await Token.find({ queue: queue._id, status: 'waiting', ...beforeFilter(token) }).select('service');
    const serving = await Token.find({ queue: queue._id, status: 'serving' }).select('service calledAt');
    ahead = before.length + serving.length;
    // remaining time at the counters + everyone in line ahead, spread over the counters
    const remaining = serving.reduce((s, t) => s + Math.max(1, minutesFor(queue, t) - (Date.now() - t.calledAt) / 60000), 0);
    etaMinutes = Math.round((before.reduce((s, t) => s + minutesFor(queue, t), 0) + remaining) / Math.max(1, queue.counters || 1));
  }
  const waitingNumbers = token.status === 'waiting'
    ? (await Token.find({ queue: queue._id, status: 'waiting' }).sort(ORDER).select('number')).map((t) => t.number)
    : [];
  const grace = queue.graceMinutes || 0;
  const review = token.status === 'served' ? await Review.findOne({ token: token._id }).select('rating comment') : null;
  return {
    _id: token._id,
    number: token.number,
    status: token.status,
    priority: token.priority,
    express: !!token.express?.paymentId,
    service: token.service,
    counter: token.counter ?? null,
    calledAt: token.calledAt ?? null,
    arrivedAt: token.arrivedAt ?? null,
    // when a called customer must show up by (grace period), null if the shop doesn't use one
    arriveBy: token.status === 'serving' && grace && !token.arrivedAt && token.calledAt ? new Date(token.calledAt.getTime() + grace * 60000) : null,
    queue: {
      _id: queue._id, name: queue.name, category: queue.category, avgServiceMinutes: queue.avgServiceMinutes, isOpen: queue.isOpen,
      counters: queue.counters || 1, graceMinutes: grace, address: queue.address, location: summary(queue).location,
    },
    currentNumber: queue.currentToken?.number ?? null,
    waitingNumbers,
    ahead,
    etaMinutes,
    etaAt: new Date(), // the client counts the estimate down from this moment between updates
    review: review ? { rating: review.rating, comment: review.comment } : null, // served tokens: what the customer said, if anything
    createdAt: token.createdAt,
  };
}

export async function queueState(queue, withNames) {
  await queue.populate({ path: 'currentToken', populate: { path: 'user', select: 'name' } });
  const waiting = await Token.find({ queue: queue._id, status: 'waiting' }).sort(ORDER).populate('user', 'name');
  const serving = await Token.find({ queue: queue._id, status: 'serving' }).sort('counter').populate('user', 'name');
  const pub = (t) => ({
    _id: t._id, number: t.number, priority: t.priority, express: !!t.express?.paymentId, service: t.service,
    ...(withNames && t.user && { user: { _id: t.user._id, name: t.user.name } }),
  });
  const servingPub = (t) => ({ ...pub(t), counter: t.counter ?? 1, calledAt: t.calledAt, arrivedAt: t.arrivedAt ?? null });
  const current = queue.currentToken;
  const state = {
    queue: { ...summary(queue, waiting), ...(paymentsEnabled && queue.express?.enabled && { express: { price: queue.express.price, perHour: queue.express.perHour, slotsLeft: await expressSlotsLeft(queue) } }) },
    paymentsEnabled,
    // the owner needs the saved config even while the offer is switched off; the public summary hides it then
    ...(withNames && { expressConfig: { enabled: !!queue.express?.enabled, price: queue.express?.price ?? 0, perHour: queue.express?.perHour ?? 2 } }),
    current: current ? servingPub(current) : null,
    serving: serving.map(servingPub),
    waiting: waiting.map((t) => ({ ...pub(t), createdAt: t.createdAt })),
  };
  if (withNames) {
    // today's skipped tokens, so staff can recall a no-show
    const skipped = await Token.find({ queue: queue._id, status: 'skipped', doneAt: { $gte: startOfToday() } }).sort('-doneAt').limit(20).populate('user', 'name');
    state.skipped = skipped.map((t) => ({ ...pub(t), doneAt: t.doneAt }));
  }
  return state;
}

// Which push to send for a ticket right now (the kind is remembered on the token so each fires once)
function pushFor(ticket) {
  if (ticket.status === 'serving') return ['turn', "It's your turn.", `${ticket.queue.name} is now serving #${ticket.number}${ticket.queue.counters > 1 && ticket.counter ? ` at counter ${ticket.counter}` : ''}. Please go in.`];
  if (ticket.status === 'served') return ['done', 'Service completed.', 'Thanks for using QueueLess.'];
  if (ticket.status === 'skipped') return ['skipped', 'Your token was skipped.', `Ask the counter at ${ticket.queue.name} to be called again.`];
  if (ticket.status === 'waiting' && ticket.ahead === 1) return ['next', 'Your turn is next.', `Please return to ${ticket.queue.name}.`];
  if (ticket.status === 'waiting' && ticket.ahead > 1 && ticket.ahead <= 3) return ['approaching', 'Your turn is approaching.', `Only ${ticket.ahead} people are ahead of you at ${ticket.queue.name}.`];
  return null;
}

export async function broadcastQueue(io, queueId, extraTokenIds = []) {
  const queue = await Queue.findById(queueId).populate('currentToken', 'number');
  const tokens = await Token.find({ queue: queueId, $or: [{ status: { $in: ACTIVE } }, { _id: { $in: extraTokenIds } }] }).sort(ORDER);
  const waiting = tokens.filter((t) => t.status === 'waiting');
  io.to(`queue:${queueId}`).emit('queue:update', {
    queueId: String(queueId),
    name: queue.name,
    isOpen: queue.isOpen,
    avgServiceMinutes: queue.avgServiceMinutes,
    currentNumber: queue.currentToken?.number ?? null,
    serving: tokens.filter((t) => t.status === 'serving').map((t) => ({ number: t.number, counter: t.counter ?? 1 })),
    waitingNumbers: waiting.map((t) => t.number),
    etaMinutes: etaFor(queue, waiting),
  });
  for (const t of tokens) {
    const ticket = await ticketFor(t);
    io.to(`user:${t.user}`).emit('ticket:update', ticket);
    const p = pushFor(ticket);
    // fresh tokens already saw their position on the success screen; don't push "approaching" for those
    if (p && !t.pushed.includes(p[0]) && !(p[0] === 'approaching' && Date.now() - t.createdAt < 15000)) {
      await Token.updateOne({ _id: t._id }, { $addToSet: { pushed: p[0] } });
      sendPush(t.user, { title: p[1], body: p[2], url: `/t/${t._id}`, tag: `ticket-${t._id}` }).catch(() => {});
    }
  }
}

/** Auto-skip called customers who never arrived within the shop's grace period. Runs every 20s. */
export function startGraceSweeper(io) {
  const tick = async () => {
    try {
      const queues = await Queue.find({ graceMinutes: { $gt: 0 } }).select('graceMinutes counters');
      for (const q of queues) {
        // never sweep a token parked above the counter limit: advance() clamps its counter back into
        // range and would skip whoever is standing there instead. releaseStranded() owns those.
        const late = await Token.find({
          queue: q._id, status: 'serving', arrivedAt: null,
          calledAt: { $lt: new Date(Date.now() - q.graceMinutes * 60000) },
          $or: [{ counter: { $lte: q.counters || 1 } }, { counter: null }],
        });
        for (const t of late) {
          const { done } = await callNext(q._id, 'skip', t.counter ?? 1, t._id);
          if (done) await broadcastQueue(io, q._id, [done._id]);
        }
      }
    } catch (err) { console.error('grace sweeper', err); }
  };
  const timer = setInterval(tick, 20000);
  timer.unref();
  return timer;
}

// Vendor analytics: today (per hour), or the last `days` days (per day + weekday×hour heatmap), UTC
export async function queueStats(queueId, days = 1) {
  const DAY = 86400000;
  const since = days > 1 ? new Date(startOfToday() - (days - 1) * DAY) : startOfToday();
  const tokens = await Token.find({ queue: queueId, createdAt: { $gte: since } }).select('status createdAt calledAt doneAt');
  const wait = (t) => (t.calledAt - t.createdAt) / 60000;
  const agg = (list) => {
    const served = list.filter((t) => t.status === 'served');
    const waits = served.filter((t) => t.calledAt).map(wait);
    return {
      total: list.length, served: served.length,
      skipped: list.filter((t) => t.status === 'skipped').length,
      left: list.filter((t) => t.status === 'left').length,
      waiting: list.filter((t) => t.status === 'waiting').length,
      avgWaitMinutes: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : 0,
    };
  };
  const perHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }));
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0)); // [weekday][hour], Sunday = 0
  for (const t of tokens) { perHour[t.createdAt.getUTCHours()].count++; heat[t.createdAt.getUTCDay()][t.createdAt.getUTCHours()]++; }
  const byDay = Array.from({ length: days }, (_, i) => {
    const d0 = new Date(since.getTime() + i * DAY), d1 = new Date(d0.getTime() + DAY);
    return { day: d0.toISOString().slice(0, 10), ...agg(tokens.filter((t) => t.createdAt >= d0 && t.createdAt < d1)) };
  });
  return { days, since, ...agg(tokens), perHour, heat, byDay };
}
