import React, { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { X, Save, AlertCircle, Info } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  calculateCalendarDays,
  calculateWorkingDays,
  formatThaiDateFull,
  getFiscalYearFromIso,
} from '../lib/thaiDate';
import {
  DON_PHUT_DEPARTMENTS,
  LEAVE_STATUS_LABELS,
  LEAVE_TYPE_LABELS,
  MAX_LENGTHS,
} from '../types/leave';
import type {
  LeaveRequest,
  LeaveRequestPrivateDetails,
  LeaveStatus,
  LeaveType,
  StaffPublicProfile,
} from '../types/leave';

interface EditLeaveModalProps {
  request: LeaveRequest;
  currentStaff: StaffPublicProfile;
  staffList: StaffPublicProfile[];
  departments?: string[];
  isAdmin: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export const EditLeaveModal: React.FC<EditLeaveModalProps> = ({
  request,
  currentStaff,
  staffList,
  departments,
  isAdmin,
  onClose,
  onSaved,
}) => {
  const activeDepartments = departments?.length ? departments : [...DON_PHUT_DEPARTMENTS];
  const isVerifierOrAbove =
    isAdmin || ['verifier', 'supervisor', 'executive', 'admin'].includes(currentStaff.role);
  const isRequesterOnly = !isAdmin && !isVerifierOrAbove && request.requesterUid === currentStaff.uid;

  const [loadingPrivate, setLoadingPrivate] = useState(true);
  const [hasPrivateDoc, setHasPrivateDoc] = useState(false);

  const [documentNo, setDocumentNo] = useState(request.documentNo ?? '');
  const [department, setDepartment] = useState(request.department);
  const [leaveType, setLeaveType] = useState<LeaveType>(request.leaveType);
  const [startDate, setStartDate] = useState(request.startDate);
  const [endDate, setEndDate] = useState(request.endDate);
  const [manualDays, setManualDays] = useState<string>(String(request.workingDays));
  const [substituteUid, setSubstituteUid] = useState(request.substituteUid ?? '');
  const [status, setStatus] = useState<LeaveStatus>(request.status);
  const [supervisorComment, setSupervisorComment] = useState(request.supervisorComment ?? '');

  // Private details
  const [writtenAt, setWrittenAt] = useState(request.department);
  const [addressedTo, setAddressedTo] = useState(
    request.leaveType === 'overseas' ? 'ผู้ว่าราชการจังหวัดสระบุรี' : 'สาธารณสุขอำเภอดอนพุด'
  );
  const [reason, setReason] = useState('');
  const [contactAddress, setContactAddress] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [overseasCountry, setOverseasCountry] = useState('');
  const [overseasPurpose, setOverseasPurpose] = useState('');
  const [holidayDays, setHolidayDays] = useState('0');
  const [holidayRange, setHolidayRange] = useState('');
  const [personalDays, setPersonalDays] = useState('0');
  const [personalRange, setPersonalRange] = useState('');
  const [vacationDays, setVacationDays] = useState('0');
  const [vacationRange, setVacationRange] = useState('');
  const [otherDays, setOtherDays] = useState('0');
  const [otherLabel, setOtherLabel] = useState('');
  const [otherRange, setOtherRange] = useState('');

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoadingPrivate(true);
      try {
        const snap = await getDoc(
          doc(db, 'leave_requests', request.requestId, 'private', 'details')
        );
        if (active && snap.exists()) {
          const p = snap.data() as LeaveRequestPrivateDetails;
          setHasPrivateDoc(true);
          setWrittenAt(p.writtenAt || request.department);
          setAddressedTo(p.addressedTo || 'สาธารณสุขอำเภอดอนพุด');
          setReason(p.reason ?? '');
          setContactAddress(p.contactAddress ?? '');
          setContactPhone(p.contactPhone ?? '');
          setOverseasCountry(p.overseasCountry ?? '');
          setOverseasPurpose(p.overseasPurpose ?? '');
          setHolidayDays(String(p.holidayDays ?? 0));
          setHolidayRange(p.holidayRange ?? '');
          setPersonalDays(String(p.personalDays ?? 0));
          setPersonalRange(p.personalRange ?? '');
          setVacationDays(String(p.vacationDays ?? 0));
          setVacationRange(p.vacationRange ?? '');
          setOtherDays(String(p.otherDays ?? 0));
          setOtherLabel(p.otherLabel ?? '');
          setOtherRange(p.otherRange ?? '');
        }
      } catch {
        // Optional private details
      } finally {
        if (active) setLoadingPrivate(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [request.requestId, request.department]);

  const autoWorkingDays = useMemo(() => {
    if (leaveType === 'maternity' || leaveType === 'ordination') {
      return calculateCalendarDays(startDate, endDate);
    }
    return calculateWorkingDays(startDate, endDate);
  }, [startDate, endDate, leaveType]);

  const colleagues = useMemo(
    () => staffList.filter((s) => s.uid !== request.requesterUid && s.isActive),
    [staffList, request.requesterUid]
  );

  const handleDateChange = (nextStart: string, nextEnd: string, nextType: LeaveType) => {
    const calc =
      nextType === 'maternity' || nextType === 'ordination'
        ? calculateCalendarDays(nextStart, nextEnd)
        : calculateWorkingDays(nextStart, nextEnd);
    setManualDays(String(calc));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');

    if (endDate < startDate) {
      setErr('วันที่สิ้นสุดการลาต้องไม่น้อยกว่าวันที่เริ่มลา');
      return;
    }

    const parsedDays = Math.min(180, Math.max(0.5, Number(manualDays) || autoWorkingDays));
    if (parsedDays <= 0 || parsedDays > 180) {
      setErr('จำนวนวันทำการต้องอยู่ระหว่าง 0.5 ถึง 180 วัน');
      return;
    }

    if (leaveType === 'overseas' && (!overseasCountry.trim() || !overseasPurpose.trim())) {
      setErr('กรุณาระบุประเทศปลายทางและวัตถุประสงค์ในการเดินทางไปต่างประเทศ');
      return;
    }

    setSaving(true);
    const fiscalYear = getFiscalYearFromIso(startDate);
    const selectedSub = colleagues.find((c) => c.uid === substituteUid);
    const subUid = selectedSub?.uid ?? '';
    const subName = selectedSub?.fullName ?? (substituteUid ? request.substituteName ?? '' : '');

    const batch = writeBatch(db);
    const reqRef = doc(db, 'leave_requests', request.requestId);

    if (isAdmin) {
      batch.update(reqRef, {
        documentNo: documentNo.trim().slice(0, MAX_LENGTHS.documentNo),
        department: department.trim().slice(0, MAX_LENGTHS.department),
        leaveType,
        startDate,
        endDate,
        workingDays: parsedDays,
        fiscalYear,
        substituteUid: subUid,
        substituteName: subName.slice(0, MAX_LENGTHS.fullName),
        status,
        supervisorComment: supervisorComment.trim().slice(0, MAX_LENGTHS.supervisorComment),
        updatedAt: serverTimestamp(),
      });
    } else if (isVerifierOrAbove) {
      batch.update(reqRef, {
        documentNo: documentNo.trim().slice(0, MAX_LENGTHS.documentNo),
        leaveType,
        startDate,
        endDate,
        workingDays: parsedDays,
        fiscalYear,
        substituteUid: subUid,
        substituteName: subName.slice(0, MAX_LENGTHS.fullName),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.update(reqRef, {
        leaveType,
        startDate,
        endDate,
        workingDays: parsedDays,
        fiscalYear,
        substituteUid: subUid,
        substituteName: subName.slice(0, MAX_LENGTHS.fullName),
        status: 'pending_verifier',
        updatedAt: serverTimestamp(),
      });
    }

    const privPayload = {
      requesterUid: request.requesterUid,
      writtenAt: (writtenAt || request.department).trim().slice(0, MAX_LENGTHS.writtenAt),
      addressedTo: (addressedTo || 'สาธารณสุขอำเภอดอนพุด').trim().slice(0, MAX_LENGTHS.addressedTo),
      reason: reason.trim().slice(0, MAX_LENGTHS.reason),
      contactAddress: contactAddress.trim().slice(0, MAX_LENGTHS.contactAddress),
      contactPhone: contactPhone.trim().slice(0, MAX_LENGTHS.phone),
      overseasCountry: overseasCountry.trim().slice(0, MAX_LENGTHS.overseasCountry),
      overseasPurpose: overseasPurpose.trim().slice(0, MAX_LENGTHS.overseasPurpose),
      holidayDays: Math.min(180, Math.max(0, Number(holidayDays) || 0)),
      holidayRange: holidayRange.trim().slice(0, 100),
      personalDays: Math.min(180, Math.max(0, Number(personalDays) || 0)),
      personalRange: personalRange.trim().slice(0, 100),
      vacationDays: Math.min(180, Math.max(0, Number(vacationDays) || 0)),
      vacationRange: vacationRange.trim().slice(0, 100),
      otherDays: Math.min(180, Math.max(0, Number(otherDays) || 0)),
      otherLabel: otherLabel.trim().slice(0, 120),
      otherRange: otherRange.trim().slice(0, 100),
      updatedAt: serverTimestamp(),
    };

    const privRef = doc(db, 'leave_requests', request.requestId, 'private', 'details');
    if (hasPrivateDoc) {
      batch.update(privRef, privPayload);
    } else {
      batch.set(privRef, privPayload);
    }

    batch.set(doc(db, 'leave_requests', request.requestId, 'audit_logs', `log_${Date.now()}`), {
      actorUid: currentStaff.uid,
      actorName: currentStaff.fullName,
      action: isAdmin ? 'admin_edited' : 'edited',
      note: isAdmin
        ? `ผู้ดูแลระบบแก้ไขข้อมูลใบลา (${LEAVE_TYPE_LABELS[leaveType]} ${parsedDays} วัน)`
        : isVerifierOrAbove
          ? `ผู้ตรวจสอบแก้ไขรายละเอียดใบลา (${LEAVE_TYPE_LABELS[leaveType]} ${parsedDays} วัน)`
          : `ผู้ขอลาแก้ไขรายละเอียดใบลา (${LEAVE_TYPE_LABELS[leaveType]} ${parsedDays} วัน)`,
      createdAt: serverTimestamp(),
    });

    try {
      await batch.commit();
      onSaved('บันทึกการแก้ไขใบลาเรียบร้อยแล้ว');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `leave_requests/${request.requestId}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <form
        onSubmit={handleSave}
        className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-5 sm:p-6 space-y-4"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <p className="text-xs font-medium text-teal-700">
              {request.documentNo || request.requestId}
            </p>
            <h3 className="text-base font-bold text-slate-900 mt-0.5">
              แก้ไขคำขอการลา · {request.requesterName}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-500 hover:text-slate-900 cursor-pointer"
            aria-label="ปิดหน้าต่างแก้ไขใบลา"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {isRequesterOnly && request.status === 'pending_supervisor' && (
          <div className="flex items-start gap-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl p-3">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              เมื่อผู้ยื่นคำขอแก้ไขข้อมูลใบลา ระบบจะส่งคำขอกลับไปยังขั้นตอน &ldquo;รอผู้ตรวจสอบสถิติ&rdquo; เพื่อตรวจสอบความถูกต้องใหม่อีกครั้ง
            </span>
          </div>
        )}

        {loadingPrivate ? (
          <div className="py-8 text-center text-sm text-slate-500">กำลังโหลดรายละเอียดใบลา...</div>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">ประเภทการลา</label>
                <select
                  value={leaveType}
                  onChange={(e) => {
                    const nextType = e.target.value as LeaveType;
                    setLeaveType(nextType);
                    handleDateChange(startDate, endDate, nextType);
                    if (nextType === 'overseas') {
                      setAddressedTo('ผู้ว่าราชการจังหวัดสระบุรี');
                    } else if (addressedTo === 'ผู้ว่าราชการจังหวัดสระบุรี') {
                      setAddressedTo('สาธารณสุขอำเภอดอนพุด');
                    }
                  }}
                  className="w-full min-h-[44px] px-3 py-2 border border-slate-200 rounded-xl bg-white"
                >
                  {(Object.keys(LEAVE_TYPE_LABELS) as LeaveType[]).map((lt) => (
                    <option key={lt} value={lt}>
                      {LEAVE_TYPE_LABELS[lt]}
                    </option>
                  ))}
                </select>
              </div>

              {isVerifierOrAbove && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">เลขที่หนังสือ</label>
                  <input
                    type="text"
                    maxLength={MAX_LENGTHS.documentNo}
                    value={documentNo}
                    onChange={(e) => setDocumentNo(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 border border-slate-200 rounded-xl"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">เขียนที่</label>
                <input
                  type="text"
                  required
                  maxLength={MAX_LENGTHS.writtenAt}
                  value={writtenAt}
                  onChange={(e) => setWrittenAt(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">เรียน</label>
                <input
                  type="text"
                  required
                  maxLength={MAX_LENGTHS.addressedTo}
                  value={addressedTo}
                  onChange={(e) => setAddressedTo(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">ตั้งแต่วันที่</label>
                <input
                  type="date"
                  required
                  value={startDate}
                  onChange={(e) => {
                    const nextStart = e.target.value;
                    const nextEnd = endDate < nextStart ? nextStart : endDate;
                    setStartDate(nextStart);
                    setEndDate(nextEnd);
                    handleDateChange(nextStart, nextEnd, leaveType);
                  }}
                  className="w-full min-h-[44px] px-3 py-2 border border-slate-200 rounded-xl tabular-nums"
                />
                <p className="text-[11px] text-slate-500 mt-1">{formatThaiDateFull(startDate)}</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">ถึงวันที่</label>
                <input
                  type="date"
                  required
                  min={startDate}
                  value={endDate}
                  onChange={(e) => {
                    const nextEnd = e.target.value;
                    setEndDate(nextEnd);
                    handleDateChange(startDate, nextEnd, leaveType);
                  }}
                  className="w-full min-h-[44px] px-3 py-2 border border-slate-200 rounded-xl tabular-nums"
                />
                <p className="text-[11px] text-slate-500 mt-1">{formatThaiDateFull(endDate)}</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  จำนวนวันทำการ (คำนวณอัตโนมัติ: {autoWorkingDays} วัน)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min={0.5}
                  max={180}
                  value={manualDays}
                  onChange={(e) => setManualDays(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 border border-slate-200 rounded-xl tabular-nums"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  ผู้ปฏิบัติงานแทน
                </label>
                <select
                  value={substituteUid}
                  onChange={(e) => setSubstituteUid(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 border border-slate-200 rounded-xl bg-white"
                >
                  <option value="">-- ไม่ระบุ / เลือกผู้รับมอบหมายงาน --</option>
                  {colleagues.map((col) => (
                    <option key={col.uid} value={col.uid}>
                      {col.fullName} ({col.department})
                    </option>
                  ))}
                </select>
              </div>

              {isAdmin && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">หน่วยงาน</label>
                    <select
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      className="w-full min-h-[44px] px-3 py-2 border border-slate-200 rounded-xl bg-white"
                    >
                      {activeDepartments.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                      {!activeDepartments.includes(department) && (
                        <option value={department}>{department}</option>
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      สถานะคำขอ (ผู้ดูแลระบบ)
                    </label>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value as LeaveStatus)}
                      className="w-full min-h-[44px] px-3 py-2 border border-slate-200 rounded-xl bg-white"
                    >
                      {(Object.keys(LEAVE_STATUS_LABELS) as LeaveStatus[]).map((st) => (
                        <option key={st} value={st}>
                          {LEAVE_STATUS_LABELS[st]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      ความเห็นผู้บังคับบัญชา
                    </label>
                    <input
                      type="text"
                      maxLength={MAX_LENGTHS.supervisorComment}
                      value={supervisorComment}
                      onChange={(e) => setSupervisorComment(e.target.value)}
                      className="w-full min-h-[44px] px-3 py-2 border border-slate-200 rounded-xl"
                    />
                  </div>
                </>
              )}
            </div>

            {leaveType === 'overseas' && (
              <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/60">
                <p className="text-xs font-semibold text-slate-900">
                  รายละเอียดบันทึกข้อความขออนุญาตไปต่างประเทศ
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      ประเทศปลายทาง
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={MAX_LENGTHS.overseasCountry}
                      value={overseasCountry}
                      onChange={(e) => setOverseasCountry(e.target.value)}
                      className="w-full min-h-[42px] px-3 py-2 bg-white border border-slate-200 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">เพื่อ</label>
                    <input
                      type="text"
                      required
                      maxLength={MAX_LENGTHS.overseasPurpose}
                      value={overseasPurpose}
                      onChange={(e) => setOverseasPurpose(e.target.value)}
                      className="w-full min-h-[42px] px-3 py-2 bg-white border border-slate-200 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      วันหยุดราชการ (วัน)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={holidayDays}
                      onChange={(e) => setHolidayDays(e.target.value)}
                      className="w-full min-h-[42px] px-3 py-2 bg-white border border-slate-200 rounded-xl tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      ช่วงวันหยุดราชการ
                    </label>
                    <input
                      type="text"
                      maxLength={100}
                      value={holidayRange}
                      onChange={(e) => setHolidayRange(e.target.value)}
                      className="w-full min-h-[42px] px-3 py-2 bg-white border border-slate-200 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      ลากิจส่วนตัว (วัน)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={personalDays}
                      onChange={(e) => setPersonalDays(e.target.value)}
                      className="w-full min-h-[42px] px-3 py-2 bg-white border border-slate-200 rounded-xl tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      ช่วงวันที่ลากิจ
                    </label>
                    <input
                      type="text"
                      maxLength={100}
                      value={personalRange}
                      onChange={(e) => setPersonalRange(e.target.value)}
                      className="w-full min-h-[42px] px-3 py-2 bg-white border border-slate-200 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      ลาพักผ่อน (วัน)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={vacationDays}
                      onChange={(e) => setVacationDays(e.target.value)}
                      className="w-full min-h-[42px] px-3 py-2 bg-white border border-slate-200 rounded-xl tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      ช่วงวันที่ลาพักผ่อน
                    </label>
                    <input
                      type="text"
                      maxLength={100}
                      value={vacationRange}
                      onChange={(e) => setVacationRange(e.target.value)}
                      className="w-full min-h-[42px] px-3 py-2 bg-white border border-slate-200 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">อื่นๆ ระบุ</label>
                    <input
                      type="text"
                      maxLength={120}
                      value={otherLabel}
                      onChange={(e) => setOtherLabel(e.target.value)}
                      className="w-full min-h-[42px] px-3 py-2 bg-white border border-slate-200 rounded-xl"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">วันอื่นๆ</label>
                      <input
                        type="number"
                        min={0}
                        value={otherDays}
                        onChange={(e) => setOtherDays(e.target.value)}
                        className="w-full min-h-[42px] px-3 py-2 bg-white border border-slate-200 rounded-xl tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">ช่วงวันที่</label>
                      <input
                        type="text"
                        maxLength={100}
                        value={otherRange}
                        onChange={(e) => setOtherRange(e.target.value)}
                        className="w-full min-h-[42px] px-3 py-2 bg-white border border-slate-200 rounded-xl"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">เหตุผลการลา</label>
              <textarea
                rows={2}
                maxLength={MAX_LENGTHS.reason}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  ที่อยู่ติดต่อระหว่างลา
                </label>
                <input
                  type="text"
                  maxLength={MAX_LENGTHS.contactAddress}
                  value={contactAddress}
                  onChange={(e) => setContactAddress(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  หมายเลขโทรศัพท์ติดต่อได้
                </label>
                <input
                  type="tel"
                  maxLength={MAX_LENGTHS.phone}
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 border border-slate-200 rounded-xl tabular-nums"
                />
              </div>
            </div>
          </div>
        )}

        {err && (
          <div className="flex items-start gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{err}</span>
          </div>
        )}

        <div className="flex justify-end gap-2.5 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 py-2 text-xs font-medium border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl cursor-pointer"
          >
            ยกเลิก
          </button>
          <button
            type="submit"
            disabled={saving || loadingPrivate}
            className="min-h-[44px] px-5 py-2 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-xs font-medium rounded-xl inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'กำลังบันทึก...' : 'บันทึกการแก้ไขใบลา'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
