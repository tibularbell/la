import React, { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { Sparkles, Send, CalendarCheck, AlertCircle, CheckCircle2 } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  calculateCalendarDays,
  calculateWorkingDays,
  formatThaiDateFull,
  getFiscalYearFromIso,
} from '../lib/thaiDate';
import {
  LEAVE_TYPE_LABELS,
  MAX_LENGTHS,
} from '../types/leave';
import type {
  AiLeaveAssistantResult,
  LeaveRequest,
  LeaveType,
  StaffPrivatePII,
  StaffPublicProfile,
  SystemSettings,
  TelegramDispatchResponse,
} from '../types/leave';

interface LeaveRequestFormProps {
  currentStaff: StaffPublicProfile;
  staffList: StaffPublicProfile[];
  systemSettings?: SystemSettings | null;
  getIdToken: () => Promise<string | null>;
  onSubmitted: (req: LeaveRequest, telegramDispatch: TelegramDispatchResponse | null) => void;
}

const LEAVE_OPTIONS: { value: LeaveType; label: string; hint: string }[] = [
  { value: 'vacation', label: 'ลาพักผ่อน', hint: 'แบบใบลาพักผ่อนประจำปี/สะสม' },
  { value: 'sick', label: 'ลาป่วย', hint: 'แจ้งลาป่วยหรือพบแพทย์' },
  { value: 'personal', label: 'ลากิจส่วนตัว', hint: 'ธุระส่วนตัวจำเป็น' },
  { value: 'overseas', label: 'ขออนุญาตไปต่างประเทศ', hint: 'สร้างบันทึกข้อความถึงผู้ว่าราชการจังหวัดสระบุรี' },
  { value: 'maternity', label: 'ลาคลอดบุตร', hint: 'สิทธิ 90 วันตามระเบียบ' },
  { value: 'ordination', label: 'ลาอุปสมบท', hint: 'ยื่นล่วงหน้าไม่น้อยกว่า 60 วัน' },
  { value: 'other', label: 'ลาอื่นๆ', hint: 'กรณีราชการหรือเหตุจำเป็นอื่น' },
];

