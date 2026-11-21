import React, { useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Printer,
  Users,
  AlertTriangle,
  CheckCircle2,
  Eye,
} from 'lucide-react';
import { LEAVE_TYPE_LABELS } from '../types/leave';
import type { LeaveRequest, LeaveType, StaffPublicProfile } from '../types/leave';
import {
  formatThaiDateFull,
  formatThaiDateShort,
  formatThaiMonthYear,
  isThaiOfficialHoliday,
  toLocalIsoDate,
} from '../lib/thaiDate';

interface SharedLeaveCalendarProps {
  staffList: StaffPublicProfile[];
  leaveRequests: LeaveRequest[];
  departments: string[];
  onInspectApproval: (req: LeaveRequest) => void;
  onSelectRequestForPrint: (req: LeaveRequest) => void;
}

interface CalendarCell {
  iso: string;
  date: Date;
  dayNumber: number;
  inCurrentMonth: boolean;
  isWeekend: boolean;
  isHoliday: boolean;
  isToday: boolean;
}

const THAI_WEEKDAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'] as const;

function getCoverageTone(pct: number, onLeaveCount: number) {
  if (onLeaveCount === 0) {
    return {
      label: 'ปกติ',
      textClass: 'text-slate-600',
      barClass: 'bg-emerald-600',
      indicatorClass: 'bg-emerald-600',
    };
  }
  if (pct >= 80) {
    return {
      label: 'พร้อมบริการ',
      textClass: 'text-emerald-700',
      barClass: 'bg-emerald-600',
      indicatorClass: 'bg-emerald-600',
    };
  }
  if (pct >= 60) {
    return {
      label: 'เฝ้าระวัง',
      textClass: 'text-amber-700',
      barClass: 'bg-amber-500',
      indicatorClass: 'bg-amber-500',
    };
  }
  return {
    label: 'กำลังพลตึงตัว',
    textClass: 'text-rose-700',
    barClass: 'bg-rose-600',
    indicatorClass: 'bg-rose-600',
  };
}

function getLeaveEntryTone(leaveType: LeaveType): string {
  switch (leaveType) {
    case 'vacation':
      return 'bg-teal-50 text-teal-900 border-teal-200/70';
    case 'sick':
      return 'bg-amber-50 text-amber-900 border-amber-200/70';
    case 'personal':
      return 'bg-sky-50 text-sky-900 border-sky-200/70';
    case 'overseas':
      return 'bg-indigo-50 text-indigo-900 border-indigo-200/70';
    default:
      return 'bg-slate-100 text-slate-800 border-slate-200';
  }
}

