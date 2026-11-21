import React, { useMemo, useState } from 'react';
import { Printer } from 'lucide-react';
import { formatThaiDateShort, getCurrentFiscalYear } from '../lib/thaiDate';
import type { LeaveRequest, StaffPublicProfile } from '../types/leave';

interface LeaveRecordCardViewProps {
  currentStaff: StaffPublicProfile;
  staffList: StaffPublicProfile[];
  leaveRequests: LeaveRequest[];
  onPrintRecordCard: (staff: StaffPublicProfile, fiscalYear: number, records: LeaveRequest[]) => void;
}

export const LeaveRecordCardView: React.FC<LeaveRecordCardViewProps> = ({
  currentStaff,
  staffList,
  leaveRequests,
  onPrintRecordCard,
}) => {
  const [selectedUid, setSelectedUid] = useState(currentStaff.uid);
  const [fiscalYear, setFiscalYear] = useState(getCurrentFiscalYear());

  const selectedStaff = useMemo(
    () => staffList.find((s) => s.uid === selectedUid) ?? currentStaff,
    [staffList, selectedUid, currentStaff]
  );

  const staffRecords = useMemo(
    () =>
      leaveRequests
        .filter(
          (r) =>
            r.requesterUid === selectedStaff.uid &&
            r.fiscalYear === fiscalYear &&
            r.status !== 'cancelled'
        )
        .sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [leaveRequests, selectedStaff.uid, fiscalYear]
  );

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-medium text-teal-700">ทะเบียนคุมวันลารายบุคคล</p>
          <h2 className="text-xl font-bold text-slate-900">
            บัตรบันทึกการลาของข้าราชการ ลูกจ้าง และเจ้าหน้าที่
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="เลือกบุคลากร"
            value={selectedStaff.uid}
            onChange={(e) => setSelectedUid(e.target.value)}
            className="min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white"
          >
            {staffList.map((s) => (
              <option key={s.uid} value={s.uid}>
                {s.fullName} ({s.department})
              </option>
            ))}
          </select>

          <select
            aria-label="เลือกปีงบประมาณ"
            value={fiscalYear}
            onChange={(e) => setFiscalYear(Number(e.target.value))}
            className="min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white tabular-nums"
          >
            {[getCurrentFiscalYear() + 1, getCurrentFiscalYear(), getCurrentFiscalYear() - 1].map(
              (fy) => (
                <option key={fy} value={fy}>
                  ปีงบประมาณ {fy}
                </option>
              )
            )}
          </select>

          <button
            type="button"
            onClick={() => onPrintRecordCard(selectedStaff, fiscalYear, staffRecords)}
            className="min-h-[44px] px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium rounded-xl inline-flex items-center gap-2 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>พิมพ์บัตรบันทึกการลา (PDF)</span>
          </button>
        </div>
      </div>

      {/* Record Card Preview Table */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm border-b border-slate-100 pb-4">
          <div>
            <span className="text-xs text-slate-500">ชื่อ-นามสกุล</span>
            <p className="font-semibold text-slate-900">{selectedStaff.fullName}</p>
          </div>
          <div>
            <span className="text-xs text-slate-500">ตำแหน่ง</span>
            <p className="font-semibold text-slate-900">{selectedStaff.position}</p>
          </div>
          <div>
            <span className="text-xs text-slate-500">หน่วยงานสังกัด</span>
            <p className="font-semibold text-slate-900">{selectedStaff.department}</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse border border-slate-300">
            <thead>
              <tr className="bg-slate-50 text-xs font-semibold text-slate-700">
                <th rowSpan={2} className="border border-slate-300 py-2 px-3 text-center w-14">
                  ลำดับที่
                </th>
                <th rowSpan={2} className="border border-slate-300 py-2 px-3 text-center">
                  วัน เดือน ปี
                </th>
                <th colSpan={6} className="border border-slate-300 py-2 px-3 text-center">
                  รายการลา (วันทำการ)
                </th>
                <th rowSpan={2} className="border border-slate-300 py-2 px-3 text-center">
                  ผู้อนุมัติ
                </th>
                <th rowSpan={2} className="border border-slate-300 py-2 px-3 text-center">
                  หมายเหตุ
                </th>
              </tr>
              <tr className="bg-slate-50 text-xs font-semibold text-slate-700">
                <th className="border border-slate-300 py-1.5 px-2 text-center">ลากิจ</th>
                <th className="border border-slate-300 py-1.5 px-2 text-center">ลาป่วย</th>
                <th className="border border-slate-300 py-1.5 px-2 text-center">ลาพักผ่อน</th>
                <th className="border border-slate-300 py-1.5 px-2 text-center">ลาคลอด</th>
                <th className="border border-slate-300 py-1.5 px-2 text-center">ลาบวช</th>
                <th className="border border-slate-300 py-1.5 px-2 text-center">อื่นๆ</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {staffRecords.length === 0 ? (
                <tr>
                  <td colSpan={10} className="border border-slate-300 py-8 text-center text-slate-500">
                    ยังไม่มีรายการลาในปีงบประมาณ {fiscalYear}
                  </td>
                </tr>
              ) : (
                staffRecords.map((rec, idx) => (
                  <tr key={rec.requestId} className="hover:bg-slate-50">
                    <td className="border border-slate-300 py-2 px-3 text-center">{idx + 1}</td>
                    <td className="border border-slate-300 py-2 px-3 whitespace-nowrap">
                      {formatThaiDateShort(rec.startDate)} – {formatThaiDateShort(rec.endDate)}
                    </td>
                    <td className="border border-slate-300 py-2 px-2 text-center">
                      {rec.leaveType === 'personal' ? rec.workingDays : ''}
                    </td>
                    <td className="border border-slate-300 py-2 px-2 text-center">
                      {rec.leaveType === 'sick' ? rec.workingDays : ''}
                    </td>
                    <td className="border border-slate-300 py-2 px-2 text-center">
                      {rec.leaveType === 'vacation' || rec.leaveType === 'overseas'
                        ? rec.workingDays
                        : ''}
                    </td>
                    <td className="border border-slate-300 py-2 px-2 text-center">
                      {rec.leaveType === 'maternity' ? rec.workingDays : ''}
                    </td>
                    <td className="border border-slate-300 py-2 px-2 text-center">
                      {rec.leaveType === 'ordination' ? rec.workingDays : ''}
                    </td>
                    <td className="border border-slate-300 py-2 px-2 text-center">
                      {rec.leaveType === 'other' ? rec.workingDays : ''}
                    </td>
                    <td className="border border-slate-300 py-2 px-3 text-xs">
                      {rec.supervisorName || 'รออนุมัติ'}
                    </td>
                    <td className="border border-slate-300 py-2 px-3 text-xs">
                      {rec.status === 'approved'
                        ? rec.supervisorComment || 'อนุญาต'
                        : rec.status === 'rejected'
                          ? 'ไม่อนุญาต'
                          : 'รอดำเนินการ'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
