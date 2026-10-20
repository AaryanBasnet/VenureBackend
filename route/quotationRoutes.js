const express = require("express");
const router = express.Router();

const quotationController = require("../controller/quotationController");
const validate = require("../middleware/validate");
const { protectRoute, authorizeRoles } = require("../middleware/authMiddleware");
const { rejectQuotationSchema } = require("../validators/quotationValidators");

router.use(protectRoute);

// Frontend polling target — shared by customer/owner/admin (ownership enforced in the service)
router.get("/:id", quotationController.getQuotationById);

router.put("/:id/accept", authorizeRoles("Customer", "Admin"), quotationController.acceptQuotation);
router.put("/:id/reject", authorizeRoles("Customer", "Admin"), validate(rejectQuotationSchema), quotationController.rejectQuotation);
router.put("/:id/withdraw", authorizeRoles("VenueOwner"), quotationController.withdrawQuotation);

module.exports = router;
