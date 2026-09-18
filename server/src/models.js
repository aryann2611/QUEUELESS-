import mongoose from 'mongoose';

const { Schema } = mongoose;
const ref = (model) => ({ type: Schema.Types.ObjectId, ref: model, required: true });

export const CATEGORIES = ['medical', 'salon', 'bank', 'government', 'repair', 'other'];
export const SHOP_STATUS = ['pending', 'approved', 'suspended'];

export const User = mongoose.model('User', new Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 160 },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['user', 'staff', 'admin'], default: 'user' },
}, { timestamps: true }));

// A Queue is a business ("shop") with one live queue served by one or more counters. Shop profile fields live here too.
const queueSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  description: { type: String, default: '', maxlength: 600 },
  owner: ref('User'),
  avgServiceMinutes: { type: Number, default: 5, min: 0 },
  isOpen: { type: Boolean, default: true },
  counter: { type: Number, default: 0 },
  counterDate: String,
  currentToken: { type: Schema.Types.ObjectId, ref: 'Token', default: null }, // most recently called token
  counters: { type: Number, default: 1, min: 1, max: 20, validate: Number.isInteger }, // how many customers can be served at once
  graceMinutes: { type: Number, default: 0, min: 0, max: 60 }, // 0 = off; else a called customer who hasn't arrived is auto-skipped after this
  // paid priority tokens: a capped number per hour, never for government shops
  express: { enabled: { type: Boolean, default: false }, price: { type: Number, default: 0, min: 0 }, perHour: { type: Number, default: 2, min: 1, max: 20 } },
  status: { type: String, enum: SHOP_STATUS, default: () => (process.env.AUTO_APPROVE_SHOPS === '1' ? 'approved' : 'pending') },
  category: { type: String, enum: CATEGORIES, default: 'other' },
  phone: { type: String, default: '', maxlength: 30 },
  email: { type: String, default: '', maxlength: 160 },
  image: { type: String, default: '' }, // https URL or a small data:image/* uploaded from the vendor's device
  rating: { avg: { type: Number, default: 0 }, count: { type: Number, default: 0 } }, // denormalised from Review
  address: { street: { type: String, maxlength: 160 }, city: { type: String, maxlength: 80 }, state: { type: String, maxlength: 80 }, pincode: { type: String, maxlength: 12 } },
  hours: { open: { type: String, default: '09:00' }, close: { type: String, default: '18:00' } },
  services: [{ name: { type: String, required: true, trim: true, maxlength: 60 }, minutes: { type: Number, default: 5, min: 0 } }],
  // GeoJSON Point [lng, lat]; absent until the vendor sets a location (2dsphere index skips docs without it)
  location: {
    type: { type: String, enum: ['Point'] },
    coordinates: { type: [Number], default: undefined },
  },
}, { timestamps: true });
queueSchema.index({ location: '2dsphere' });
export const Queue = mongoose.model('Queue', queueSchema);

const tokenSchema = new Schema({
  queue: ref('Queue'),
  user: ref('User'),
  number: { type: Number, required: true },
  priority: { type: Boolean, default: false },
  service: { type: String, default: '' },
  status: { type: String, enum: ['waiting', 'serving', 'served', 'skipped', 'left'], default: 'waiting' },
  counter: Number, // which counter called it (1..counters)
  calledAt: Date,
  arrivedAt: Date, // staff confirmed the customer showed up (stops the grace timer)
  doneAt: Date,
  pushed: { type: [String], default: [] }, // push notification kinds already sent for this token
  express: { orderId: String, paymentId: String, amount: Number }, // set when the token was bought as an express slot
}, { timestamps: true });
tokenSchema.index({ queue: 1, status: 1 });
tokenSchema.index({ queue: 1, createdAt: -1 }); // analytics, sales and history are all date-range scans per shop
tokenSchema.index({ queue: 1, user: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['waiting', 'serving'] } } });
export const Token = mongoose.model('Token', tokenSchema);

const appointmentSchema = new Schema({
  queue: ref('Queue'),
  user: ref('User'),
  at: { type: Date, required: true },
  service: { type: String, default: '' },
  note: { type: String, default: '' },
  status: { type: String, enum: ['booked', 'checked_in', 'cancelled', 'completed'], default: 'booked' },
  token: { type: Schema.Types.ObjectId, ref: 'Token', default: null },
}, { timestamps: true });
appointmentSchema.index({ queue: 1, at: 1 }, { unique: true, partialFilterExpression: { status: 'booked' } });
export const Appointment = mongoose.model('Appointment', appointmentSchema);

// A Razorpay order we created for an express slot; consumed exactly once by the join that pays for it
export const ExpressOrder = mongoose.model('ExpressOrder', new Schema({
  orderId: { type: String, required: true, unique: true },
  queue: ref('Queue'),
  user: ref('User'),
  amount: { type: Number, required: true }, // paise
  used: { type: Boolean, default: false },
}, { timestamps: true }));

// Web Push subscriptions (one user may have several devices)
export const PushSubscription = mongoose.model('PushSubscription', new Schema({
  user: ref('User'),
  endpoint: { type: String, required: true, unique: true },
  keys: { p256dh: { type: String, required: true }, auth: { type: String, required: true } },
  userAgent: { type: String, default: '' },
}, { timestamps: true }));

// One review per served token, so only customers who were actually served can rate a visit
export const Review = mongoose.model('Review', new Schema({
  queue: ref('Queue'),
  user: ref('User'),
  token: { type: Schema.Types.ObjectId, ref: 'Token', required: true, unique: true },
  rating: { type: Number, required: true, min: 1, max: 5, validate: Number.isInteger },
  comment: { type: String, default: '', maxlength: 500, trim: true },
  service: { type: String, default: '' },
  reply: { text: { type: String, maxlength: 500, trim: true }, at: Date }, // the owner's public answer
}, { timestamps: true }).index({ queue: 1, createdAt: -1 }));
