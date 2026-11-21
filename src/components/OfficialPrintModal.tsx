import React, { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { Printer, X } from 'lucide-react';
import { db } from '../lib/firebase';
import { formatThaiDateFull, getThaiDateParts } from '../lib/thaiDate';
import { LEAVE_TYPE_LABELS } from '../types/leave';
import type {
  LeaveRequest,
  LeaveRequestPrivateDetails,
  StaffPrivatePII,
  StaffPublicProfile,
} from '../types/leave';

export type PrintTemplateType = 'leave_form' | 'record_card' | 'overseas_memo';

interface OfficialPrintModalProps {
  open: boolean;
  initialTemplate: PrintTemplateType;
  leaveRequest: LeaveRequest | null;
  staffProfile: StaffPublicProfile | null;
  fiscalYear: number;
  staffRecords: LeaveRequest[];
  onClose: () => void;
}

const ThaiGarudaSvg: React.FC = () => (
  <svg
    viewBox="0 0 120 120"
    className="w-16 h-16 text-black"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    aria-label="ตราครุฑ"
  >
    {/* Stylized clean official Thai Garuda crest outline */}
    <path d="M60 12 C54 12 50 18 52 24 C47 22 42 26 45 32 C34 25 18 28 10 38 C16 42 25 43 32 42 C20 48 14 55 12 63 C21 63 31 59 38 54 C30 62 27 70 28 77 C35 73 42 66 46 60 L48 86 L40 105 L52 98 L60 108 L68 98 L80 105 L72 86 L74 60 C78 66 85 73 92 77 C93 70 90 62 82 54 C89 59 99 63 108 63 C106 55 100 48 88 42 C95 43 104 42 110 38 C102 28 86 25 75 32 C78 26 73 22 68 24 C70 18 66 12 60 12 Z" />
    <circle cx="60" cy="48" r="7" />
    <path d="M55 24 L60 17 L65 24" />
  </svg>
);

export const OfficialPrintModal: React.FC<OfficialPrintModalProps> = ({
  open,
  initialTemplate,
  leaveRequest,
  staffProfile,
  fiscalYear,
  staffRecords,
  onClose,
}) => {
  const [template, setTemplate] = useState<PrintTemplateType>(initialTemplate);
  const [privateDetail, setPrivateDetail] = useState<LeaveRequestPrivateDetails | null>(null);
  const [staffPrivate, setStaffPrivate] = useState<StaffPrivatePII | null>(null);

  useEffect(() => {
    setTemplate(initialTemplate);
  }, [initialTemplate]);

  useEffect(() => {
    if (!open) return;
    let active = true;

    const loadDetails = async () => {
      if (leaveRequest) {
        try {
          const snap = await getDoc(
            doc(db, 'leave_requests', leaveRequest.requestId, 'private', 'details')
          );
          if (active) {
            setPrivateDetail(snap.exists() ? (snap.data() as LeaveRequestPrivateDetails) : null);
          }
        } catch {
          if (active) setPrivateDetail(null);
        }
      }
      const targetUid = staffProfile?.uid ?? leaveRequest?.requesterUid;
      if (targetUid) {
        try {
          const snap = await getDoc(doc(db, 'staff_private', targetUid));
          if (active) {
            setStaffPrivate(snap.exists() ? (snap.data() as StaffPrivatePII) : null);
          }
        } catch {
          if (active) setStaffPrivate(null);
        }
      }
    };
    void loadDetails();
    return () => {
      active = false;
    };
  }, [open, leaveRequest?.requestId, staffProfile?.uid]);

  if (!open) return null;

  const todayIso = new Date().toISOString().slice(0, 10);
  const todayParts = getThaiDateParts(todayIso);
  const accDays = leaveRequest?.accumulatedDaysAtSubmit ?? staffProfile?.accumulatedVacationDays ?? 10;
  const quotaDays = leaveRequest?.annualQuotaAtSubmit ?? staffProfile?.annualVacationQuota ?? 10;
  const totalEntitlement = accDays + quotaDays;
  const priorUsed = leaveRequest?.priorUsedDays ?? 0;
  const currentDays = leaveRequest?.workingDays ?? 0;
  const sumUsed = priorUsed + currentDays;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs overflow-y-auto p-2 sm:p-6 print-only-container">
      {/* Control Toolbar (Hidden on Print) */}
      <div className="no-print max-w-4xl mx-auto mb-4 bg-white border border-slate-200 rounded-2xl p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setTemplate('leave_form')}
            className={`min-h-[40px] px-3 py-1.5 text-xs font-medium rounded-xl cursor-pointer ${
              template === 'leave_form'
                ? 'bg-teal-700 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            แบบใบลาพักผ่อน / ใบลา
          </button>
          <button
            type="button"
            onClick={() => setTemplate('record_card')}
            className={`min-h-[40px] px-3 py-1.5 text-xs font-medium rounded-xl cursor-pointer ${
              template === 'record_card'
                ? 'bg-teal-700 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            บัตรบันทึกการลา
          </button>
          <button
            type="button"
            onClick={() => setTemplate('overseas_memo')}
            className={`min-h-[40px] px-3 py-1.5 text-xs font-medium rounded-xl cursor-pointer ${
              template === 'overseas_memo'
                ? 'bg-teal-700 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            บันทึกข้อความไปต่างประเทศ
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-[44px] px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium rounded-xl inline-flex items-center gap-2 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>พิมพ์ / บันทึกเป็น PDF</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่างพิมพ์"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* A4 Official Sheet */}
      <div className="print-sheet max-w-[210mm] min-h-[297mm] mx-auto bg-white text-black font-official p-[14mm] sm:p-[18mm] shadow-lg text-[15px] leading-[1.65]">
        {template === 'leave_form' && (
          <div className="space-y-4">
            <h1 className="text-center text-[18px] font-bold">
              {leaveRequest?.leaveType === 'vacation' || !leaveRequest
                ? 'แบบใบลาพักผ่อน'
                : `แบบใบ${LEAVE_TYPE_LABELS[leaveRequest.leaveType]}`}
            </h1>

            <div className="flex justify-end">
              <div className="w-[52%] space-y-1 text-[15px]">
                <p>
                  เขียนที่{' '}
                  <span className="border-b border-dotted border-black px-2 inline-block min-w-[190px]">
                    {privateDetail?.writtenAt ||
                      leaveRequest?.department ||
                      'สำนักงานสาธารณสุขอำเภอดอนพุด'}
                  </span>
                </p>
                <p>
                  วันที่{' '}
                  <span className="border-b border-dotted border-black px-2 inline-block min-w-[36px] text-center">
                    {todayParts.day}
                  </span>{' '}
                  เดือน{' '}
                  <span className="border-b border-dotted border-black px-2 inline-block min-w-[85px] text-center">
                    {todayParts.month}
                  </span>{' '}
                  พ.ศ.{' '}
                  <span className="border-b border-dotted border-black px-2 inline-block min-w-[50px] text-center">
                    {todayParts.year}
                  </span>
                </p>
              </div>
            </div>

            <div className="space-y-1">
              <p>
                <span className="font-semibold inline-block w-14">เรื่อง</span>
                ขอ{leaveRequest ? LEAVE_TYPE_LABELS[leaveRequest.leaveType] : 'ลาพักผ่อน'}
              </p>
              <p>
                <span className="font-semibold inline-block w-14">เรียน</span>
                <span className="border-b border-dotted border-black px-1 inline-block min-w-[260px]">
                  {privateDetail?.addressedTo || 'สาธารณสุขอำเภอดอนพุด'}
                </span>
              </p>
            </div>

            <div className="space-y-1.5">
              <p className="indent-12">
                ข้าพเจ้า{' '}
                <span className="border-b border-dotted border-black px-2 inline-block min-w-[200px]">
                  {leaveRequest?.requesterName ?? staffProfile?.fullName ?? ''}
                </span>{' '}
                ตำแหน่ง{' '}
                <span className="border-b border-dotted border-black px-2 inline-block min-w-[210px]">
                  {leaveRequest?.requesterPosition ?? staffProfile?.position ?? ''}
                </span>
              </p>
              {(!leaveRequest || leaveRequest.leaveType === 'vacation') ? (
                <p>
                  มีวันลาพักผ่อนสะสม{' '}
                  <span className="border-b border-dotted border-black px-2 inline-block min-w-[44px] text-center tabular-nums">
                    {accDays}
                  </span>{' '}
                  วันทำการ มีสิทธิลาพักผ่อนประจำปีนี้อีก{' '}
                  <span className="border-b border-dotted border-black px-2 inline-block min-w-[40px] text-center tabular-nums">
                    {quotaDays}
                  </span>{' '}
                  วันทำการ รวมเป็น{' '}
                  <span className="border-b border-dotted border-black px-2 inline-block min-w-[44px] text-center tabular-nums">
                    {totalEntitlement}
                  </span>{' '}
                  วันทำการ
                </p>
              ) : (
                <p>
                  เนื่องจาก{' '}
                  <span className="border-b border-dotted border-black px-2 inline-block min-w-[440px]">
                    {privateDetail?.reason || 'มีความจำเป็นตามที่แจ้ง'}
                  </span>
                </p>
              )}
              <p>
                ขอ{leaveRequest ? LEAVE_TYPE_LABELS[leaveRequest.leaveType] : 'ลาพักผ่อน'}ตั้งแต่วันที่{' '}
                <span className="border-b border-dotted border-black px-2 inline-block min-w-[140px] text-center">
                  {leaveRequest ? formatThaiDateFull(leaveRequest.startDate) : ''}
                </span>{' '}
                ถึงวันที่{' '}
                <span className="border-b border-dotted border-black px-2 inline-block min-w-[140px] text-center">
                  {leaveRequest ? formatThaiDateFull(leaveRequest.endDate) : ''}
                </span>{' '}
                มีกำหนด{' '}
                <span className="border-b border-dotted border-black px-2 inline-block min-w-[44px] text-center tabular-nums">
                  {currentDays}
                </span>{' '}
                วัน
              </p>
              <p>
                ในระหว่างลาจะติดต่อข้าพเจ้าได้ที่{' '}
                <span className="border-b border-dotted border-black px-2 inline-block min-w-[360px]">
                  {privateDetail?.contactAddress || staffPrivate?.contactAddress || '-'}
                </span>
              </p>
              <p>
                หมายเลขโทรศัพท์ที่สามารถติดต่อได้{' '}
                <span className="border-b border-dotted border-black px-2 inline-block min-w-[260px] tabular-nums">
                  {privateDetail?.contactPhone || staffPrivate?.phone || '-'}
                </span>
              </p>
            </div>

            <div className="flex justify-end pt-3">
              <div className="w-[46%] text-center space-y-1">
                <p>
                  (ลงชื่อ)....................................................
                </p>
                <p>({leaveRequest?.requesterName ?? staffProfile?.fullName ?? ''})</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-8 pt-4">
              {/* Left Column: Statistics, Verifier, Note */}
              <div className="space-y-4">
                <div>
                  <p className="text-center font-semibold mb-1.5">สถิติการลาในปีงบประมาณนี้</p>
                  <table className="w-full border-collapse border border-black text-center text-[14px]">
                    <thead>
                      <tr>
                        <th className="border border-black py-1 px-1.5 font-normal">
                          ลามาแล้ว<br />(วันทำการ)
                        </th>
                        <th className="border border-black py-1 px-1.5 font-normal">
                          ลาครั้งนี้<br />(วันทำการ)
                        </th>
                        <th className="border border-black py-1 px-1.5 font-normal">
                          รวมเป็น<br />(วันทำการ)
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="h-10 tabular-nums font-semibold">
                        <td className="border border-black">{priorUsed}</td>
                        <td className="border border-black">{currentDays}</td>
                        <td className="border border-black">{sumUsed}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="space-y-1 text-[14px] pt-2">
                  <p>
                    (ลงชื่อ){' '}
                    <span className="border-b border-dotted border-black px-2 inline-block min-w-[140px]">
                      {leaveRequest?.verifierName || ''}
                    </span>{' '}
                    ผู้ตรวจสอบ
                  </p>
                  <p>
                    ตำแหน่ง{' '}
                    <span className="border-b border-dotted border-black px-2 inline-block min-w-[190px]">
                      {leaveRequest?.verifierPosition || ''}
                    </span>
                  </p>
                  <p>
                    วันที่{' '}
                    <span className="border-b border-dotted border-black px-2 inline-block min-w-[180px]">
                      {leaveRequest?.verifiedAt ? formatThaiDateFull(leaveRequest.verifiedAt) : ''}
                    </span>
                  </p>
                </div>

                <div className="pt-4 space-y-1 text-[14px]">
                  <p className="font-bold">หมายเหตุ</p>
                  <p>ในการลาครั้งนี้ ข้าพเจ้าขอมอบหมายงานให้</p>
                  <p>
                    นาย/นาง/นางสาว{' '}
                    <span className="border-b border-dotted border-black px-2 inline-block min-w-[130px]">
                      {leaveRequest?.substituteName || '-'}
                    </span>{' '}
                    ปฏิบัติงานแทน
                  </p>
                  <p className="pl-6">
                    (ลงชื่อ).......................................ผู้รับมอบ
                  </p>
                </div>
              </div>

              {/* Right Column: Supervisor Opinion & Authority Order */}
              <div className="space-y-6">
                <div className="space-y-2 text-[14px]">
                  <p className="font-bold">ความเห็นของผู้บังคับบัญชา</p>
                  <p className="border-b border-dotted border-black min-h-[24px]">
                    {leaveRequest?.supervisorComment || ''}
                  </p>
                  <p className="border-b border-dotted border-black min-h-[24px]" />
                  <div className="pt-2 space-y-1">
                    <p>
                      (ลงชื่อ){' '}
                      <span className="border-b border-dotted border-black px-2 inline-block min-w-[175px]">
                        {leaveRequest?.supervisorName || ''}
                      </span>
                    </p>
                    <p>
                      (ตำแหน่ง){' '}
                      <span className="border-b border-dotted border-black px-2 inline-block min-w-[170px]">
                        {leaveRequest?.supervisorPosition || ''}
                      </span>
                    </p>
                    <p>
                      วันที่{' '}
                      <span className="border-b border-dotted border-black px-2 inline-block min-w-[190px]">
                        {leaveRequest?.decisionAt
                          ? formatThaiDateFull(leaveRequest.decisionAt)
                          : ''}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="space-y-2 text-[14px] pt-4">
                  <p className="font-bold">คำสั่งผู้มีอำนาจอนุญาต</p>
                  <p className="pl-6 space-x-6">
                    <span>
                      ({leaveRequest?.status === 'approved' ? ' ✓ ' : '   '}) อนุญาต
                    </span>
                    <span>
                      ({leaveRequest?.status === 'rejected' ? ' ✓ ' : '   '}) ไม่อนุญาต
                    </span>
                  </p>
                  <div className="pt-4 space-y-1 text-center">
                    <p>
                      (ลงชื่อ){' '}
                      <span className="border-b border-dotted border-black px-2 inline-block min-w-[180px]">
                        {leaveRequest?.supervisorName || ''}
                      </span>
                    </p>
                    <p>
                      (
                      <span className="border-b border-dotted border-black px-2 inline-block min-w-[170px]">
                        {leaveRequest?.supervisorName || ''}
                      </span>
                      )
                    </p>
                    <p className="text-left">
                      (ตำแหน่ง){' '}
                      <span className="border-b border-dotted border-black px-2 inline-block min-w-[175px]">
                        {leaveRequest?.supervisorPosition || ''}
                      </span>
                    </p>
                    <p className="text-left">
                      วันที่{' '}
                      <span className="border-b border-dotted border-black px-2 inline-block min-w-[195px]">
                        {leaveRequest?.decisionAt
                          ? formatThaiDateFull(leaveRequest.decisionAt)
                          : ''}
                      </span>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {template === 'record_card' && (
          <div className="space-y-3">
            <h1 className="text-center text-[17px] font-bold">
              บัตรบันทึกการลาของข้าราชการ ลูกจ้าง และเจ้าหน้าที่
            </h1>
            <p className="text-center font-semibold">
              หน่วยงาน{' '}
              <span className="border-b border-dotted border-black px-4 inline-block min-w-[260px]">
                {staffProfile?.department ?? leaveRequest?.department ?? 'สำนักงานสาธารณสุขอำเภอดอนพุด'}
              </span>
            </p>

            <div className="space-y-1 text-[14px] pt-1">
              <p>
                ชื่อ{' '}
                <span className="border-b border-dotted border-black px-2 inline-block min-w-[220px]">
                  {staffProfile?.fullName ?? leaveRequest?.requesterName ?? ''}
                </span>{' '}
                อายุ{' '}
                <span className="border-b border-dotted border-black px-2 inline-block min-w-[45px] text-center tabular-nums">
                  {staffPrivate?.age ?? ''}
                </span>{' '}
                ปี บรรจุเมื่อ{' '}
                <span className="border-b border-dotted border-black px-2 inline-block min-w-[160px]">
                  {staffPrivate?.hireDate ?? ''}
                </span>
              </p>
              <p>
                ตำแหน่ง{' '}
                <span className="border-b border-dotted border-black px-2 inline-block min-w-[210px]">
                  {staffProfile?.position ?? leaveRequest?.requesterPosition ?? ''}
                </span>{' '}
                ขณะนี้ปฏิบัติงานที่{' '}
                <span className="border-b border-dotted border-black px-2 inline-block min-w-[200px]">
                  {staffProfile?.department ?? leaveRequest?.department ?? ''}
                </span>
              </p>
            </div>

            <table className="w-full border-collapse border border-black text-[13px] mt-2">
              <thead>
                <tr>
                  <th rowSpan={2} className="border border-black py-1 px-1.5 text-center w-12">
                    ลำดับ<br />ที่
                  </th>
                  <th rowSpan={2} className="border border-black py-1 px-2 text-center w-36">
                    วัน เดือน ปี
                  </th>
                  <th colSpan={6} className="border border-black py-1 px-2 text-center">
                    รายการลา
                  </th>
                  <th rowSpan={2} className="border border-black py-1 px-2 text-center w-32">
                    ผู้อนุมัติ
                  </th>
                  <th rowSpan={2} className="border border-black py-1 px-2 text-center">
                    หมายเหตุ
                  </th>
                </tr>
                <tr>
                  <th className="border border-black py-1 px-1.5 text-center">ลากิจ</th>
                  <th className="border border-black py-1 px-1.5 text-center">ลาป่วย</th>
                  <th className="border border-black py-1 px-1.5 text-center">ลาพักผ่อน</th>
                  <th className="border border-black py-1 px-1.5 text-center">ลาคลอด</th>
                  <th className="border border-black py-1 px-1.5 text-center">ลาบวช</th>
                  <th className="border border-black py-1 px-1.5 text-center">อื่นๆ</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {Array.from({ length: Math.max(16, staffRecords.length) }).map((_, idx) => {
                  const rec = staffRecords[idx];
                  return (
                    <tr key={idx} className="h-7">
                      <td className="border border-black px-1.5 text-center">
                        {rec ? idx + 1 : ''}
                      </td>
                      <td className="border border-black px-1.5 text-xs">
                        {rec ? `${formatThaiDateFull(rec.startDate)}` : ''}
                      </td>
                      <td className="border border-black px-1 text-center">
                        {rec?.leaveType === 'personal' ? rec.workingDays : ''}
                      </td>
                      <td className="border border-black px-1 text-center">
                        {rec?.leaveType === 'sick' ? rec.workingDays : ''}
                      </td>
                      <td className="border border-black px-1 text-center">
                        {rec && (rec.leaveType === 'vacation' || rec.leaveType === 'overseas')
                          ? rec.workingDays
                          : ''}
                      </td>
                      <td className="border border-black px-1 text-center">
                        {rec?.leaveType === 'maternity' ? rec.workingDays : ''}
                      </td>
                      <td className="border border-black px-1 text-center">
                        {rec?.leaveType === 'ordination' ? rec.workingDays : ''}
                      </td>
                      <td className="border border-black px-1 text-center">
                        {rec?.leaveType === 'other' ? rec.workingDays : ''}
                      </td>
                      <td className="border border-black px-1.5 text-xs">
                        {rec?.supervisorName ?? ''}
                      </td>
                      <td className="border border-black px-1.5 text-xs">
                        {rec ? (rec.status === 'approved' ? `ปีงบ ${fiscalYear}` : 'รอดำเนินการ') : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {template === 'overseas_memo' && (
          <div className="space-y-3 text-[14.5px]">
            <div className="flex items-end gap-6">
              <ThaiGarudaSvg />
              <h1 className="text-[22px] font-bold flex-1 text-center pr-16">บันทึกข้อความ</h1>
            </div>

            <div className="space-y-1 border-b border-black pb-2">
              <p>
                <span className="font-bold">ส่วนราชการ</span>{' '}
                <span className="border-b border-dotted border-black px-2 inline-block min-w-[460px]">
                  {leaveRequest?.department ?? 'สำนักงานสาธารณสุขอำเภอดอนพุด จังหวัดสระบุรี'}
                </span>
              </p>
              <div className="grid grid-cols-2 gap-4">
                <p>
                  <span className="font-bold">ที่</span>{' '}
                  <span className="border-b border-dotted border-black px-2 inline-block min-w-[200px]">
                    {leaveRequest?.documentNo || 'สบ ๐๔๓๒/'}
                  </span>
                </p>
                <p>
                  <span className="font-bold">วันที่</span>{' '}
                  <span className="border-b border-dotted border-black px-2 inline-block min-w-[200px]">
                    {formatThaiDateFull(todayIso)}
                  </span>
                </p>
              </div>
              <p>
                <span className="font-bold">เรื่อง</span> ขออนุญาตไปต่างประเทศ
              </p>
            </div>

            <p>
              <span className="font-bold">เรียน</span>{' '}
              {privateDetail?.addressedTo || 'ผู้ว่าราชการจังหวัดสระบุรี'}
            </p>

            <div className="space-y-1">
              <p className="indent-12">
                ด้วยข้าพเจ้า{' '}
                <span className="border-b border-dotted border-black px-2 inline-block min-w-[180px]">
                  {leaveRequest?.requesterName ?? staffProfile?.fullName ?? ''}
                </span>{' '}
                ตำแหน่ง{' '}
                <span className="border-b border-dotted border-black px-2 inline-block min-w-[180px]">
                  {leaveRequest?.requesterPosition ?? staffProfile?.position ?? ''}
                </span>
              </p>
              <p>
                สังกัด{' '}
                <span className="border-b border-dotted border-black px-2 inline-block min-w-[210px]">
                  {leaveRequest?.department ?? staffProfile?.department ?? ''}
                </span>{' '}
                ประสงค์จะขออนุญาตเดินทางไปต่างประเทศ ณ{' '}
                <span className="border-b border-dotted border-black px-2 inline-block min-w-[120px]">
                  {privateDetail?.overseasCountry || ''}
                </span>
              </p>
              <p>
                เพื่อ{' '}
                <span className="border-b border-dotted border-black px-2 inline-block min-w-[480px]">
                  {privateDetail?.overseasPurpose || privateDetail?.reason || ''}
                </span>
              </p>
              <p>
                ตั้งแต่วันที่{' '}
                <span className="border-b border-dotted border-black px-2 inline-block min-w-[140px]">
                  {leaveRequest ? formatThaiDateFull(leaveRequest.startDate) : ''}
                </span>{' '}
                ถึงวันที่{' '}
                <span className="border-b border-dotted border-black px-2 inline-block min-w-[140px]">
                  {leaveRequest ? formatThaiDateFull(leaveRequest.endDate) : ''}
                </span>{' '}
                รวมจำนวน{' '}
                <span className="border-b border-dotted border-black px-2 inline-block min-w-[50px] text-center tabular-nums">
                  {leaveRequest?.workingDays ?? ''}
                </span>{' '}
                วัน โดย
              </p>
            </div>

            <div className="pl-12 space-y-2 text-[14px]">
              <div className="flex items-start gap-2">
                <span className="inline-block w-4 h-4 border border-black text-center leading-3 text-xs mt-1">
                  {(privateDetail?.holidayDays ?? 0) > 0 ? '✓' : ''}
                </span>
                <div>
                  เดินทางในวันหยุดราชการ จำนวน{' '}
                  <span className="border-b border-dotted border-black px-2 inline-block min-w-[40px] text-center tabular-nums">
                    {privateDetail?.holidayDays || ''}
                  </span>{' '}
                  วัน ตั้งแต่วันที่{' '}
                  <span className="border-b border-dotted border-black px-2 inline-block min-w-[170px]">
                    {privateDetail?.holidayRange || ''}
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <span className="inline-block w-4 h-4 border border-black text-center leading-3 text-xs mt-1">
                  {(privateDetail?.personalDays ?? 0) > 0 ? '✓' : ''}
                </span>
                <div>
                  ได้รับอนุญาตให้ลากิจส่วนตัว จำนวน{' '}
                  <span className="border-b border-dotted border-black px-2 inline-block min-w-[40px] text-center tabular-nums">
                    {privateDetail?.personalDays || ''}
                  </span>{' '}
                  วัน ตั้งแต่วันที่{' '}
                  <span className="border-b border-dotted border-black px-2 inline-block min-w-[170px]">
                    {privateDetail?.personalRange || ''}
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <span className="inline-block w-4 h-4 border border-black text-center leading-3 text-xs mt-1">
                  {(privateDetail?.vacationDays ?? 0) > 0 ? '✓' : ''}
                </span>
                <div>
                  ได้รับอนุญาตให้ลาพักผ่อน จำนวน{' '}
                  <span className="border-b border-dotted border-black px-2 inline-block min-w-[40px] text-center tabular-nums">
                    {privateDetail?.vacationDays || ''}
                  </span>{' '}
                  วัน ตั้งแต่วันที่{' '}
                  <span className="border-b border-dotted border-black px-2 inline-block min-w-[170px]">
                    {privateDetail?.vacationRange || ''}
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <span className="inline-block w-4 h-4 border border-black text-center leading-3 text-xs mt-1">
                  {(privateDetail?.otherDays ?? 0) > 0 ? '✓' : ''}
                </span>
                <div>
                  อื่นๆ (ระบุ){' '}
                  <span className="border-b border-dotted border-black px-2 inline-block min-w-[160px]">
                    {privateDetail?.otherLabel || ''}
                  </span>{' '}
                  จำนวน{' '}
                  <span className="border-b border-dotted border-black px-2 inline-block min-w-[40px] text-center tabular-nums">
                    {privateDetail?.otherDays || ''}
                  </span>{' '}
                  วัน
                </div>
              </div>
            </div>

            <div className="space-y-0.5 pt-1">
              <p>ตามสำเนาใบลาที่แนบมาพร้อมนี้ จำนวน ๑ ฉบับ</p>
              <p className="indent-16">จึงเรียนมาเพื่อโปรดพิจารณาอนุญาต</p>
            </div>

            <div className="flex justify-end pt-2">
              <div className="w-[54%] space-y-4 text-[14px]">
                <div className="space-y-0.5 text-center">
                  <p>(ลงชื่อ)....................................................ผู้ขอเดินทาง</p>
                  <p>({leaveRequest?.requesterName ?? staffProfile?.fullName ?? ''})</p>
                  <p className="text-left">
                    ตำแหน่ง {leaveRequest?.requesterPosition ?? staffProfile?.position ?? ''}
                  </p>
                </div>

                <div className="space-y-0.5 text-center pt-1">
                  <p>(ลงชื่อ)....................................................ผู้บังคับบัญชาชั้นต้น</p>
                  <p>({leaveRequest?.supervisorName || '........................................'})</p>
                  <p className="text-left">
                    ตำแหน่ง {leaveRequest?.supervisorPosition || 'สาธารณสุขอำเภอดอนพุด'}
                  </p>
                </div>
              </div>
            </div>

            <table className="w-full border-collapse border border-black text-[13.5px] mt-3">
              <thead>
                <tr>
                  <th className="border border-black py-1.5 px-3 text-center w-1/2">
                    ความเห็นผู้บังคับบัญชา
                  </th>
                  <th className="border border-black py-1.5 px-3 text-center w-1/2">
                    คำสั่งของผู้ว่าราชการจังหวัดสระบุรี
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-black p-3 space-y-2 align-top">
                    <p>[ ] เห็นสมควรอนุญาต</p>
                    <p>[ ] ไม่เห็นสมควรอนุญาต เนื่องจาก ...............................</p>
                    <p className="border-b border-dotted border-black pt-3" />
                    <div className="pt-3 text-center space-y-0.5">
                      <p>(ลงชื่อ)..............................................นพ.สสจ.</p>
                      <p>(........................................................)</p>
                      <p className="text-left">ตำแหน่ง................................................</p>
                      <p className="text-left">วันที่....................................................</p>
                    </div>
                  </td>
                  <td className="border border-black p-3 space-y-2 align-top">
                    <p>[ ] อนุญาต</p>
                    <p>[ ] ไม่อนุญาต เนื่องจาก ..........................................</p>
                    <p className="border-b border-dotted border-black pt-3" />
                    <div className="pt-3 text-center space-y-0.5">
                      <p>(ลงชื่อ)..............................................ผู้ว่าราชการจังหวัด</p>
                      <p>(........................................................)</p>
                      <p className="text-left">ตำแหน่ง................................................</p>
                      <p className="text-left">วันที่....................................................</p>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
