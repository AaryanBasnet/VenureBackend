const LandingContent = require("../model/landingContent");
const Venue = require("../model/venue");
const { LANDING_DEFAULTS } = require("./landingDefaults");

const KEY = "home";
const TTL_MS = 60 * 1000; // matches the Cache-Control max-age: counts are at most a minute behind

let cache = null; // { payload, expires }
let inflight = null;

const invalidate = () => {
  cache = null;
};

// Create the singleton document if missing; never overwrites edits (safe to call on every start).
const ensureSeed = async () => {
  await LandingContent.updateOne({ key: KEY }, { $setOnInsert: { key: KEY, content: LANDING_DEFAULTS } }, { upsert: true });
};

const getCategoryCounts = async () => {
  const rows = await Venue.aggregate([
    { $match: { status: "approved", isDeleted: false, category: { $ne: null } } },
    { $group: { _id: "$category", count: { $sum: 1 } } },
  ]);
  return rows.reduce((counts, row) => ({ ...counts, [row._id]: row.count }), {});
};

const build = async () => {
  let doc = await LandingContent.findOne({ key: KEY }).lean();
  if (!doc) {
    await ensureSeed();
    doc = await LandingContent.findOne({ key: KEY }).lean();
  }
  const content = doc?.content ?? LANDING_DEFAULTS;

  // A story only links to a venue that is still public; otherwise it falls back to its category
  const ids = (content.stories ?? []).map((s) => s.venueId).filter(Boolean);
  const live = ids.length
    ? new Set(
        (await Venue.find({ _id: { $in: ids }, status: "approved", isDeleted: false }).select("_id").lean()).map((v) =>
          String(v._id)
        )
      )
    : new Set();
  const stories = (content.stories ?? []).map((s) => ({
    ...s,
    venueId: s.venueId && live.has(String(s.venueId)) ? s.venueId : null,
  }));

  return {
    content: { ...content, stories },
    categoryCounts: await getCategoryCounts(),
    updatedAt: doc?.updatedAt ?? null,
  };
};

const getLanding = async () => {
  if (cache && cache.expires > Date.now()) return cache.payload;
  if (!inflight) {
    inflight = build()
      .then((payload) => {
        cache = { payload, expires: Date.now() + TTL_MS };
        return payload;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
};

const updateLanding = async (content, userId) => {
  await LandingContent.updateOne({ key: KEY }, { $set: { content, updatedBy: userId ?? null } }, { upsert: true });
  invalidate();
  return getLanding();
};

module.exports = { ensureSeed, getLanding, updateLanding, invalidate, KEY };