export const SharedLeaveCalendar: React.FC<SharedLeaveCalendarProps> = ({
  staffList,
  leaveRequests,
  departments,
  onInspectApproval,
  onSelectRequestForPrint,
}) => {
  const now = useMemo(() => new Date(), []);
  const todayIso = useMemo(() => toLocalIsoDate(now), [now]);

  const [viewYear, setViewYear] = useState<number>(now.getFullYear());
  const [viewMonth, setViewMonth] = useState<number>(now.getMonth());
  const [selectedIso, setSelectedIso] = useState<string>(todayIso);
  const [deptFilter, setDeptFilter] = useState<string>('all');
  const [leaveTypeFilter, setLeaveTypeFilter] = useState<'all' | LeaveType>('all');

  const approvedRequests = useMemo(() => {
    return leaveRequests.filter((req) => {
      if (req.status !== 'approved') return false;
      if (deptFilter !== 'all' && req.department !== deptFilter) return false;
      if (leaveTypeFilter !== 'all' && req.leaveType !== leaveTypeFilter) return false;
      return true;
    });
  }, [leaveRequests, deptFilter, leaveTypeFilter]);

  const scopedActiveStaff = useMemo(() => {
    return staffList.filter((s) => {
      if (!s.isActive) return false;
      if (deptFilter !== 'all' && s.department !== deptFilter) return false;
      return true;
    });
  }, [staffList, deptFilter]);

  const totalScopedStaff = scopedActiveStaff.length;

  const calendarCells = useMemo<CalendarCell[]>(() => {
    const firstOfMonth = new Date(viewYear, viewMonth, 1);
    const lastOfMonth = new Date(viewYear, viewMonth + 1, 0);
    const startOffset = firstOfMonth.getDay(); // 0 (Sun) - 6 (Sat)
    const endOffset = 6 - lastOfMonth.getDay();
    const totalDays = startOffset + lastOfMonth.getDate() + endOffset;

    const cells: CalendarCell[] = [];
    for (let i = 0; i < totalDays; i++) {
      const dt = new Date(viewYear, viewMonth, 1 - startOffset + i);
      const iso = toLocalIsoDate(dt);
      const dayOfWeek = dt.getDay();
      cells.push({
        iso,
        date: dt,
        dayNumber: dt.getDate(),
        inCurrentMonth: dt.getMonth() === viewMonth && dt.getFullYear() === viewYear,
        isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
        isHoliday: isThaiOfficialHoliday(dt),
        isToday: iso === todayIso,
      });
    }
    return cells;
  }, [viewYear, viewMonth, todayIso]);

  const leavesByDate = useMemo(() => {
    const map: Record<string, LeaveRequest[]> = {};
    for (const cell of calendarCells) {
      map[cell.iso] = [];
    }
    for (const req of approvedRequests) {
      for (const cell of calendarCells) {
        if (req.startDate <= cell.iso && req.endDate >= cell.iso) {
          map[cell.iso].push(req);
        }
      }
    }
    return map;
  }, [calendarCells, approvedRequests]);

  const monthStats = useMemo(() => {
    const monthPrefix = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`;
    const monthStartIso = `${monthPrefix}-01`;
    const monthEndIso = toLocalIsoDate(new Date(viewYear, viewMonth + 1, 0));

    const requestsInMonth = approvedRequests.filter(
      (r) => r.startDate <= monthEndIso && r.endDate >= monthStartIso
    );

    let lowestDay: { iso: string; pct: number; onLeave: number } | null = null;
    for (const cell of calendarCells) {
      if (!cell.inCurrentMonth || cell.isWeekend || cell.isHoliday) continue;
      const dayReqs = leavesByDate[cell.iso] ?? [];
      if (dayReqs.length === 0 || totalScopedStaff === 0) continue;
      const uniqueOnLeave = new Set(dayReqs.map((r) => r.requesterUid)).size;
      const available = Math.max(0, totalScopedStaff - uniqueOnLeave);
      const pct = Math.round((available / totalScopedStaff) * 100);
      if (!lowestDay || pct < lowestDay.pct || (pct === lowestDay.pct && uniqueOnLeave > lowestDay.onLeave)) {
        lowestDay = { iso: cell.iso, pct, onLeave: uniqueOnLeave };
      }
    }

    return {
      requestCount: requestsInMonth.length,
      lowestDay,
    };
  }, [approvedRequests, calendarCells, leavesByDate, totalScopedStaff, viewYear, viewMonth]);

  const selectedDayData = useMemo(() => {
    const requests = leavesByDate[selectedIso] ?? approvedRequests.filter(
      (r) => r.startDate <= selectedIso && r.endDate >= selectedIso
    );
    const uniqueOnLeaveUids = new Set(requests.map((r) => r.requesterUid));
    const onLeaveCount = uniqueOnLeaveUids.size;
    const availableCount = Math.max(0, totalScopedStaff - onLeaveCount);
    const coveragePct =
      totalScopedStaff > 0 ? Math.round((availableCount / totalScopedStaff) * 100) : 100;

    const selectedDateObj = new Date(`${selectedIso}T00:00:00`);
    const isWeekend =
      !Number.isNaN(selectedDateObj.getTime()) &&
      (selectedDateObj.getDay() === 0 || selectedDateObj.getDay() === 6);
    const isHoliday =
      !Number.isNaN(selectedDateObj.getTime()) && isThaiOfficialHoliday(selectedDateObj);

    const deptSummary = departments
      .map((dept) => {
        const deptTotal = staffList.filter((s) => s.isActive && s.department === dept).length;
        const deptLeaveUids = new Set(
          requests.filter((r) => r.department === dept).map((r) => r.requesterUid)
        );
        const deptOnLeave = deptLeaveUids.size;
        const deptAvailable = Math.max(0, deptTotal - deptOnLeave);
        const deptPct = deptTotal > 0 ? Math.round((deptAvailable / deptTotal) * 100) : 100;
        return {
          dept,
          total: deptTotal,
          onLeave: deptOnLeave,
          available: deptAvailable,
          pct: deptPct,
        };
      })
      .filter((d) => d.onLeave > 0)
      .sort((a, b) => a.pct - b.pct || b.onLeave - a.onLeave);

    return {
      requests,
      onLeaveCount,
      availableCount,
      coveragePct,
      isWeekend,
      isHoliday,
      deptSummary,
      fullStrengthDeptCount: Math.max(0, departments.length - deptSummary.length),
    };
  }, [leavesByDate, approvedRequests, selectedIso, totalScopedStaff, departments, staffList]);

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleJumpToday = () => {
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
    setSelectedIso(todayIso);
  };

  const handleSelectCell = (cell: CalendarCell) => {
    setSelectedIso(cell.iso);
    if (!cell.inCurrentMonth) {
      setViewYear(cell.date.getFullYear());
      setViewMonth(cell.date.getMonth());
    }
  };

  const selectedTone = getCoverageTone(selectedDayData.coveragePct, selectedDayData.onLeaveCount);

  return (
    <section
      aria-label="ปฏิทินการลาและอัตรากำลังปฏิบัติงานร่วมกัน"
      className="bg-white border border-slate-200 rounded-xl overflow-hidden"
    >
      {/* Header & Controls */}
      <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            ปฏิทินการลาร่วมและอัตรากำลังปฏิบัติงานรายวัน
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            แสดงรายการลาที่ได้รับอนุมัติแล้วทั้งหมด เพื่อช่วยหัวหน้างานประเมินความพร้อมบุคลากรและผู้ปฏิบัติงานแทน
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="เลือกหน่วยงานในปฏิทิน"
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="min-h-[42px] px-3 py-2 text-xs sm:text-sm border border-slate-200 rounded-xl bg-white text-slate-700"
          >
            <option value="all">ทุกหน่วยงานในสังกัด</option>
            {departments.map((dept) => (
              <option key={dept} value={dept}>
                {dept}
              </option>
            ))}
          </select>

          <select
            aria-label="กรองประเภทการลาในปฏิทิน"
            value={leaveTypeFilter}
            onChange={(e) => setLeaveTypeFilter(e.target.value as 'all' | LeaveType)}
            className="min-h-[42px] px-3 py-2 text-xs sm:text-sm border border-slate-200 rounded-xl bg-white text-slate-700"
          >
            <option value="all">ทุกประเภทการลา</option>
            {(Object.keys(LEAVE_TYPE_LABELS) as LeaveType[]).map((lt) => (
              <option key={lt} value={lt}>
                {LEAVE_TYPE_LABELS[lt]}
              </option>
            ))}
          </select>

          {/* Month Stepper */}
          <div className="inline-flex items-center border border-slate-200 rounded-xl bg-white overflow-hidden">
            <button
              type="button"
              onClick={handlePrevMonth}
              aria-label="เดือนก่อนหน้า"
              className="min-h-[42px] min-w-[42px] flex items-center justify-center text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-3 text-xs sm:text-sm font-semibold text-slate-900 tabular-nums whitespace-nowrap shrink-0">
              {formatThaiMonthYear(viewYear, viewMonth)}
            </span>
            <button
              type="button"
              onClick={handleNextMonth}
              aria-label="เดือนถัดไป"
              className="min-h-[42px] min-w-[42px] flex items-center justify-center text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleJumpToday}
            className="min-h-[42px] px-3.5 py-2 text-xs font-medium text-teal-800 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded-xl whitespace-nowrap shrink-0 cursor-pointer"
          >
            วันนี้
          </button>
        </div>
      </div>

      {/* Month Overview & Coverage Legend Bar */}
      <div className="px-4 sm:px-5 py-2.5 bg-slate-50/70 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-2 text-xs text-slate-600">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
          <span>
            เดือนนี้มีผู้ลาอนุมัติแล้ว <strong className="text-slate-900">{monthStats.requestCount}</strong> รายการ
          </span>
          <span aria-hidden="true">·</span>
          <span>
            อัตรากำลังในขอบเขต <strong className="text-slate-900">{totalScopedStaff}</strong> คน
          </span>
          {monthStats.lowestDay && (
            <>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() => setSelectedIso(monthStats.lowestDay!.iso)}
                className="text-amber-800 hover:text-amber-950 font-medium underline underline-offset-2 cursor-pointer"
              >
                วันลาหนาแน่นสุด: {formatThaiDateShort(monthStats.lowestDay.iso)} (พร้อมปฏิบัติงาน{' '}
                {monthStats.lowestDay.pct}%)
              </button>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="w-2 h-2 rounded-xs bg-emerald-600 inline-block" aria-hidden="true" />
            พร้อมบริการ (≥80%)
          </span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="w-2 h-2 rounded-xs bg-amber-500 inline-block" aria-hidden="true" />
            เฝ้าระวัง (60–79%)
          </span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="w-2 h-2 rounded-xs bg-rose-600 inline-block" aria-hidden="true" />
            กำลังพลตึงตัว (&lt;60%)
          </span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="w-2 h-2 rounded-xs bg-slate-300 inline-block" aria-hidden="true" />
            วันหยุดราชการ
          </span>
        </div>
      </div>

      {/* Main Split: Calendar Grid + Selected Day Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
        {/* Left 8 Columns: Monthly Grid */}
        <div className="lg:col-span-8 p-3 sm:p-5">
          {/* Weekday Headers */}
          <div className="grid grid-cols-7 mb-1.5">
            {THAI_WEEKDAYS.map((day, idx) => (
              <div
                key={day}
                className={`py-1.5 text-center text-xs font-semibold ${
                  idx === 0 || idx === 6 ? 'text-slate-400' : 'text-slate-600'
                }`}
              >
                {day}
              </div>
            ))}
          </div>

          {/* Hairline Calendar Grid */}
          <div className="grid grid-cols-7 gap-px bg-slate-200 border border-slate-200 rounded-xl overflow-hidden">
            {calendarCells.map((cell) => {
              const dayReqs = leavesByDate[cell.iso] ?? [];
              const uniqueOnLeave = new Set(dayReqs.map((r) => r.requesterUid)).size;
              const available = Math.max(0, totalScopedStaff - uniqueOnLeave);
              const pct =
                totalScopedStaff > 0 ? Math.round((available / totalScopedStaff) * 100) : 100;
              const tone = getCoverageTone(pct, uniqueOnLeave);
              const isSelected = cell.iso === selectedIso;
              const isNonWorking = cell.isWeekend || cell.isHoliday;

              return (
                <button
                  key={cell.iso}
                  type="button"
                  onClick={() => handleSelectCell(cell)}
                  aria-label={`${formatThaiDateFull(cell.iso)} มีผู้ลา ${uniqueOnLeave} คน`}
                  className={`min-h-[62px] sm:min-h-[106px] p-1.5 sm:p-2 text-left flex flex-col justify-between transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 ${
                    isSelected
                      ? 'bg-teal-50/50 ring-2 ring-inset ring-teal-700'
                      : !cell.inCurrentMonth
                        ? 'bg-slate-50/70 hover:bg-slate-100/70'
                        : isNonWorking
                          ? 'bg-slate-50 hover:bg-slate-100/80'
                          : 'bg-white hover:bg-slate-50/80'
                  }`}
                >
                  {/* Top Row: Date + Coverage % */}
                  <div className="flex items-start justify-between gap-1 w-full">
                    <span
                      className={`inline-flex items-center justify-center text-xs tabular-nums leading-none ${
                        cell.isToday
                          ? 'bg-teal-700 text-white font-bold px-1.5 py-1 rounded-md'
                          : !cell.inCurrentMonth
                            ? 'text-slate-400 font-medium pt-0.5'
                            : isNonWorking
                              ? 'text-slate-500 font-medium pt-0.5'
                              : 'text-slate-800 font-semibold pt-0.5'
                      }`}
                    >
                      {cell.dayNumber}
                    </span>

                    {uniqueOnLeave > 0 ? (
                      <span
                        className={`text-[10px] sm:text-[11px] font-semibold tabular-nums leading-tight ${tone.textClass}`}
                      >
                        <span className="hidden sm:inline">{pct}%</span>
                        <span className="sm:hidden">-{uniqueOnLeave}</span>
                      </span>
                    ) : cell.isHoliday && cell.inCurrentMonth ? (
                      <span className="hidden sm:inline text-[10px] text-slate-400">หยุด</span>
                    ) : null}
                  </div>

                  {/* Desktop Leave Entries Preview (max 2 items) */}
                  <div className="hidden sm:flex flex-col gap-1 mt-1.5 w-full">
                    {dayReqs.slice(0, 2).map((req) => (
                      <div
                        key={req.requestId}
                        className={`px-1.5 py-0.5 text-[11px] leading-tight rounded-sm border truncate ${getLeaveEntryTone(
                          req.leaveType
                        )}`}
                        title={`${req.requesterName} (${LEAVE_TYPE_LABELS[req.leaveType]}) · ${req.department}`}
                      >
                        {req.requesterName.split(' ')[0]} · {LEAVE_TYPE_LABELS[req.leaveType].replace('ขออนุญาต', '')}
                      </div>
                    ))}
                    {dayReqs.length > 2 && (
                      <span className="text-[10px] font-medium text-slate-500 px-1 tabular-nums">
                        +อีก {dayReqs.length - 2} รายการ
                      </span>
                    )}
                  </div>

                  {/* Mobile Leave Count Bar */}
                  <div className="sm:hidden w-full mt-1">
                    {uniqueOnLeave > 0 && (
                      <div className="flex items-center gap-1">
                        <span className={`w-1.5 h-1.5 rounded-xs shrink-0 ${tone.indicatorClass}`} />
                        <span className={`text-[10px] font-medium tabular-nums truncate ${tone.textClass}`}>
                          ลา {uniqueOnLeave}
                        </span>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right 4 Columns: Selected Day Coverage Inspector */}
        <div className="lg:col-span-4 p-4 sm:p-5 bg-slate-50/40 flex flex-col justify-between gap-4">
          <div className="space-y-4">
            {/* Date Title & Day Type */}
            <div className="pb-3 border-b border-slate-200">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-500">
                  {selectedDayData.isHoliday
                    ? 'วันหยุดนักขัตฤกษ์ / วันหยุดราชการ'
                    : selectedDayData.isWeekend
                      ? 'วันหยุดสุดสัปดาห์'
                      : 'วันทำการราชการ'}
                </span>
                <span className={`text-xs font-semibold ${selectedTone.textClass}`}>
                  {selectedTone.label}
                </span>
              </div>
              <h4 className="text-base font-bold text-slate-900 mt-1">
                {formatThaiDateFull(selectedIso)}
              </h4>
            </div>

            {/* Coverage Ratio Meter */}
            <div className="space-y-2">
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-slate-600 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-slate-400" />
                  <span>บุคลากรพร้อมปฏิบัติงาน</span>
                </span>
                <span className="font-semibold text-slate-900 tabular-nums">
                  {selectedDayData.availableCount} / {totalScopedStaff} คน ({selectedDayData.coveragePct}%)
                </span>
              </div>
              <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-200 ${selectedTone.barClass}`}
                  style={{ width: `${selectedDayData.coveragePct}%` }}
                />
              </div>
              <p className="text-xs text-slate-500 tabular-nums">
                ได้รับอนุมัติลาในวันนี้ {selectedDayData.onLeaveCount} คน (
                {selectedDayData.requests.length} คำขอ)
              </p>
            </div>

            {/* Department Breakdown on Selected Day (only when viewing all departments & absences exist) */}
            {deptFilter === 'all' && selectedDayData.deptSummary.length > 0 && (
              <div className="pt-3 border-t border-slate-200 space-y-2">
                <p className="text-xs font-semibold text-slate-700">
                  สถานะอัตรากำลังรายหน่วยงาน
                </p>
                <div className="space-y-1.5">
                  {selectedDayData.deptSummary.map((d) => {
                    const deptTone = getCoverageTone(d.pct, d.onLeave);
                    return (
                      <div
                        key={d.dept}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="text-slate-700 truncate">{d.dept}</span>
                        <span className={`font-medium tabular-nums shrink-0 ${deptTone.textClass}`}>
                          เหลือ {d.available}/{d.total} ({d.pct}%)
                        </span>
                      </div>
                    );
                  })}
                  {selectedDayData.fullStrengthDeptCount > 0 && (
                    <p className="text-[11px] text-slate-500 tabular-nums pt-0.5">
                      และอีก {selectedDayData.fullStrengthDeptCount} หน่วยงานปฏิบัติงานครบ 100%
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Approved Leave List for Selected Date */}
            <div className="pt-3 border-t border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-slate-700">
                  รายชื่อผู้ลาที่ได้รับอนุมัติ
                </p>
                <span className="text-[11px] text-slate-500 tabular-nums">
                  {selectedDayData.requests.length} รายการ
                </span>
              </div>

              {selectedDayData.requests.length === 0 ? (
                <div className="py-8 text-center space-y-2">
                  <CheckCircle2 className="w-6 h-6 text-emerald-600 mx-auto" />
                  <p className="text-xs font-medium text-slate-700">
                    ไม่มีบุคลากรลาในวันที่เลือก
                  </p>
                  <p className="text-[11px] text-slate-500">
                    อัตรากำลังปฏิบัติงานพร้อมให้บริการเต็มจำนวน
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-200 max-h-[380px] overflow-y-auto pr-1">
                  {selectedDayData.requests.map((req) => (
                    <div key={req.requestId} className="py-3 first:pt-1 last:pb-1 space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">
                            {req.requesterName}
                          </p>
                          <p className="text-xs text-slate-500 truncate">
                            {req.requesterPosition} · {req.department}
                          </p>
                        </div>
                        <span className="text-xs font-semibold text-teal-800 whitespace-nowrap shrink-0">
                          {LEAVE_TYPE_LABELS[req.leaveType]}
                        </span>
                      </div>

                      <div className="text-xs text-slate-600 tabular-nums">
                        <span>
                          {formatThaiDateShort(req.startDate)} – {formatThaiDateShort(req.endDate)}
                        </span>
                        <span aria-hidden="true"> · </span>
                        <span>{req.workingDays} วันทำการ</span>
                      </div>

                      <p className="text-xs text-slate-600">
                        ผู้ปฏิบัติงานแทน:{' '}
                        <span className="font-medium text-slate-800">
                          {req.substituteName || 'ไม่ได้ระบุผู้แทน'}
                        </span>
                      </p>

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => onInspectApproval(req)}
                          className="min-h-[36px] px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>รายละเอียด</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onSelectRequestForPrint(req)}
                          className="min-h-[36px] px-2.5 py-1 text-xs font-medium text-teal-800 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded-lg inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          <span>พิมพ์ PDF</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {selectedDayData.coveragePct < 60 && selectedDayData.onLeaveCount > 0 && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-700" />
              <span>
                วันที่เลือกมีอัตรากำลังปฏิบัติงานต่ำกว่า 60% กรุณาตรวจสอบการจัดผู้ปฏิบัติงานแทนในแต่ละจุดบริการ
              </span>
            </div>
          )}

          {selectedDayData.coveragePct >= 60 && (
            <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="w-3.5 h-3.5" />
                อัปเดตเรียลไทม์จากฐานข้อมูลการลา
              </span>
              <span className="tabular-nums">
                {deptFilter === 'all' ? `${departments.length} หน่วยงาน` : deptFilter}
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
