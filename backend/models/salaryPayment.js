const mongoose = require("mongoose");

const salaryPaymentSchema = new mongoose.Schema(
  {
    employeeId: { type: String, required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    type: { type: String, enum: ["salary", "advance"], default: "salary" },
    forMonth: { type: String, required: true },
    paidOn: { type: String, required: true },
    note: { type: String, default: "" },
  },
  { timestamps: true }
);

salaryPaymentSchema.index({ employeeId: 1, forMonth: 1 });
salaryPaymentSchema.index({ employeeId: 1, paidOn: -1 });

module.exports = mongoose.model("SalaryPayment", salaryPaymentSchema);
