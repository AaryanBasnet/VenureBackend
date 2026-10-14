const express = require("express");
const router = express.Router();

const quotationController = require("../controller/quotationController");
const { protectRoute, authorizeRoles } = require("../middleware/authMiddleware");

router.use(protectRoute);

// Frontend polling target — shared by customer/owner/admin (ownership enforced in the service)
router.get("/:id", quotationController.getQuotationById);

router.put("/:id/accept", authorizeRoles("Customer", "Admin"), quotationController.acceptQuotation);
router.put("/:id/reject", authorizeRoles("Customer", "Admin"), quotationController.rejectQuotation);
router.put("/:id/withdraw", authorizeRoles("VenueOwner"), quotationController.withdrawQuotation);

module.exports = router;
