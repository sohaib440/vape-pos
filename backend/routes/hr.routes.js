const express = require("express");
const multer = require("multer");
const path = require("path");
const { authRequired } = require("../middleware/middleware");
const hrController = require("../controllers/hrController");

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, "..", "uploads", "staff"),
    filename: (req, file, cb) => {
      const safeName = `${Date.now()}-${file.originalname.replace(/\s+/g, "-")}`;
      cb(null, safeName);
    },
  }),
});

const router = express.Router();
router.get("/employees", authRequired, hrController.listEmployees);
router.post("/employees", authRequired, upload.single("avatar"), hrController.createEmployee);
router.patch("/employees/:id", authRequired, upload.single("avatar"), hrController.updateEmployee);
router.delete("/employees/:id", authRequired, hrController.deleteEmployee);
router.get("/attendance", authRequired, hrController.getAttendanceByDate);
router.get("/leaves", authRequired, hrController.listLeaves);
router.patch("/leaves/:id/status", authRequired, hrController.patchLeaveStatus);
router.get("/leave-balances", authRequired, hrController.listLeaveBalances);
router.get("/salary", authRequired, hrController.listSalary);
router.get("/salary/payments", authRequired, hrController.listSalaryPayments);
router.get("/salary/:employeeId/history", authRequired, hrController.listSalaryHistory);
router.patch("/salary/:employeeId", authRequired, hrController.patchSalary);
router.post("/salary/:employeeId/payments", authRequired, hrController.recordSalaryPayment);
router.patch("/salary/:employeeId/mark-paid", authRequired, hrController.markSalaryPaid);
router.get("/shifts", authRequired, hrController.listShifts);

module.exports = router;
