const express = require("express");
const router = express.Router();

const inquiryController = require("../controller/inquiryController");
const quotationController = require("../controller/quotationController");
const { inquiryAttachments } = require("../middleware/uploadMiddleware");
const validate = require("../middleware/validate");
const { protectRoute, authorizeRoles } = require("../middleware/authMiddleware");
const { createInquirySchema, declineInquirySchema, cancelInquirySchema } = require("../validators/inquiryValidators");
const { createQuotationSchema } = require("../validators/quotationValidators");

router.use(protectRoute);

/* ========================
   CUSTOMER
======================== */
router.post("/", authorizeRoles("Customer", "Admin"), validate(createInquirySchema), inquiryController.createInquiry);
router.get("/my", authorizeRoles("Customer", "Admin"), inquiryController.getMyInquiries);
router.post(
  "/:id/attachments",
  authorizeRoles("Customer", "Admin"),
  inquiryController.assertCanAttach,
  inquiryAttachments(),
  inquiryController.addAttachments
);
router.delete("/:id/attachments/:attachmentId", authorizeRoles("Customer", "Admin"), inquiryController.removeAttachment);
router.put("/:id/cancel", authorizeRoles("Customer", "Admin"), validate(cancelInquirySchema), inquiryController.cancelInquiry);

/* ========================
   VENUE OWNER
======================== */
router.get("/owner", authorizeRoles("VenueOwner"), inquiryController.getOwnerInquiries);
router.put("/:id/decline", authorizeRoles("VenueOwner"), validate(declineInquirySchema), inquiryController.declineInquiry);
router.post(
  "/:inquiryId/quotations",
  authorizeRoles("VenueOwner"),
  validate(createQuotationSchema),
  quotationController.createQuotation
);

/* ========================
   SHARED (ownership enforced in the service)
======================== */
router.get("/:id/attachments/:attachmentId/link", inquiryController.getAttachmentLink);
router.get("/:id", inquiryController.getInquiryById);

module.exports = router;
