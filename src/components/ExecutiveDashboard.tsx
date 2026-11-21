import React, { useMemo, useState } from 'react';
import {
  Search,
  Sparkles,
  Printer,
  CheckCircle2,
  Clock,
  XCircle,
  Users,
  CalendarDays,
  Database,
  ArrowRight,
  Pencil,
} from 'lucide-react';
import { EditLeaveModal } from './EditLeaveModal';
import {
  DON_PHUT_DEPARTMENTS,
  LEAVE_STATUS_LABELS,
  LEAVE_TYPE_LABELS,
} from '../types/leave';
import type {
  AiExecutiveInsightResult,
  LeaveRequest,
  LeaveStatus,
  StaffPublicProfile,
  SystemSettings,
} from '../types/leave';
import { formatThaiDateShort, getCurrentFiscalYear } from '../lib/thaiDate';

interface ExecutiveDashboardProps {
  currentStaff: StaffPublicProfile;
  staffList: StaffPublicProfile[];
  leaveRequests: LeaveRequest[];
  departments?: string[];
  systemSettings?: SystemSettings | null;
  loading: boolean;
  isAdmin: boolean;
  onSeedSampleData: () => Promise<void>;
  onSelectRequestForPrint: (req: LeaveRequest) => void;
  onNavigateTab: (
    tab: 'dashboard' | 'apply' | 'approvals' | 'record_card' | 'personnel' | 'admin'
  ) => void;
  onInspectApproval: (req: LeaveRequest) => void;
  getIdToken: () => Promise<string | null>;
}