export const LeaveRequestForm: React.FC<LeaveRequestFormProps> = ({
  currentStaff,
  staffList,
  systemSettings,
  getIdToken,
  onSubmitted,
}) => {
  const todayIso = new Date().toISOString().slice(0, 10);
  const defaultAddressed = systemSettings?.defaultAddressedTo ?? 'สาธารณสุขอำเภอดอนพุด';

  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResponse, setAiResponse] = useState<AiLeaveAssistantResult | null>(null);
  const [aiErr, setAiErr] = useState('');

  const [leaveType, setLeaveType] = useState<LeaveType>('vacation');
  const [writtenAt, setWrittenAt] = useState(currentStaff.department);
  const [addressedTo, setAddressedTo] = useState(defaultAddressed);
  const [startDate, setStartDate] = useState(todayIso);
  const [endDate, setEndDate] = useState(todayIso);
  const [manualDays, setManualDays] = useState<string>('');
  const [substituteUid, setSubstituteUid] = useState('');
  const [reason, setReason] = useState('');
  const [contactAddress, setContactAddress] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  // Overseas travel breakdown fields (Screenshots 3 & 4)
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

  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState('');

  // Pre-fill own contact phone & address from isolated staff_private
  useEffect(() => {
    let active = true;
    const loadPrivate = async () => {
      try {
        const snap = await getDoc(doc(db, 'staff_private', currentStaff.uid));
        if (active && snap.exists()) {
          const data = snap.data() as StaffPrivatePII;
          if (data.phone && !contactPhone) setContactPhone(data.phone);
          if (data.contactAddress && !contactAddress) setContactAddress(data.contactAddress);
        }
      } catch {
        // Optional prefill; ignore if unavailable
      }
    };
    void loadPrivate();
    return () => {
      active = false;
    };
  }, [currentStaff.uid]);

  useEffect(() => {
    if (leaveType === 'overseas') {
      setAddressedTo('ผู้ว่าราชการจังหวัดสระบุรี');
    } else if (addressedTo === 'ผู้ว่าราชการจังหวัดสระบุรี') {
      setAddressedTo('สาธารณสุขอำเภอดอนพุด');
    }
  }, [leaveType]);

  const autoWorkingDays = useMemo(() => {
    if (leaveType === 'maternity' || leaveType === 'ordination') {
      return calculateCalendarDays(startDate, endDate);
    }
    return calculateWorkingDays(startDate, endDate);
  }, [startDate, endDate, leaveType]);

  const effectiveDays = manualDays !== '' ? Number(manualDays) || 0 : autoWorkingDays;

  const priorUsedForType = useMemo(() => {
    if (leaveType === 'vacation' || leaveType === 'overseas') return currentStaff.usedVacationDays;
    if (leaveType === 'sick') return currentStaff.usedSickDays;
    if (leaveType === 'personal') return currentStaff.usedPersonalDays;
    return currentStaff.usedOtherDays;
  }, [leaveType, currentStaff]);

  const totalAvailableVacation =
    currentStaff.accumulatedVacationDays + currentStaff.annualVacationQuota;
  const remainingVacationAfter = totalAvailableVacation - currentStaff.usedVacationDays - effectiveDays;

  const colleagues = useMemo(
    () => staffList.filter((s) => s.uid !== currentStaff.uid && s.isActive),
    [staffList, currentStaff.uid]
  );

  const handleAskAi = async (customPrompt?: string) => {
    const queryText = (customPrompt ?? aiPrompt).trim();
    if (!queryText) return;
    setAiBusy(true);
    setAiErr('');
    try {
      const token = await getIdToken();
      if (!token) throw new Error('กรุณาเข้าสู่ระบบใหม่อีกครั้ง');
      const res = await fetch('/api/ai/leave-assistant', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          prompt: queryText,
          staffContext: {
            ...currentStaff,
            colleagues: colleagues.map((c) => c.fullName),
          },
        }),
      });
      const data = (await res.json()) as AiLeaveAssistantResult & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'AI ไม่สามารถประมวลผลได้');
      }
      setAiResponse(data);

      if (data.shouldFillForm) {
        if (
          data.leaveType &&
          ['vacation', 'sick', 'personal', 'maternity', 'ordination', 'overseas', 'other'].includes(
            data.leaveType
          )
        ) {
          setLeaveType(data.leaveType as LeaveType);
        }
        if (data.startDate && /^\d{4}-\d{2}-\d{2}$/.test(data.startDate)) {
          setStartDate(data.startDate);
        }
        if (data.endDate && /^\d{4}-\d{2}-\d{2}$/.test(data.endDate)) {
          setEndDate(data.endDate);
        }
        if (data.reason) setReason(data.reason.slice(0, MAX_LENGTHS.reason));
        if (data.contactAddress) setContactAddress(data.contactAddress.slice(0, MAX_LENGTHS.contactAddress));
        if (data.contactPhone) setContactPhone(data.contactPhone.slice(0, MAX_LENGTHS.phone));
        if (data.overseasCountry) setOverseasCountry(data.overseasCountry.slice(0, MAX_LENGTHS.overseasCountry));
        if (data.overseasPurpose) setOverseasPurpose(data.overseasPurpose.slice(0, MAX_LENGTHS.overseasPurpose));
        if (data.substituteName) {
          const matchedColleague = colleagues.find(
            (c) =>
              c.fullName.includes(data.substituteName!) ||
              data.substituteName!.includes(c.fullName.split(' ')[0])
          );
          if (matchedColleague) setSubstituteUid(matchedColleague.uid);
        }
      }
    } catch (err) {
      setAiErr(err instanceof Error ? err.message : 'ไม่สามารถติดต่อผู้ช่วย AI ได้');
    } finally {
      setAiBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitErr('');

    if (endDate < startDate) {
      setSubmitErr('วันที่สิ้นสุดการลาต้องไม่น้อยกว่าวันที่เริ่มลา');
      return;
    }
    if (effectiveDays <= 0 || effectiveDays > 180) {
      setSubmitErr('จำนวนวันทำการต้องอยู่ระหว่าง 0.5 ถึง 180 วัน');
      return;
    }
    if (leaveType === 'vacation' && remainingVacationAfter < 0) {
      setSubmitErr('วันลาพักผ่อนสะสมและประจำปีคงเหลือไม่เพียงพอสำหรับการลาครั้งนี้');
      return;
    }
    if (leaveType === 'overseas' && (!overseasCountry.trim() || !overseasPurpose.trim())) {
      setSubmitErr('กรุณาระบุประเทศปลายทางและวัตถุประสงค์ในการขออนุญาตไปต่างประเทศ');
      return;
    }

    setSubmitting(true);
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const fiscalYear = getFiscalYearFromIso(startDate);
    const docPrefix = (systemSettings?.defaultDocumentPrefix ?? 'สบ ๐๔๓๒/ว').replace(/ว$/, '');
    const docNum = `${docPrefix}${String(Math.floor(100 + Math.random() * 899))}`.slice(0, 40);
    const selectedSub = colleagues.find((c) => c.uid === substituteUid);

    const requestPayload: Omit<LeaveRequest, 'createdAt' | 'updatedAt'> & {
      createdAt: ReturnType<typeof serverTimestamp>;
      updatedAt: ReturnType<typeof serverTimestamp>;
    } = {
      requestId,
      documentNo: docNum,
      requesterUid: currentStaff.uid,
      requesterName: currentStaff.fullName,
      requesterPosition: currentStaff.position,
      department: currentStaff.department,
      leaveType,
      startDate,
      endDate,
      workingDays: effectiveDays,
      fiscalYear,
      priorUsedDays: priorUsedForType,
      accumulatedDaysAtSubmit: currentStaff.accumulatedVacationDays,
      annualQuotaAtSubmit: currentStaff.annualVacationQuota,
      substituteUid: selectedSub?.uid ?? '',
      substituteName: selectedSub?.fullName ?? '',
      status: 'pending_verifier',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const batch = writeBatch(db);
    batch.set(doc(db, 'leave_requests', requestId), requestPayload);
    batch.set(doc(db, 'leave_requests', requestId, 'private', 'details'), {
      requesterUid: currentStaff.uid,
      writtenAt: (writtenAt || currentStaff.department).trim().slice(0, MAX_LENGTHS.writtenAt),
      addressedTo: (addressedTo || 'สาธารณสุขอำเภอดอนพุด').trim().slice(0, MAX_LENGTHS.addressedTo),
      reason: reason.trim().slice(0, MAX_LENGTHS.reason),
      contactAddress: contactAddress.trim().slice(0, MAX_LENGTHS.contactAddress),
      contactPhone: contactPhone.trim().slice(0, MAX_LENGTHS.phone),
      overseasCountry: overseasCountry.trim().slice(0, MAX_LENGTHS.overseasCountry),
      overseasPurpose: overseasPurpose.trim().slice(0, MAX_LENGTHS.overseasPurpose),
      holidayDays: Number(holidayDays) || 0,
      holidayRange: holidayRange.trim().slice(0, 100),
      personalDays: Number(personalDays) || 0,
      personalRange: personalRange.trim().slice(0, 100),
      vacationDays: Number(vacationDays) || 0,
      vacationRange: vacationRange.trim().slice(0, 100),
      otherDays: Number(otherDays) || 0,
      otherLabel: otherLabel.trim().slice(0, 120),
      otherRange: otherRange.trim().slice(0, 100),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'leave_requests', requestId, 'audit_logs', `log_${Date.now()}`), {
      actorUid: currentStaff.uid,
      actorName: currentStaff.fullName,
      action: 'submitted',
      note: `ยื่น${LEAVE_TYPE_LABELS[leaveType]} จำนวน ${effectiveDays} วัน`,
      createdAt: serverTimestamp(),
    });

    try {
      await batch.commit();
    } catch (error) {
      setSubmitting(false);
      handleFirestoreError(error, OperationType.WRITE, `leave_requests/${requestId}`);
    }

    // Dispatch Telegram Real-time Notification (if enabled in system settings)
    let telegramResult: TelegramDispatchResponse | null = null;
    if (systemSettings?.autoNotifyOnSubmit !== false) {
      try {
        const token = await getIdToken();
        if (token) {
          const tgRes = await fetch('/api/telegram/notify-approval', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            requestId,
            requesterName: currentStaff.fullName,
            requesterPosition: currentStaff.position,
            department: currentStaff.department,
            leaveTypeLabel: LEAVE_TYPE_LABELS[leaveType],
            startDateTh: formatThaiDateFull(startDate),
            endDateTh: formatThaiDateFull(endDate),
            workingDays: effectiveDays,
            substituteName: selectedSub?.fullName ?? '',
            recipientRole: 'verifier',
          }),
        });
        if (tgRes.ok) {
          telegramResult = (await tgRes.json()) as TelegramDispatchResponse;
          const notifId = `tg_${Date.now()}`;
          const logBatch = writeBatch(db);
          logBatch.set(doc(db, 'telegram_notifications', notifId), {
            notificationId: notifId,
            requestId,
            senderUid: currentStaff.uid,
            recipientRole: 'verifier',
            channelMode: telegramResult.channelMode,
            deliveryStatus: telegramResult.delivered ? 'sent' : 'ready_to_share',
            summaryText: telegramResult.summaryText.slice(0, 480),
            createdAt: serverTimestamp(),
          });
          await logBatch.commit();
        }
      }
      } catch {
        // Non-blocking if Telegram notification fails
      }
    }
    setSubmitting(false);

    onSubmitted(
      {
        ...requestPayload,
        createdAt: undefined,
        updatedAt: undefined,
      },
      telegramResult
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left/Top: AI Smart Leave Assistant */}
      <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              AI ผู้ช่วยกรอกใบลาและแนะนำระเบียบ
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              พิมพ์ข้อความเป็นภาษาพูดปกติ AI จะช่วยกรอกแบบฟอร์มและตรวจสอบสิทธิให้ทันที
            </p>
          </div>
          <Sparkles className="w-5 h-5 text-teal-700 shrink-0" />
        </div>

        <div className="flex flex-wrap gap-2">
          {[
            'ขอลาพักผ่อน 25-27 พ.ย. 2569 ไปทำธุระต่างจังหวัด',
            'ขออนุญาตไปต่างประเทศ ญี่ปุ่น 5 วัน ใช้วันลาพักผ่อน 3 วัน',
            'ระเบียบการสะสมวันลาพักผ่อนข้าราชการเป็นอย่างไร',
          ].map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => {
                setAiPrompt(chip);
                void handleAskAi(chip);
              }}
              className="min-h-[36px] px-3 py-1.5 text-xs text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-left transition-colors cursor-pointer"
            >
              {chip}
            </button>
          ))}
        </div>

        <div className="space-y-2.5">
          <textarea
            rows={3}
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder="พิมพ์บอก AI เช่น ขอลาป่วยพรุ่งนี้ 1 วัน เนื่องจากมีไข้ ติดต่อเบอร์ 081-xxx-xxxx..."
            className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
          <button
            type="button"
            onClick={() => void handleAskAi()}
            disabled={aiBusy || !aiPrompt.trim()}
            className="w-full min-h-[44px] px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium rounded-xl flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <Sparkles className="w-4 h-4 shrink-0" />
            <span>{aiBusy ? 'AI กำลังวิเคราะห์...' : 'ให้ AI ช่วยกรอกใบลา / ถามระเบียบ'}</span>
          </button>
        </div>

        {aiErr && (
          <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">
            {aiErr}
          </div>
        )}

        {aiResponse && (
          <div className="border border-teal-200 bg-teal-50/50 rounded-xl p-4 space-y-2.5">
            <div className="flex items-center gap-2 text-teal-800 text-xs font-semibold">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{aiResponse.shouldFillForm ? 'กรอกแบบฟอร์มให้อัตโนมัติแล้ว' : 'คำแนะนำจาก AI'}</span>
            </div>
            <p className="text-sm text-slate-800 leading-relaxed">{aiResponse.assistantReply}</p>
            {aiResponse.policyNotes?.length > 0 && (
              <ul className="text-xs text-slate-600 space-y-1 list-disc pl-4">
                {aiResponse.policyNotes.map((note, idx) => (
                  <li key={idx}>{note}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Live Entitlement Summary */}
        <div className="border-t border-slate-100 pt-4 space-y-2">
          <p className="text-xs font-medium text-slate-500">สรุปสิทธิวันลาพักผ่อนของคุณ</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="border border-slate-200 rounded-lg p-2.5">
              <p className="text-[11px] text-slate-500">สะสม+ปีนี้</p>
              <p className="text-base font-bold text-slate-900 tabular-nums">
                {totalAvailableVacation}
              </p>
            </div>
            <div className="border border-slate-200 rounded-lg p-2.5">
              <p className="text-[11px] text-slate-500">ใช้ไปแล้ว</p>
              <p className="text-base font-bold text-slate-900 tabular-nums">
                {currentStaff.usedVacationDays}
              </p>
            </div>
            <div className="border border-slate-200 rounded-lg p-2.5">
              <p className="text-[11px] text-slate-500">หลังลาครั้งนี้</p>
              <p
                className={`text-base font-bold tabular-nums ${
                  remainingVacationAfter < 0 ? 'text-rose-700' : 'text-teal-700'
                }`}
              >
                {remainingVacationAfter}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Right: Official Leave Application Form */}
      <form
        onSubmit={handleSubmit}
        className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5"
      >
        <div className="border-b border-slate-100 pb-4">
          <p className="text-xs font-medium text-teal-700">แบบฟอร์มราชการออนไลน์</p>
          <h2 className="text-lg font-semibold text-slate-900 mt-0.5">
            ยื่นคำขออนุญาตการลา ({currentStaff.fullName})
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {currentStaff.position} · {currentStaff.department}
          </p>
        </div>

        {/* Leave Type Buttons */}
        <div className="space-y-2">
          <label className="block text-xs font-medium text-slate-700">ประเภทการลา</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {LEAVE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setLeaveType(opt.value)}
                className={`min-h-[44px] px-3 py-2 text-left rounded-xl border transition-colors cursor-pointer ${
                  leaveType === opt.value
                    ? 'bg-teal-700 text-white border-teal-700'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <span className="block text-xs font-semibold">{opt.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">เขียนที่</label>
            <input
              type="text"
              required
              maxLength={MAX_LENGTHS.writtenAt}
              value={writtenAt}
              onChange={(e) => setWrittenAt(e.target.value)}
              className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">เรียน</label>
            <input
              type="text"
              required
              maxLength={MAX_LENGTHS.addressedTo}
              value={addressedTo}
              onChange={(e) => setAddressedTo(e.target.value)}
              className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">ตั้งแต่วันที่</label>
            <input
              type="date"
              required
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                if (e.target.value > endDate) setEndDate(e.target.value);
              }}
              className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-600 tabular-nums"
            />
            <p className="text-[11px] text-slate-500 mt-1">{formatThaiDateFull(startDate)}</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">ถึงวันที่</label>
            <input
              type="date"
              required
              min={startDate}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-600 tabular-nums"
            />
            <p className="text-[11px] text-slate-500 mt-1">{formatThaiDateFull(endDate)}</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              จำนวนวันทำการ (ระบบคำนวณอัตโนมัติ: {autoWorkingDays} วัน)
            </label>
            <input
              type="number"
              step="0.5"
              min="0.5"
              max="180"
              value={manualDays === '' ? autoWorkingDays : manualDays}
              onChange={(e) => setManualDays(e.target.value)}
              className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-600 tabular-nums"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              ผู้ปฏิบัติงานแทนระหว่างลา
            </label>
            <select
              value={substituteUid}
              onChange={(e) => setSubstituteUid(e.target.value)}
              className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
            >
              <option value="">-- เลือกผู้รับมอบหมายงาน --</option>
              {colleagues.map((col) => (
                <option key={col.uid} value={col.uid}>
                  {col.fullName} ({col.department})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Conditional Overseas Travel Memorandum Fields */}
        {leaveType === 'overseas' && (
          <div className="border border-slate-200 rounded-xl p-4 space-y-4 bg-slate-50/60">
            <p className="text-xs font-semibold text-slate-900">
              รายละเอียดบันทึกข้อความขออนุญาตไปต่างประเทศ (เรียน ผู้ว่าราชการจังหวัดสระบุรี)
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
                  placeholder="เช่น ประเทศญี่ปุ่น"
                  className="w-full min-h-[44px] px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl"
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
                  placeholder="เช่น ทัศนศึกษา / พักผ่อน"
                  className="w-full min-h-[44px] px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  เดินทางในวันหยุดราชการ (จำนวนวัน)
                </label>
                <input
                  type="number"
                  min={0}
                  value={holidayDays}
                  onChange={(e) => setHolidayDays(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  ช่วงวันที่วันหยุดราชการ
                </label>
                <input
                  type="text"
                  value={holidayRange}
                  onChange={(e) => setHolidayRange(e.target.value)}
                  placeholder="เช่น 9 - 10 ก.พ. 2569"
                  className="w-full min-h-[44px] px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  ลากิจส่วนตัว (จำนวนวัน)
                </label>
                <input
                  type="number"
                  min={0}
                  value={personalDays}
                  onChange={(e) => setPersonalDays(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  ช่วงวันที่ลากิจส่วนตัว
                </label>
                <input
                  type="text"
                  value={personalRange}
                  onChange={(e) => setPersonalRange(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  ลาพักผ่อน (จำนวนวัน)
                </label>
                <input
                  type="number"
                  min={0}
                  value={vacationDays}
                  onChange={(e) => setVacationDays(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  ช่วงวันที่ลาพักผ่อน
                </label>
                <input
                  type="text"
                  value={vacationRange}
                  onChange={(e) => setVacationRange(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  อื่นๆ ระบุ (ถ้ามี)
                </label>
                <input
                  type="text"
                  value={otherLabel}
                  onChange={(e) => setOtherLabel(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl"
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
                    className="w-full min-h-[44px] px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">ช่วงวันที่</label>
                  <input
                    type="text"
                    value={otherRange}
                    onChange={(e) => setOtherRange(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              เหตุผลการลา / หมายเหตุเพิ่มเติม
            </label>
            <textarea
              rows={2}
              maxLength={MAX_LENGTHS.reason}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="ระบุรายละเอียดหรือเหตุผลการลา"
              className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                ในระหว่างลาจะติดต่อข้าพเจ้าได้ที่ (จัดเก็บแยกปลอดภัย)
              </label>
              <input
                type="text"
                maxLength={MAX_LENGTHS.contactAddress}
                value={contactAddress}
                onChange={(e) => setContactAddress(e.target.value)}
                placeholder="ที่อยู่ระหว่างลา"
                className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                หมายเลขโทรศัพท์ที่ติดต่อได้ (จัดเก็บแยกปลอดภัย)
              </label>
              <input
                type="tel"
                maxLength={MAX_LENGTHS.phone}
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="08x-xxx-xxxx"
                className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-600 tabular-nums"
              />
            </div>
          </div>
        </div>

        {submitErr && (
          <div className="flex items-start gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{submitErr}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full min-h-[48px] px-5 py-3 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-medium rounded-xl flex items-center justify-center gap-2 transition-colors cursor-pointer"
        >
          <Send className="w-4 h-4 shrink-0" />
          <span>
            {submitting
              ? 'กำลังบันทึกและสร้างแจ้งเตือน Telegram...'
              : 'ส่งคำขออนุมัติและแจ้งเตือนผ่าน Telegram'}
          </span>
        </button>

        <div className="flex items-center gap-2 text-xs text-slate-500">
          <CalendarCheck className="w-4 h-4 text-teal-700 shrink-0" />
          <span>หลังส่งคำขอ สามารถกดส่งแจ้งเตือนเข้า Telegram และพิมพ์ใบลา PDF ได้ทันที</span>
        </div>
      </form>
    </div>
  );
};
