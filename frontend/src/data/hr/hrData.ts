export interface Employee {
  id: string;
  employeeId: string;
  name: string;
  phone: string;
  email: string;
  role: string;
  department: string;
  joinDate: string;
  salary: number;
  status: 'active' | 'inactive';
  avatar?: string;
}

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  date: string;
  checkIn?: string;
  checkOut?: string;
  status: 'present' | 'absent' | 'late' | 'half-day' | 'leave';
  hoursWorked: number;
  lateMinutes: number;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  type: 'sick' | 'casual' | 'annual' | 'emergency';
  startDate: string;
  endDate: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  appliedOn: string;
}

export type PayrollStatus = 'pending' | 'partial' | 'paid';
export type SalaryPaymentType = 'salary' | 'advance';

export interface SalaryPayment {
  id: string;
  employeeId: string;
  employeeName?: string;
  employeeRole?: string;
  employeeCode?: string;
  amount: number;
  type: SalaryPaymentType;
  forMonth: string;
  paidOn: string;
  note?: string;
}

export interface SalaryRecord {
  id: string;
  employeeId: string;
  employeeName?: string;
  employeeRole?: string;
  employeeCode?: string;
  month: string;
  baseSalary: number;
  bonus: number;
  deductions: number;
  lateFines: number;
  netSalary: number;
  paidAmount?: number;
  remaining?: number;
  extraPaid?: number;
  advanceGiven?: number;
  advanceCredit?: number;
  advanceDetails?: { forMonth: string; amount: number }[];
  arrears?: number;
  status: PayrollStatus;
  paidOn?: string;
}

export interface PayrollSummary {
  due: number;
  paid: number;
  remaining: number;
  advances: number;
  arrears: number;
}

export interface SalaryHistoryResponse {
  items: SalaryRecord[];
  payments: SalaryPayment[];
}

export interface LeaveBalance {
  employeeId: string;
  sick: number;
  casual: number;
  annual: number;
  emergency: number;
}

export interface ShiftBlock {
  id: string;
  label: string;
  start: string;
  end: string;
  supervisorName: string;
  staffCount: number;
  notes?: string;
}
