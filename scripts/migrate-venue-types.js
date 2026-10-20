/* eslint-disable no-console */
// One-off, safe to re-run: moves the old venue categories to the new model.
//
//   Before: Venue.category was one of heritage-courtyards, garden-estates, intimate-halls, mountain-retreats, rooftop-terraces.
//   After:  Venue.category is the kind of venue (banquet-party-palace, hotel-resort, heritage-traditional) and the old
//           five are the type of each SPACE (Space.spaceType). A venue also lists its kinds of space in Venue.spaceTypes.
//
// For every venue still on an old category this script
//   1. gives each of its spaces that has no type that old category as its spaceType,
//   2. files the venue under the nearest new kind (the table below; owners can change it afterwards), and
//   3. recomputes the venue's spaceTypes.
// Venues already on a new category are left alone. Run it right after deploying; take a backup first.
//
//   node scripts/migrate-venue-types.js            # uses DB_URL from the environment / .env
//   node scripts/migrate-venue-types.js --dry-run  # prints what it would do, changes nothing
const mongoose = require("mongoose");
require("dotenv").config();

const OLD_TO_NEW = {
  "heritage-courtyards": "heritage-traditional",
  "garden-estates": "banquet-party-palace",
  "intimate-halls": "banquet-party-palace",
  "mountain-retreats": "hotel-resort",
  "rooftop-terraces": "hotel-resort",
};

const run = async ({ dryRun = false } = {}) => {
  const Venue = require("../model/venue");
  const Space = require("../model/space");
  const { syncVenueCapacity } = Space;

  const report = { venues: 0, spaces: 0, skipped: 0, byOld: {} };
  const venues = await Venue.find({ category: { $in: Object.keys(OLD_TO_NEW) } }).select("_id venueName category").lean();

  for (const venue of venues) {
    report.venues += 1;
    report.byOld[venue.category] = (report.byOld[venue.category] ?? 0) + 1;
    const filter = { venue: venue._id, $or: [{ spaceType: { $exists: false } }, { spaceType: null }] };
    const untyped = await Space.countDocuments(filter);
    report.spaces += untyped;
    console.log(`${dryRun ? "[dry run] " : ""}${venue.venueName}: ${venue.category} -> ${OLD_TO_NEW[venue.category]} (${untyped} space${untyped === 1 ? "" : "s"} typed ${venue.category})`);
    if (dryRun) continue;
    await Space.updateMany(filter, { $set: { spaceType: venue.category } });
    await Venue.updateOne({ _id: venue._id }, { $set: { category: OLD_TO_NEW[venue.category] } }, { timestamps: false });
    await syncVenueCapacity(venue._id);
  }

  // The home page cards are now the five kinds of space. Saved home page copy that still says "Venue types" /
  // "five categories" is updated; copy an admin has edited is left alone.
  const LandingContent = require("../model/landingContent");
  const landing = await LandingContent.findOne({ key: "home" }).select("content.venueTypesIntro").lean();
  const intro = landing?.content?.venueTypesIntro;
  if (intro && intro.eyebrow === "Venue types" && /^Five distinct categories/.test(intro.description ?? "")) {
    console.log(`${dryRun ? "[dry run] " : ""}home page: "Venue types" -> "Spaces"`);
    if (!dryRun) {
      await LandingContent.updateOne(
        { key: "home" },
        { $set: { "content.venueTypesIntro.eyebrow": "Spaces", "content.venueTypesIntro.description": "Five kinds of space across Nepal's finest venues, each with its own character and atmosphere." } }
      );
      require("../services/landingService").invalidate();
    }
    report.landingCopy = true;
  }

  // Venues that already had a new category but whose spaceTypes were never computed
  const stale = await Venue.find({ category: { $nin: Object.keys(OLD_TO_NEW) }, spaceTypes: { $exists: false } }).select("_id").lean();
  for (const v of stale) {
    report.skipped += 1;
    if (!dryRun) await syncVenueCapacity(v._id);
  }
  return report;
};

module.exports = { run, OLD_TO_NEW };

if (require.main === module) {
  (async () => {
    await mongoose.connect(process.env.DB_URL);
    console.log("Migrating venue types on", mongoose.connection.name);
    const report = await run({ dryRun: process.argv.includes("--dry-run") });
    console.log("Done:", JSON.stringify(report));
    await mongoose.disconnect();
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
