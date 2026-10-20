const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const User = require("../model/user");
const Venue = require("../model/venue");
const Space = require("../model/space");
const Notification = require("../model/notification");
const RefreshToken = require("../model/refreshToken");
const VenueApplication = require("../model/venueApplication");
const AppError = require("../utils/AppError");
const logger = require("../utils/logger");
const sendEmail = require("../utils/sendEmail");
const { cloudinary } = require("../middleware/uploadMiddleware");

const SETUP_LINK_DAYS = 7;
const MIN_PHOTOS = 3;
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");
const frontend = () => (process.env.FRONTEND_URL || "http://localhost:5173").trim().replace(/\/$/, "");
const escapeHtml = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Email must never decide whether a request succeeds: a failure is logged and the work goes on.
const notify = async (to, subject, html) => {
  try {
    await sendEmail({ to, subject, html });
    return true;
  } catch (error) {
    logger.error(`Application email to ${to} failed: ${error.message}`);
    return false;
  }
};

const shell = (body) =>
  `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1208;line-height:1.55">${body}<p style="margin-top:32px;color:#6b5f4a;font-size:13px">Venure</p></div>`;

const discardFiles = async (files = []) => {
  await Promise.all(
    files.map((f) =>
      cloudinary.uploader
        .destroy(f.filename, { resource_type: "image", ...(f.type ? { type: f.type } : {}) })
        .catch((e) => logger.warn(`Could not remove uploaded file ${f.filename}: ${e.message}`))
    )
  );
};

/** Every uploaded file, for cleanup when the request is refused. */
const allUploads = (files = {}) => [
  ...(files.applicationPhotos ?? []).map((f) => ({ filename: f.filename })),
  ...["registrationCert", "panCert"].flatMap((k) => (files[k] ?? []).map((f) => ({ filename: f.filename, type: "authenticated" }))),
];

const toDocument = (file) => ({
  publicId: file.filename,
  originalName: String(file.originalname || "document").slice(0, 200),
  mimeType: file.mimetype,
  size: file.size ?? 0,
});

/* ================= APPLICANT ================= */

const submitApplication = async (data, files = {}) => {
  const photos = files.applicationPhotos ?? [];
  const registration = files.registrationCert?.[0];
  const pan = files.panCert?.[0];
  if (photos.length < MIN_PHOTOS) throw new AppError(`Add at least ${MIN_PHOTOS} photos of the venue`, 400);
  if (!registration) throw new AppError("Upload your business registration certificate", 400);
  if (!pan) throw new AppError("Upload your PAN certificate", 400);

  if (await User.exists({ email: { $eq: String(data.email) } })) {
    throw new AppError("This email already has an account. Sign in, or apply with a different email.", 409);
  }

  let application;
  try {
    application = await VenueApplication.create({
      venueName: data.venueName,
      venueType: data.venueType,
      about: data.about,
      email: data.email,
      phone: data.phone,
      contactName: data.contactName,
      location: { province: data.province, city: data.city, area: data.area },
      mapLink: data.mapLink,
      coordinates: data.coordinates ?? undefined,
      halls: data.halls,
      photos: photos.map((f) => ({ filename: f.filename, url: f.path })),
      registrationCert: toDocument(registration),
      panCert: toDocument(pan),
      panNumber: data.panNumber,
    });
  } catch (error) {
    if (error.code === 11000) {
      throw new AppError("An application for this email is already being reviewed. We will write to you soon.", 409);
    }
    throw error;
  }

  // Not awaited: the applicant should not wait on the mail server, and a failure only costs a courtesy email
  notify(
    application.email,
    "We received your venue application",
    shell(
      `<h2 style="font-weight:normal">Thank you, ${escapeHtml(application.contactName)}.</h2>
       <p>We received the application for <strong>${escapeHtml(application.venueName)}</strong>. Our team is checking your documents now.</p>
       <p>You do not need to do anything yet. If we need something, we will write to this address. When the application is approved, we will send you a link to choose your password, and you can sign in with this email.</p>`
    )
  );
  logger.info(`Venue application submitted: ${application._id}`);
  return application;
};