export const ExecutiveDashboard: React.FC<ExecutiveDashboardProps> = ({
  currentStaff,
  staffList,
  leaveRequests,
  departments,
  systemSettings,
  loading,
  isAdmin,
  onSeedSampleData,
  onSelectRequestForPrint,
  onNavigateTab,
  onInspectApproval,
  getIdToken,
}) => {
  const activeDepartments = departments?.length ? departments : [...DON_PHUT_DEPARTMENTS];
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | LeaveStatus>('all');
  const [deptFilter, setDeptFilter] = useState<string>('all');
  const [fiscalFilter, setFiscalFilter] = useState<number>(
    systemSettings?.activeFiscalYear ?? getCurrentFiscalYear()
  );
  const [seeding, setSeeding] = useState(false);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiInsight, setAiInsight] = useState<AiExecutiveInsightResult | null>(null);
  const [editingRequest, setEditingRequest] = useState<LeaveRequest | null>(null);
  const [editBanner, setEditBanner] = useState('');

  const isVerifierOrAbove =
    isAdmin || ['verifier', 'supervisor', 'executive', 'admin'].includes(currentStaff.role);

  const canEditRequest = (req: LeaveRequest) => {
    if (isAdmin) return true;
    const isPending = req.status === 'pending_verifier' || req.status === 'pending_supervisor';
    if (!isPending) return false;
    return req.requesterUid === currentStaff.uid || isVerifierOrAbove;
  };

  const todayIso = new Date().toISOString().slice(0, 10);

  const fiscalRequests = useMemo(
    () => leaveRequests.filter((r) => r.fiscalYear === fiscalFilter),
    [leaveRequests, fiscalFilter]
  );

  const stats = useMemo(() => {
    const pendingCount = fiscalRequests.filter(
      (r) => r.status === 'pending_verifier' || r.status === 'pending_supervisor'
    ).length;
    const onLeaveToday = fiscalRequests.filter(
      (r) => r.status === 'approved' && r.startDate <= todayIso && r.endDate >= todayIso
    ).length;
    const approvedDays = fiscalRequests
      .filter((r) => r.status === 'approved')
      .reduce((sum, r) => sum + (Number(r.workingDays) || 0), 0);
    const activeStaffCount = staffList.filter((s) => s.isActive).length || 1;
    const readinessPct = Math.max(
      0,
      Math.round(((activeStaffCount - onLeaveToday) / activeStaffCount) * 100)
    );

    const byDepartment = activeDepartments.map((dept) => {
      const deptReqs = fiscalRequests.filter(
        (r) => r.department === dept && r.status === 'approved'
      );
      const totalDays = deptReqs.reduce((s, r) => s + (Number(r.workingDays) || 0), 0);
      const staffCount = staffList.filter((s) => s.department === dept && s.isActive).length;
      return { dept, totalDays, requestCount: deptReqs.length, staffCount };
    });

    const byLeaveType = (
      ['vacation', 'sick', 'personal', 'overseas', 'maternity', 'ordination', 'other'] as const
    ).map((type) => {
      const matched = fiscalRequests.filter(
        (r) => r.leaveType === type && r.status !== 'cancelled' && r.status !== 'rejected'
      );
      return {
        type,
        label: LEAVE_TYPE_LABELS[type],
        count: matched.length,
        days: matched.reduce((s, r) => s + (Number(r.workingDays) || 0), 0),
      };
    });

    return {
      pendingCount,
      onLeaveToday,
      approvedDays,
      activeStaffCount,
      readinessPct,
      byDepartment,
      byLeaveType,
    };
  }, [fiscalRequests, staffList, todayIso, activeDepartments]);

  const filteredRequests = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return fiscalRequests.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (deptFilter !== 'all' && r.department !== deptFilter) return false;
      if (q) {
        const hay = `${r.requesterName} ${r.requesterPosition} ${r.department} ${r.documentNo ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [fiscalRequests, statusFilter, deptFilter, searchQuery]);

  const maxDeptDays = Math.max(1, ...stats.byDepartment.map((d) => d.totalDays));

  const handleGenerateAiBriefing = async () => {
    setAiLoading(true);
    setAiError('');
    try {
      const token = await getIdToken();
      if (!token) throw new Error('กรุณาเข้าสู่ระบบใหม่อีกครั้ง');
      const res = await fetch('/api/ai/executive-insights', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          summaryStats: {
            fiscalYear: fiscalFilter,
            totalActiveStaff: stats.activeStaffCount,
            pendingApprovals: stats.pendingCount,
            onLeaveToday: stats.onLeaveToday,
            readinessPct: stats.readinessPct,
            totalApprovedDays: stats.approvedDays,
            departmentBreakdown: stats.byDepartment,
            leaveTypeBreakdown: stats.byLeaveType,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'ไม่สามารถวิเคราะห์สถิติได้');
      }
      setAiInsight(data as AiExecutiveInsightResult);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการวิเคราะห์ AI');
    } finally {
      setAiLoading(false);
    }
  };

  const handleSeed = async () => {
    setSeeding(true);
    try {
      await onSeedSampleData();
    } finally {
      setSeeding(false);
    }
  };

  const renderStatusLabel = (status: LeaveStatus) => {
    switch (status) {
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            {LEAVE_STATUS_LABELS[status]}
          </span>
        );
      case 'rejected':
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-700">
            <XCircle className="w-3.5 h-3.5 shrink-0" />
            {LEAVE_STATUS_LABELS[status]}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
            <Clock className="w-3.5 h-3.5 shrink-0" />
            {LEAVE_STATUS_LABELS[status]}
          </span>
        );
    }
  };

  const myRemainingVacation = Math.max(
    0,
    currentStaff.accumulatedVacationDays +
      currentStaff.annualVacationQuota -
      currentStaff.usedVacationDays
  );

  return (
    <div className="space-y-6">
      {/* Executive Header Strip */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-slate-500">
            ปีงบประมาณ พ.ศ. {fiscalFilter} · {currentStaff.department}
          </p>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight mt-0.5">
            แดชบอร์ดสถิติการลาและติดตามอัตรากำลังบุคลากร
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="เลือกปีงบประมาณ"
            value={fiscalFilter}
            onChange={(e) => setFiscalFilter(Number(e.target.value))}
            className="min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white text-slate-700 tabular-nums"
          >
            {[getCurrentFiscalYear() + 1, getCurrentFiscalYear(), getCurrentFiscalYear() - 1].map(
              (fy) => (
                <option key={fy} value={fy}>
                  ปีงบประมาณ {fy}
                </option>
              )
            )}
          </select>

          {isAdmin && leaveRequests.length === 0 && (
            <button
              type="button"
              onClick={handleSeed}
              disabled={seeding}
              className="min-h-[44px] px-4 py-2 text-sm font-medium text-teal-800 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded-xl flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Database className="w-4 h-4 shrink-0" />
              <span>{seeding ? 'กำลังนำเข้าข้อมูล...' : 'โหลดข้อมูลตัวอย่าง สสอ.ดอนพุด'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => onNavigateTab('apply')}
            className="min-h-[44px] px-4 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-xl flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <CalendarDays className="w-4 h-4 shrink-0" />
            <span>ยื่นใบลาใหม่</span>
          </button>
        </div>
      </div>

      {/* 4-Column Executive KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">คำขอรอพิจารณาอนุมัติ</p>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums">
              {stats.pendingCount}
            </span>
            <button
              type="button"
              onClick={() => onNavigateTab('approvals')}
              className="text-xs font-medium text-teal-700 hover:text-teal-800 inline-flex items-center gap-1 whitespace-nowrap"
            >
              ตรวจสอบ
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-1">ส่งแจ้งเตือน Telegram แบบเรียลไทม์</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">บุคลากรลาวันนี้</p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums">
              {stats.onLeaveToday}
            </span>
            <span className="text-xs text-slate-500 tabular-nums">
              / {stats.activeStaffCount} คน
            </span>
          </div>
          <p className="text-xs text-emerald-700 font-medium mt-1 tabular-nums">
            ความพร้อมบริการ {stats.readinessPct}%
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">วันลาที่อนุมัติรวม (ปี {fiscalFilter})</p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums">
              {stats.approvedDays}
            </span>
            <span className="text-xs text-slate-500">วันทำการ</span>
          </div>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            จากคำขอทั้งหมด {fiscalRequests.length} รายการ
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">สิทธิลาพักผ่อนคงเหลือของคุณ</p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-bold text-teal-700 tabular-nums">
              {myRemainingVacation}
            </span>
            <span className="text-xs text-slate-500">วันทำการ</span>
          </div>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            สะสม {currentStaff.accumulatedVacationDays} + ปีนี้ {currentStaff.annualVacationQuota} · ใช้แล้ว{' '}
            {currentStaff.usedVacationDays}
          </p>
        </div>
      </div>

      {/* Analytics + AI Executive Briefing Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Department & Leave Type Breakdown */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 sm:p-6 flex flex-col justify-between space-y-6">
          <div>
            <div className="flex items-center justify-between gap-2 pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  สถิติวันลาแยกตามหน่วยงานในสังกัด
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  นับเฉพาะวันทำการของคำขอที่ได้รับอนุมัติในปีงบประมาณ {fiscalFilter}
                </p>
              </div>
              <Users className="w-4 h-4 text-slate-400 shrink-0" />
            </div>

            <div className="mt-4 space-y-3.5">
              {stats.byDepartment.map((item) => {
                const widthPct = Math.round((item.totalDays / maxDeptDays) * 100);
                return (
                  <div key={item.dept} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-800 truncate">{item.dept}</span>
                      <span className="text-slate-600 tabular-nums shrink-0">
                        {item.totalDays} วัน · {item.requestCount} ครั้ง · {item.staffCount} คน
                      </span>
                    </div>
                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-teal-600 rounded-full transition-all duration-300"
                        style={{ width: `${Math.max(item.totalDays > 0 ? 6 : 0, widthPct)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100">
            <p className="text-xs font-medium text-slate-500 mb-3">แยกตามประเภทการลา</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {stats.byLeaveType.slice(0, 4).map((lt) => (
                <div key={lt.type} className="border border-slate-200 rounded-lg p-3">
                  <p className="text-xs text-slate-500 truncate">{lt.label}</p>
                  <p className="text-lg font-semibold text-slate-900 tabular-nums mt-0.5">
                    {lt.days} <span className="text-xs font-normal text-slate-500">วัน</span>
                  </p>
                  <p className="text-[11px] text-slate-500 tabular-nums">{lt.count} รายการ</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* AI Executive Briefing */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 sm:p-6 flex flex-col justify-between space-y-4">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3 pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  AI วิเคราะห์สถิติสำหรับผู้บริหาร
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  ประมวลผลภาพรวมอัตรากำลังแบบไม่เปิดเผยข้อมูลส่วนบุคคล
                </p>
              </div>
              <Sparkles className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
            </div>

            {aiError && (
              <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">
                {aiError}
              </div>
            )}

            {aiInsight ? (
              <div className="space-y-3 text-sm">
                <p className="font-semibold text-slate-900">{aiInsight.headline}</p>
                <p className="text-slate-600 text-xs leading-relaxed">{aiInsight.executiveSummary}</p>

                {aiInsight.highlights.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-slate-800">ประเด็นสำคัญ</p>
                    <ul className="space-y-1 text-xs text-slate-600 list-disc pl-4">
                      {aiInsight.highlights.map((h, i) => (
                        <li key={i}>{h}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {aiInsight.recommendations.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-teal-800">ข้อเสนอแนะเชิงบริหาร</p>
                    <ul className="space-y-1 text-xs text-slate-600 list-disc pl-4">
                      {aiInsight.recommendations.map((rec, i) => (
                        <li key={i}>{rec}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="py-6 text-center space-y-2">
                <p className="text-sm text-slate-600">
                  กดปุ่มด้านล่างเพื่อให้ AI สรุปแนวโน้มการลาและความพร้อมอัตรากำลังของ รพ.สต. ทั้ง 6 แห่งและ สสอ.ดอนพุด
                </p>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleGenerateAiBriefing}
            disabled={aiLoading}
            className="w-full min-h-[44px] px-4 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-sm font-medium rounded-xl flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <Sparkles className="w-4 h-4 shrink-0" />
            <span>{aiLoading ? 'กำลังวิเคราะห์ข้อมูลสถิติ...' : 'สร้างบทสรุปผู้บริหารด้วย AI'}</span>
          </button>
        </div>
      </div>

      {/* Leave Requests Directory & Quick PDF Print */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">รายการคำขอการลาทั้งหมด</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              กรองตามสถานะหรือหน่วยงาน และสั่งพิมพ์แบบฟอร์มราชการเป็น PDF ได้ทันที
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ค้นหาชื่อ ตำแหน่ง หรือเลขที่หนังสือ..."
                className="w-full sm:w-64 min-h-[44px] pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <select
              aria-label="กรองตามหน่วยงาน"
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white text-slate-700"
            >
              <option value="all">ทุกหน่วยงานในสังกัด</option>
              {activeDepartments.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
          </div>
        </div>

        {editBanner && (
          <div className="mx-4 sm:mx-5 mt-4 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center justify-between gap-2">
            <span>{editBanner}</span>
            <button
              type="button"
              onClick={() => setEditBanner('')}
              className="text-emerald-700 underline cursor-pointer"
            >
              ปิด
            </button>
          </div>
        )}

        {/* Interactive Segmented Filter Controls */}
        <div className="px-4 sm:px-5 py-3 bg-slate-50/70 border-b border-slate-100 flex items-center gap-1.5 overflow-x-auto">
          {(
            [
              { id: 'all', label: 'ทั้งหมด' },
              { id: 'pending_verifier', label: 'รอตรวจสอบ' },
              { id: 'pending_supervisor', label: 'รออนุมัติ' },
              { id: 'approved', label: 'อนุญาตแล้ว' },
              { id: 'rejected', label: 'ไม่อนุญาต' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`min-h-[40px] px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                statusFilter === tab.id
                  ? 'bg-white text-slate-900 border border-slate-200 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-slate-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-sm font-medium text-slate-800">ไม่พบรายการคำขอการลาที่ตรงตามเงื่อนไข</p>
            <p className="text-xs text-slate-500">
              คุณสามารถยื่นคำขอลาใหม่ หรือโหลดข้อมูลตัวอย่างของ สสอ.ดอนพุด เพื่อทดสอบระบบ
            </p>
            <div className="flex justify-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => onNavigateTab('apply')}
                className="min-h-[44px] px-4 py-2 bg-teal-700 text-white text-sm font-medium rounded-xl hover:bg-teal-800 transition-colors"
              >
                ยื่นใบลาใหม่
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                    <th className="py-3 px-4">บุคลากร / หน่วยงาน</th>
                    <th className="py-3 px-4">ประเภทการลา</th>
                    <th className="py-3 px-4">ช่วงวันที่ลา</th>
                    <th className="py-3 px-4 text-right">วันทำการ</th>
                    <th className="py-3 px-4">สถานะ</th>
                    <th className="py-3 px-4 text-right">จัดการ / พิมพ์ PDF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredRequests.map((req) => (
                    <tr key={req.requestId} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4">
                        <p className="font-medium text-slate-900">{req.requesterName}</p>
                        <p className="text-xs text-slate-500">
                          {req.requesterPosition} · {req.department}
                        </p>
                      </td>
                      <td className="py-3 px-4">
                        <p className="text-slate-800 font-medium">
                          {LEAVE_TYPE_LABELS[req.leaveType]}
                        </p>
                        {req.substituteName && (
                          <p className="text-xs text-slate-500">แทน: {req.substituteName}</p>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-700 tabular-nums">
                        {formatThaiDateShort(req.startDate)} – {formatThaiDateShort(req.endDate)}
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-slate-900 tabular-nums">
                        {req.workingDays}
                      </td>
                      <td className="py-3 px-4">{renderStatusLabel(req.status)}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => onInspectApproval(req)}
                            className="min-h-[38px] px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-100 rounded-lg whitespace-nowrap cursor-pointer"
                          >
                            รายละเอียด
                          </button>
                          {canEditRequest(req) && (
                            <button
                              type="button"
                              onClick={() => setEditingRequest(req)}
                              className="min-h-[38px] px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-100 rounded-lg inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              <span>แก้ไข</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onSelectRequestForPrint(req)}
                            className="min-h-[38px] px-3 py-1.5 text-xs font-medium text-teal-800 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            <span>พิมพ์ PDF</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card List (Touch-First >= 44px targets) */}
            <div className="md:hidden divide-y divide-slate-100">
              {filteredRequests.map((req) => (
                <div key={req.requestId} className="p-4 space-y-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{req.requesterName}</p>
                      <p className="text-xs text-slate-500">
                        {req.department} · {LEAVE_TYPE_LABELS[req.leaveType]}
                      </p>
                    </div>
                    <span className="text-sm font-bold text-slate-900 tabular-nums shrink-0">
                      {req.workingDays} วัน
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span className="tabular-nums">
                      {formatThaiDateShort(req.startDate)} – {formatThaiDateShort(req.endDate)}
                    </span>
                    {renderStatusLabel(req.status)}
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => onInspectApproval(req)}
                      className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-xl"
                    >
                      ดู/อนุมัติ
                    </button>
                    {canEditRequest(req) && (
                      <button
                        type="button"
                        onClick={() => setEditingRequest(req)}
                        className="min-h-[44px] px-3 py-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-xl inline-flex items-center justify-center gap-1"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>แก้ไข</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onSelectRequestForPrint(req)}
                      className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium text-teal-800 bg-teal-50 border border-teal-200 rounded-xl flex items-center justify-center gap-1.5"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>พิมพ์ PDF</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {editingRequest && (
        <EditLeaveModal
          request={editingRequest}
          currentStaff={currentStaff}
          staffList={staffList}
          departments={activeDepartments}
          isAdmin={isAdmin}
          onClose={() => setEditingRequest(null)}
          onSaved={(msg) => {
            setEditingRequest(null);
            setEditBanner(msg);
          }}
        />
      )}
    </div>
  );
};
