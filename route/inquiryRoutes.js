const express = require("express");
const router = express.Router();

const inquiryController = require("../controller/inquiryController");
const quotationController = require("../controller/quotationController");
const validate = require("../middleware/validate");
const { protectRoute, authorizeRoles } = require("../middleware/authMiddleware");
const { createInquirySchema } = require("../validators/inquiryValidators");
const { createQuotationSchema } = require("../validators/quotationValidators");

router.use(protectRoute);

/* ========================
   CUSTOMER
======================== */
router.post("/", authorizeRoles("Customer", "Admin"), validate(createInquirySchema), inquiryController.createInquiry);
router.get("/my", authorizeRoles("Customer", "Admin"), inquiryController.getMyInquiries);
router.put("/:id/cancel", authorizeRoles("Customer", "Admin"), inquiryController.cancelInquiry);

/* ========================
   VENUE OWNER
======================== */
router.get("/owner", authorizeRoles("VenueOwner"), inquiryController.getOwnerInquiries);
router.put("/:id/decline", authorizeRoles("VenueOwner"), inquiryController.declineInquiry);
router.post(
  "/:inquiryId/quotations",
  authorizeRoles("VenueOwner"),
  validate(createQuotationSchema),
  quotationController.createQuotation
);

/* ========================
   SHARED (ownership enforced in the service)
======================== */
router.get("/:id", inquiryController.getInquiryById);

module.exports = router;
