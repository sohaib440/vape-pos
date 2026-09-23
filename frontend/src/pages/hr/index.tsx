import { useState, useEffect, useCallback } from 'react';
import { Users, Calendar, DollarSign, Clock, UserPlus, FileText, CheckCircle, XCircle, Search, Timer, Pencil, Trash2 } from 'lucide-react';
import {
  type Employee,
  type AttendanceRecord,
  type LeaveRequest,
  type LeaveBalance,
  type ShiftBlock,
} from '@/data/hr/hrData';
import { toast } from 'sonner';
import { api, getBackendOrigin } from '@/lib/api/api';
import { usePosRealtimeScopes } from '@/hooks/pos/use-pos-realtime';
import { PayrollTab } from './components/PayrollTab';

type Tab = 'employees' | 'attendance' | 'shifts' | 'leaves' | 'salary';

export default function HRManagement() {
  const [tab, setTab] = useState<Tab>('employees');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [leaveBalances, setLeaveBalances] = useState<LeaveBalance[]>([]);
  const [shifts, setShifts] = useState<ShiftBlock[]>([]);
  const [search, setSearch] = useState('');
  const [showAddEmployee, setShowAddEmployee] = useState(false);

  const loadHrData = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10);
    Promise.all([
      api<{ items: Employee[] }>('/hr/employees'),
      api<{ items: AttendanceRecord[] }>(`/hr/attendance?date=${today}`),
      api<{ items: LeaveRequest[] }>('/hr/leaves'),
      api<{ items: LeaveBalance[] }>('/hr/leave-balances'),
      api<{ items: ShiftBlock[] }>('/hr/shifts'),
    ])
      .then(([employeesRes, attendanceRes, leavesRes, balancesRes, shiftsRes]) => {
        setEmployees(employeesRes.items);
        setAttendance(attendanceRes.items);
        setLeaveRequests(leavesRes.items);
        setLeaveBalances(balancesRes.items);
        setShifts(shiftsRes.items);
      })
      .catch(() => toast.error('Failed to load HR data'));
  }, []);

  useEffect(() => {
    loadHrData();
  }, [loadHrData]);

  usePosRealtimeScopes(['hr', 'dashboard'], loadHrData);

  const getEmployee = (id: string) => employees.find(e => e.id === id);

  const [newEmp, setNewEmp] = useState({ name: '', phone: '', email: '', role: '', department: 'Kitchen', salary: '', joinDate: new Date().toISOString().slice(0, 10) });
  const [newEmpAvatar, setNewEmpAvatar] = useState<File | null>(null);
  const [newEmpAvatarPreview, setNewEmpAvatarPreview] = useState('');
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const BACKEND_BASE = getBackendOrigin();
  const getAvatarUrl = (avatar?: string) => {
    if (!avatar) return '';
    return avatar.startsWith('/uploads') ? `${BACKEND_BASE}${avatar}` : avatar;
  };

  const resetNewEmployeeForm = () => {
    setNewEmp({ name: '', phone: '', email: '', role: '', department: 'Kitchen', salary: '', joinDate: new Date().toISOString().slice(0, 10) });
    setNewEmpAvatar(null);
    if (newEmpAvatarPreview.startsWith('blob:')) {
      URL.revokeObjectURL(newEmpAvatarPreview);
    }
    setNewEmpAvatarPreview('');
    setEditingEmployee(null);
  };

  const openEditEmployee = (emp: Employee) => {
    setEditingEmployee(emp);
    setNewEmp({
      name: emp.name,
      phone: emp.phone,
      email: emp.email,
      role: emp.role,
      department: emp.department,
      salary: String(emp.salary),
      joinDate: emp.joinDate || new Date().toISOString().slice(0, 10),
    });
    setNewEmpAvatar(null);
    setNewEmpAvatarPreview(emp.avatar || '');
    setShowAddEmployee(true);
  };

  const handleSaveEmployee = () => {
    if (!newEmp.name || !newEmp.role || !newEmp.salary) return;
    const formData = new FormData();
    formData.append('name', newEmp.name);
    formData.append('phone', newEmp.phone);
    formData.append('email', newEmp.email);
    formData.append('role', newEmp.role);
    formData.append('department', newEmp.department);
    formData.append('joinDate', newEmp.joinDate);
    formData.append('salary', newEmp.salary);
    if (newEmpAvatar) formData.append('avatar', newEmpAvatar);

    const request = editingEmployee
      ? api(`/hr/employees/${editingEmployee.id}`, { method: 'PATCH', body: formData })
      : api('/hr/employees', { method: 'POST', body: formData });

    request
      .then((result: Employee) => {
        if (editingEmployee) {
          setEmployees(prev => prev.map(emp => emp.id === result.id ? result : emp));
          toast.success(`${result.name} updated successfully`);
        } else {
          toast.success(`${result.name} added as ${result.role}`);
        }
      })
      .catch(() => toast.error(`Failed to ${editingEmployee ? 'update' : 'add'} employee`));

    setShowAddEmployee(false);
    resetNewEmployeeForm();
  };

  const handleDeleteEmployee = (emp: Employee) => {
    if (!confirm(`Remove ${emp.name}? This can be reversed by an admin later.`)) return;
    api(`/hr/employees/${emp.id}`, { method: 'DELETE' })
      .then(() => {
        setEmployees(prev => prev.filter(e => e.id !== emp.id));
        toast.success(`${emp.name} removed`);
      })
      .catch((err) => toast.error(err.message || 'Failed to remove employee'));
  };

  const handleLeaveAction = (id: string, action: 'approved' | 'rejected') => {
    api(`/hr/leaves/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: action }) })
      .then(() => {
        setLeaveRequests(prev => prev.map(l => l.id === id ? { ...l, status: action } : l));
        toast.success(`Leave request ${action}`);
      })
      .catch(() => toast.error('Failed to update leave request'));
  };

  const filteredEmployees = employees.filter(e => {
    const q = search.toLowerCase();
    return (e.name || '').toLowerCase().includes(q) || (e.employeeId || '').toLowerCase().includes(q);
  });

  useEffect(() => {
    return () => {
      if (newEmpAvatarPreview.startsWith('blob:')) {
        URL.revokeObjectURL(newEmpAvatarPreview);
      }
    };
  }, [newEmpAvatarPreview]);

  const todayAttendance = attendance;
  const presentCount = todayAttendance.filter(a => a.status === 'present').length;
  const lateCount = todayAttendance.filter(a => a.status === 'late').length;
  const absentCount = todayAttendance.filter(a => a.status === 'absent').length;
  const totalSalary = employees.reduce((sum, e) => sum + (e.salary || 0), 0);

  const tabs: { key: Tab; label: string; icon: typeof Users }[] = [
    { key: 'employees', label: 'Employees', icon: Users },
    { key: 'attendance', label: 'Attendance', icon: Calendar },
    { key: 'shifts', label: 'Shifts', icon: Timer },
    { key: 'leaves', label: 'Leaves', icon: FileText },
    { key: 'salary', label: 'Payroll', icon: DollarSign },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="font-serif text-xl font-bold text-foreground">HR, shifts & payroll</h1>
        <button onClick={() => { setEditingEmployee(null); resetNewEmployeeForm(); setShowAddEmployee(true); }} className="bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 hover:bg-secondary transition-colors">
          <UserPlus className="w-4 h-4" /> Add Employee
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-card rounded-2xl p-4 border border-border">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Users className="w-3.5 h-3.5" /> Total Staff</div>
          <p className="text-2xl font-bold text-foreground">{employees.length}</p>
        </div>
        <div className="bg-card rounded-2xl p-4 border border-border">
          <div className="flex items-center gap-2 text-primary text-xs mb-1"><CheckCircle className="w-3.5 h-3.5" /> Present Today</div>
          <p className="text-2xl font-bold text-primary">{presentCount}</p>
        </div>
        <div className="bg-card rounded-2xl p-4 border border-border">
          <div className="flex items-center gap-2 text-warning text-xs mb-1"><Clock className="w-3.5 h-3.5" /> Late</div>
          <p className="text-2xl font-bold text-warning">{lateCount}</p>
        </div>
        <div className="bg-card rounded-2xl p-4 border border-border">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><DollarSign className="w-3.5 h-3.5" /> Monthly Payroll</div>
          <p className="text-2xl font-bold text-foreground">Rs {totalSalary.toLocaleString()}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted rounded-xl p-1">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${tab === t.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Employees Tab */}
      {tab === 'employees' && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or ID..." className="w-full pl-9 pr-3 py-2.5 bg-card border border-border rounded-xl text-sm" />
          </div>
          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Employee</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Role</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Department</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Phone</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden xl:table-cell">Salary</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground text-sm">No employees found</td></tr>
                  )}
                  {filteredEmployees.map(emp => (
                    <tr key={emp.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg overflow-hidden bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                            {emp.avatar ? (
                              <img src={getAvatarUrl(emp.avatar)} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <span>{emp.name.split(' ').map(n => n[0]).join('')}</span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-foreground truncate">{emp.name}</p>
                            <p className="text-xs text-muted-foreground truncate">{emp.employeeId}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{emp.role}</td>
                      <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">{emp.department}</td>
                      <td className="px-4 py-3 text-muted-foreground font-mono text-xs hidden lg:table-cell">{emp.phone}</td>
                      <td className="px-4 py-3 text-muted-foreground font-mono text-xs hidden xl:table-cell">Rs {emp.salary.toLocaleString()}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${emp.status === 'active' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>{emp.status}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openEditEmployee(emp)} className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors" title="Edit">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleDeleteEmployee(emp)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" title="Remove">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Attendance Tab */}
      {tab === 'attendance' && (
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="p-4 border-b border-border">
            <h3 className="font-semibold text-foreground">Today's Attendance</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Present: {presentCount} • Late: {lateCount} • Absent: {absentCount} • On Leave: {todayAttendance.filter(a => a.status === 'leave').length}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Employee</th>
                  <th className="text-center px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="text-center px-4 py-3 font-medium text-muted-foreground">Check In</th>
                  <th className="text-center px-4 py-3 font-medium text-muted-foreground">Check Out</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Hours</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Late (min)</th>
                </tr>
              </thead>
              <tbody>
                {todayAttendance.map(a => {
                  const emp = getEmployee(a.employeeId);
                  if (!emp) return null;
                  const statusColors: Record<string, string> = {
                    present: 'bg-primary/10 text-primary', late: 'bg-warning/10 text-warning',
                    absent: 'bg-destructive/10 text-destructive', leave: 'bg-muted text-muted-foreground', 'half-day': 'bg-orange-100 text-orange-700'
                  };
                  return (
                    <tr key={a.id} className="border-b border-border/50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{emp.name}</p>
                        <p className="text-xs text-muted-foreground">{emp.role}</p>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusColors[a.status]}`}>{a.status}</span>
                      </td>
                      <td className="px-4 py-3 text-center text-muted-foreground">{a.checkIn || '—'}</td>
                      <td className="px-4 py-3 text-center text-muted-foreground">{a.checkOut || '—'}</td>
                      <td className="px-4 py-3 text-right font-medium text-foreground">{a.hoursWorked || '—'}</td>
                      <td className={`px-4 py-3 text-right font-medium ${a.lateMinutes > 0 ? 'text-warning' : 'text-muted-foreground'}`}>{a.lateMinutes || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Shifts Tab */}
      {tab === 'shifts' && (
        <div className="grid gap-3 md:grid-cols-3">
          {shifts.map(s => (
            <div key={s.id} className="bg-card rounded-2xl border border-border p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-foreground">{s.label}</h3>
                <span className="text-xs text-muted-foreground font-mono">
                  {s.start} – {s.end}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Supervisor: <span className="font-medium text-foreground">{s.supervisorName}</span>
              </p>
              <p className="text-xs text-muted-foreground">Staff on shift: {s.staffCount}</p>
              {s.notes && <p className="text-xs text-primary/80">{s.notes}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Leaves Tab */}
      {tab === 'leaves' && (
        <div className="space-y-3">
          <h3 className="font-semibold text-foreground">Leave Requests</h3>
          {leaveRequests.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No leave requests</p>
            </div>
          ) : (
            <div className="grid gap-2">
              {leaveRequests.map(lr => {
                const emp = getEmployee(lr.employeeId);
                const statusColors: Record<string, string> = { pending: 'bg-warning/10 text-warning', approved: 'bg-primary/10 text-primary', rejected: 'bg-destructive/10 text-destructive' };
                return (
                  <div key={lr.id} className="bg-card rounded-2xl border border-border p-4 flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <p className="font-medium text-foreground">{emp?.name || 'Unknown'}</p>
                      <p className="text-xs text-muted-foreground capitalize">{lr.type} leave • {lr.startDate} to {lr.endDate}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{lr.reason}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusColors[lr.status]}`}>{lr.status}</span>
                      {lr.status === 'pending' && (
                        <>
                          <button onClick={() => handleLeaveAction(lr.id, 'approved')} className="p-1.5 rounded-lg hover:bg-primary/10 text-primary"><CheckCircle className="w-4 h-4" /></button>
                          <button onClick={() => handleLeaveAction(lr.id, 'rejected')} className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive"><XCircle className="w-4 h-4" /></button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'salary' && <PayrollTab employees={employees} />}

      {/* Add Employee Modal */}
      {showAddEmployee && (
        <div className="fixed inset-0 bg-foreground/30 flex items-center justify-center z-50 p-4" onClick={() => { setShowAddEmployee(false); resetNewEmployeeForm(); }}>
          <div className="bg-card rounded-2xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-serif text-lg font-bold text-foreground">{editingEmployee ? 'Edit Employee' : 'Add Employee'}</h3>
            <p className="text-[11px] text-muted-foreground -mt-2"><span className="text-destructive">*</span> required fields</p>
            <div className="flex flex-col sm:flex-row gap-3 items-start">
              <div className="w-24 h-24 rounded-3xl border border-border bg-muted overflow-hidden flex items-center justify-center shrink-0">
                {newEmpAvatarPreview ? (
                  <img src={getAvatarUrl(newEmpAvatarPreview)} alt="Avatar preview" className="w-full h-full object-cover" />
                ) : (
                  <div className="text-center text-xs text-muted-foreground px-2">Photo</div>
                )}
              </div>
              <div className="space-y-1">
                <label className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm hover:bg-muted" htmlFor="employee-avatar-input">
                  Select photo
                  <input
                    id="employee-avatar-input"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0] ?? null;
                      if (file) {
                        if (newEmpAvatarPreview) URL.revokeObjectURL(newEmpAvatarPreview);
                        setNewEmpAvatar(file);
                        setNewEmpAvatarPreview(URL.createObjectURL(file));
                      } else {
                        setNewEmpAvatar(null);
                        setNewEmpAvatarPreview('');
                      }
                    }}
                  />
                </label>
                {newEmpAvatarPreview && (
                  <button type="button" onClick={() => { URL.revokeObjectURL(newEmpAvatarPreview); setNewEmpAvatar(null); setNewEmpAvatarPreview(''); }} className="text-[11px] text-destructive hover:underline ml-1">Remove</button>
                )}
                <p className="text-[10px] text-muted-foreground/60 ml-1">Optional</p>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground ml-1">Full Name <span className="text-destructive">*</span></label>
              <input value={newEmp.name} onChange={e => setNewEmp(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Ahmed Khan" className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground ml-1">Phone <span className="text-[10px] text-muted-foreground/60">(Optional)</span></label>
                <input value={newEmp.phone} onChange={e => setNewEmp(p => ({ ...p, phone: e.target.value }))} placeholder="03XX XXXXXXX" className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground ml-1">Email <span className="text-[10px] text-muted-foreground/60">(Optional)</span></label>
                <input value={newEmp.email} onChange={e => setNewEmp(p => ({ ...p, email: e.target.value }))} placeholder="ahmed@example.com" className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground ml-1">Role <span className="text-destructive">*</span></label>
                <select value={newEmp.role} onChange={e => setNewEmp(p => ({ ...p, role: e.target.value }))} className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm">
                  <option value="">Select role</option>
                  <option value="Waiter">Waiter</option>
                  <option value="Chef">Chef</option>
                  <option value="Head Chef">Head Chef</option>
                  <option value="Sous Chef">Sous Chef</option>
                  <option value="Line Cook">Line Cook</option>
                  <option value="Host">Host</option>
                  <option value="Manager">Manager</option>
                  <option value="Assistant Manager">Assistant Manager</option>
                  <option value="Cashier">Cashier</option>
                  <option value="Bartender">Bartender</option>
                  <option value="Busser">Busser</option>
                  <option value="Delivery">Delivery</option>
                  <option value="Supervisor">Supervisor</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground ml-1">Department</label>
                <select value={newEmp.department} onChange={e => setNewEmp(p => ({ ...p, department: e.target.value }))} className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm">
                  <option value="Kitchen">Kitchen</option>
                  <option value="Front">Front</option>
                  <option value="Management">Management</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground ml-1">Join Date</label>
                <input type="date" value={newEmp.joinDate} onChange={e => setNewEmp(p => ({ ...p, joinDate: e.target.value }))} className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground ml-1">Monthly Salary (Rs)</label>
                <input type="number" value={newEmp.salary} onChange={e => setNewEmp(p => ({ ...p, salary: e.target.value }))} placeholder="e.g. 50000" className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => { setShowAddEmployee(false); resetNewEmployeeForm(); }} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-muted">Cancel</button>
              <button onClick={handleSaveEmployee} className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-secondary">{editingEmployee ? 'Save Changes' : 'Add Employee'}</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