// "available", "has_account" (sign in instead) or "pending" (an application for it is already being reviewed)
const checkEmail = async (email) => {
  const address = String(email);
  if (await User.exists({ email: { $eq: address } })) return "has_account";
  if (await VenueApplication.exists({ email: { $eq: address }, status: "pending" })) return "pending";
  return "available";
};

/* ================= ADMIN ================= */

const listApplications = async ({ status, page = 1, limit = 10 }) => {
  const query = status ? { status } : {};
  const [items, total, pending] = await Promise.all([
    VenueApplication.find(query)
      .select("venueName venueType email phone contactName location status createdAt halls")
      .sort("-createdAt")
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    VenueApplication.countDocuments(query),
    VenueApplication.countDocuments({ status: "pending" }),
  ]);
  return { items, total, pending, page, pages: Math.max(1, Math.ceil(total / limit)) };
};

const getApplication = async (id) => {
  const application = await VenueApplication.findById(id).populate("reviewedBy", "name").lean();
  if (!application) throw new AppError("Application not found", 404);
  let setupPending = false;
  if (application.status === "approved" && application.owner) {
    setupPending = !!(await User.exists({ _id: application.owner, passwordSetupPending: true }));
  }
  return { ...application, setupPending };
};

const getDocumentLink = async (id, kind) => {
  if (!["registrationCert", "panCert"].includes(kind)) throw new AppError("File not found", 404);
  const application = await VenueApplication.findById(id).select(`+${kind}.publicId`);
  if (!application) throw new AppError("Application not found", 404);
  const doc = application[kind];
  const format = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" }[doc.mimeType] || "pdf";
  return cloudinary.utils.private_download_url(doc.publicId, format, {
    resource_type: "image",
    type: "authenticated",
    expires_at: Math.floor(Date.now() / 1000) + 5 * 60,
  });
};

const notPending = async (id) => {
  const exists = await VenueApplication.exists({ _id: id });
  return exists ? new AppError("This application has already been decided", 409) : new AppError("Application not found", 404);
};

const rejectApplication = async (id, reason, adminId) => {
  const application = await VenueApplication.findOneAndUpdate(
    { _id: id, status: "pending" },
    { status: "rejected", reviewNote: reason, reviewedBy: adminId, reviewedAt: new Date() },
    { new: true }
  );
  if (!application) throw await notPending(id);
  await notify(
    application.email,
    "About your venue application",
    shell(
      `<h2 style="font-weight:normal">We could not approve ${escapeHtml(application.venueName)} yet.</h2>
       <p>${escapeHtml(reason).replace(/\n/g, "<br>")}</p>
       <p>You are welcome to apply again with the details corrected, using the same email.</p>`
    )
  );
  return application;
};

// A fresh one-time link for the owner to choose a password, emailed to them. Any earlier link stops working.
// Returns whether the email went out: the admin is told when it did not, because this email is the owner's only way in.
const issueSetupLink = async (application) => {
  const setupToken = crypto.randomBytes(32).toString("hex");
  await VenueApplication.updateOne(
    { _id: application._id },
    { setupTokenHash: hashToken(setupToken), setupTokenExpires: new Date(Date.now() + SETUP_LINK_DAYS * 24 * 60 * 60 * 1000) }
  );
  const link = `${frontend()}/set-password?token=${setupToken}`;
  return notify(
    application.email,
    "Your venue is approved. Choose your password",
    shell(
      `<h2 style="font-weight:normal">${escapeHtml(application.venueName)} is approved.</h2>
       <p>Choose a password to open your Venure owner account. This link works once and expires in ${SETUP_LINK_DAYS} days.</p>
       <p><a href="${link}" style="display:inline-block;background:#8a6a1f;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none">Choose my password</a></p>
       <p style="font-size:13px;color:#6b5f4a">If the button does not work, copy this address into your browser:<br>${link}</p>
       <p>After that, sign in with <strong>${escapeHtml(application.email)}</strong> and the password you chose.</p>`
    )
  );
};

const resendSetupLink = async (id) => {
  const application = await VenueApplication.findOne({ _id: id, status: "approved" });
  if (!application) throw new AppError("Only an approved application has a link to send", 404);
  const owner = await User.findOne({ _id: application.owner, passwordSetupPending: true, isDeleted: { $ne: true } }).select("_id");
  if (!owner) throw new AppError("This owner has already chosen a password", 409);
  return { emailed: await issueSetupLink(application) };
};

