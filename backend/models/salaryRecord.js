const mongoose = require("mongoose");

const salaryRecordSchema = new mongoose.Schema(
  {
    employeeId: String,
    month: String,
    baseSalary: Number,
    bonus: Number,
    deductions: Number,
    lateFines: Number,
    netSalary: Number,
    status: { type: String, enum: ["pending", "partial", "paid"], default: "pending" },
    paidOn: String,
  },
  { timestamps: true }
);

salaryRecordSchema.index({ employeeId: 1, month: 1 }, { unique: true });
salaryRecordSchema.index({ month: -1 });

module.exports = mongoose.model("SalaryRecord", salaryRecordSchema);