const approveApplication = async (id, adminId) => {
  // Claim it first: of two admins clicking at once, only one gets past this line.
  const claimed = await VenueApplication.findOneAndUpdate(
    { _id: id, status: "pending" },
    { status: "approved", reviewedBy: adminId, reviewedAt: new Date() },
    { new: true }
  );
  if (!claimed) throw await notPending(id);

  const created = { user: null, venue: null };
  try {
    if (await User.exists({ email: claimed.email })) {
      throw new AppError("An account with this email was created since the application was sent. Reject it, or ask the applicant to use another email.", 409);
    }
    // No password yet: the owner chooses one from the emailed link and cannot sign in before then.
    created.user = await User.create({ name: claimed.contactName, email: claimed.email, phone: claimed.phone, role: "VenueOwner", passwordSetupPending: true });
    created.venue = await Venue.create({
      owner: created.user._id,
      venueName: claimed.venueName,
      category: claimed.venueType, // the three kinds a venue is filed under
      description: claimed.about || undefined,
      location: { address: claimed.location.area, city: claimed.location.city, state: claimed.location.province, country: "Nepal" },
      geoCoordinates: claimed.coordinates ? { type: "Point", coordinates: [claimed.coordinates.lng, claimed.coordinates.lat] } : undefined,
      contactPhone: claimed.phone.slice(0, 20),
      venueImages: claimed.photos.map((p) => ({ filename: p.filename, url: p.url })),
      status: "approved",
    });
    for (const hall of claimed.halls) {
      await Space.create({ venue: created.venue._id, name: hall.name, capacity: hall.capacity, spaceType: hall.spaceType });
    }
    claimed.owner = created.user._id;
    claimed.venue = created.venue._id;
    await claimed.save();
  } catch (error) {
    // Put everything back so the application can be approved again
    if (created.venue) {
      await Space.deleteMany({ venue: created.venue._id });
      await Venue.deleteOne({ _id: created.venue._id });
    }
    if (created.user) await User.deleteOne({ _id: created.user._id });
    await VenueApplication.updateOne(
      { _id: id },
      { status: "pending", $unset: { reviewedBy: 1, reviewedAt: 1, owner: 1, venue: 1 } }
    );
    throw error;
  }

  const emailed = await issueSetupLink(claimed);
  await Notification.create({ recipient: created.user._id, type: "approval", message: `Your venue "${claimed.venueName}" is live on Venure.` }).catch(() => {});
  logger.info(`Venue application approved: ${claimed._id}, venue ${created.venue._id}`);
  return { application: claimed, venue: created.venue, ownerId: created.user._id, emailed };
};

/* ================= OWNER: CHOOSE A PASSWORD ================= */

const expiredLink = () => new AppError("This link has expired or was already used. Ask us to send a new one.", 400);

const setupPassword = async (token, password) => {
  const application = await VenueApplication.findOne({
    setupTokenHash: hashToken(token),
    setupTokenExpires: { $gt: new Date() },
    status: "approved",
  }).select("+setupTokenHash +setupTokenExpires");
  if (!application || !application.owner) throw expiredLink();

  const hashed = await bcrypt.hash(password, 10);
  // The account must still have no password: a used link can never change an existing one
  const updated = await User.findOneAndUpdate(
    { _id: application.owner, password: { $exists: false }, isDeleted: { $ne: true } },
    { password: hashed, passwordSetupPending: false },
    { new: true }
  );
  if (!updated) throw expiredLink();

  await VenueApplication.updateOne({ _id: application._id }, { $unset: { setupTokenHash: 1, setupTokenExpires: 1 } });
  await RefreshToken.deleteMany({ userId: updated._id });
  return { email: updated.email };
};

module.exports = {
  SETUP_LINK_DAYS,
  allUploads,
  discardFiles,
  submitApplication,
  checkEmail,
  listApplications,
  getApplication,
  getDocumentLink,
  rejectApplication,
  approveApplication,
  resendSetupLink,
  setupPassword,
};
