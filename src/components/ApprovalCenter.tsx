import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  CheckCircle2,
  XCircle,
  MessageSquare,
  ExternalLink,
  Printer,
  ShieldCheck,
  Clock,
  Copy,
  Check,
  Send,
  Pencil,
} from 'lucide-react';
import { EditLeaveModal } from './EditLeaveModal';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { formatThaiDateFull, formatThaiDateShort } from '../lib/thaiDate';
import {
  LEAVE_STATUS_LABELS,
  LEAVE_TYPE_LABELS,
  MAX_LENGTHS,
} from '../types/leave';
import type {
  LeaveAuditLog,
  LeaveRequest,
  LeaveRequestPrivateDetails,
  StaffPublicProfile,
  TelegramDispatchResponse,
} from '../types/leave';

interface ApprovalCenterProps {
  currentStaff: StaffPublicProfile;
  staffList: StaffPublicProfile[];
  leaveRequests: LeaveRequest[];
  departments?: string[];
  selectedRequest: LeaveRequest | null;
  deepLinkBanner?: { requestId: string; validToken: boolean } | null;
  lastTelegramDispatch: TelegramDispatchResponse | null;
  isAdmin: boolean;
  onSelectRequest: (req: LeaveRequest) => void;
  onOpenPrint: (req: LeaveRequest) => void;
  getIdToken: () => Promise<string | null>;
}

export const ApprovalCenter: React.FC<ApprovalCenterProps> = ({
  currentStaff,
  staffList,
  leaveRequests,
  departments,
  selectedRequest,
  deepLinkBanner,
  lastTelegramDispatch,
  isAdmin,
  onSelectRequest,
  onOpenPrint,
  getIdToken,
}) => {
  const [filterMode, setFilterMode] = useState<'pending' | 'mine' | 'all'>('pending');
  const [comment, setComment] = useState('');
  const [processing, setProcessing] = useState(false);
  const [actionMsg, setActionMsg] = useState('');
  const [actionErr, setActionErr] = useState('');

  const [privateDetails, setPrivateDetails] = useState<LeaveRequestPrivateDetails | null>(null);
  const [auditLogs, setAuditLogs] = useState<LeaveAuditLog[]>([]);
  const [telegramPreview, setTelegramPreview] = useState<TelegramDispatchResponse | null>(
    lastTelegramDispatch
  );
  const [telegramSending, setTelegramSending] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);

  const canVerify =
    isAdmin || ['verifier', 'supervisor', 'executive', 'admin'].includes(currentStaff.role);
  const canApprove = isAdmin || ['supervisor', 'executive', 'admin'].includes(currentStaff.role);

  useEffect(() => {
    if (lastTelegramDispatch) {
      setTelegramPreview(lastTelegramDispatch);
    }
  }, [lastTelegramDispatch]);

  const visibleRequests = useMemo(() => {
    if (filterMode === 'pending') {
      return leaveRequests.filter(
        (r) => r.status === 'pending_verifier' || r.status === 'pending_supervisor'
      );
    }
    if (filterMode === 'mine') {
      return leaveRequests.filter((r) => r.requesterUid === currentStaff.uid);
    }
    return leaveRequests;
  }, [leaveRequests, filterMode, currentStaff.uid]);

  const activeReq = selectedRequest ?? visibleRequests[0] ?? leaveRequests[0] ?? null;

  // Load isolated private details & audit logs when active request changes
  useEffect(() => {
    if (!activeReq) {
      setPrivateDetails(null);
      setAuditLogs([]);
      return;
    }

    let isMounted = true;
    const loadPrivate = async () => {
      if (activeReq.requesterUid !== currentStaff.uid && !canVerify) {
        if (isMounted) setPrivateDetails(null);
        return;
      }
      try {
        const snap = await getDoc(
          doc(db, 'leave_requests', activeReq.requestId, 'private', 'details')
        );
        if (isMounted) {
          setPrivateDetails(snap.exists() ? (snap.data() as LeaveRequestPrivateDetails) : null);
        }
      } catch {
        if (isMounted) setPrivateDetails(null);
      }
    };
    void loadPrivate();

    const logsQuery = query(
      collection(db, 'leave_requests', activeReq.requestId, 'audit_logs'),
      where('actorUid', '>=', '')
    );
    const unsub = onSnapshot(
      logsQuery,
      (snap) => {
        if (isMounted) {
          const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as LeaveAuditLog) }));
          items.sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
          setAuditLogs(items);
        }
      },
      (err) => {
        console.warn('Audit log read skipped:', err.message);
      }
    );

    return () => {
      isMounted = false;
      unsub();
    };
  }, [activeReq?.requestId, activeReq?.requesterUid, currentStaff.uid, canVerify]);

  const handleDispatchTelegram = async (
    req: LeaveRequest,
    recipientRole: 'verifier' | 'supervisor' | 'requester'
  ) => {
    setTelegramSending(true);
    setActionErr('');
    try {
      const token = await getIdToken();
      if (!token) throw new Error('กรุณาเข้าสู่ระบบใหม่อีกครั้ง');
      const res = await fetch('/api/telegram/notify-approval', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          requestId: req.requestId,
          requesterName: req.requesterName,
          requesterPosition: req.requesterPosition,
          department: req.department,
          leaveTypeLabel: LEAVE_TYPE_LABELS[req.leaveType],
          startDateTh: formatThaiDateFull(req.startDate),
          endDateTh: formatThaiDateFull(req.endDate),
          workingDays: req.workingDays,
          substituteName: req.substituteName ?? '',
          recipientRole,
        }),
      });
      const data = (await res.json()) as TelegramDispatchResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || 'สร้างแจ้งเตือน Telegram ไม่สำเร็จ');
      setTelegramPreview(data);

      const batch = writeBatch(db);
      const notifId = `tg_${Date.now()}`;
      batch.set(doc(db, 'telegram_notifications', notifId), {
        notificationId: notifId,
        requestId: req.requestId,
        senderUid: currentStaff.uid,
        recipientRole,
        channelMode: data.channelMode,
        deliveryStatus: data.delivered ? 'sent' : 'ready_to_share',
        summaryText: data.summaryText.slice(0, 480),
        createdAt: serverTimestamp(),
      });
      if (req.status === 'pending_verifier' || req.status === 'pending_supervisor') {
        batch.update(doc(db, 'leave_requests', req.requestId), {
          telegramNotifiedAt: new Date().toISOString().slice(0, 19),
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
      setActionMsg(
        data.delivered
          ? 'ส่งข้อความแจ้งเตือนผ่าน Telegram Bot API สำเร็จแล้ว'
          : 'สร้างข้อความแจ้งเตือน Telegram และปุ่มอนุมัติพร้อมส่งเรียบร้อยแล้ว'
      );
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : 'ไม่สามารถสร้างแจ้งเตือน Telegram ได้');
    } finally {
      setTelegramSending(false);
    }
  };

  const handleVerifyStep = async (req: LeaveRequest) => {
    setProcessing(true);
    setActionErr('');
    setActionMsg('');
    const todayIso = new Date().toISOString().slice(0, 10);

    const batch = writeBatch(db);
    batch.update(doc(db, 'leave_requests', req.requestId), {
      status: 'pending_supervisor',
      verifierUid: currentStaff.uid,
      verifierName: currentStaff.fullName,
      verifierPosition: currentStaff.position,
      verifiedAt: todayIso,
      supervisorComment: comment.trim().slice(0, MAX_LENGTHS.supervisorComment),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'leave_requests', req.requestId, 'audit_logs', `log_${Date.now()}`), {
      actorUid: currentStaff.uid,
      actorName: currentStaff.fullName,
      action: 'verified',
      note: 'ตรวจสอบสถิติวันลาถูกต้อง ส่งต่อผู้มีอำนาจอนุญาต',
      createdAt: serverTimestamp(),
    });

    try {
      await batch.commit();
      setComment('');
      setActionMsg('รับรองสถิติการลาและส่งต่อผู้มีอำนาจอนุญาตแล้ว');
      await handleDispatchTelegram(req, 'supervisor');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `leave_requests/${req.requestId}`);
    } finally {
      setProcessing(false);
    }
  };

  const handleFinalDecision = async (req: LeaveRequest, decision: 'approved' | 'rejected') => {
    setProcessing(true);
    setActionErr('');
    setActionMsg('');
    const todayIso = new Date().toISOString().slice(0, 10);

    const batch = writeBatch(db);
    batch.update(doc(db, 'leave_requests', req.requestId), {
      status: decision,
      supervisorUid: currentStaff.uid,
      supervisorName: currentStaff.fullName,
      supervisorPosition: currentStaff.position,
      supervisorComment:
        comment.trim().slice(0, MAX_LENGTHS.supervisorComment) ||
        (decision === 'approved' ? 'อนุญาตตามเสนอ' : 'ไม่อนุญาต'),
      decisionAt: todayIso,
      updatedAt: serverTimestamp(),
    });

    if (decision === 'approved') {
      const targetStaff = staffList.find((s) => s.uid === req.requesterUid);
      if (targetStaff) {
        const days = Number(req.workingDays) || 0;
        const balanceUpdate: Record<string, unknown> = {
          updatedAt: serverTimestamp(),
        };
        if (req.leaveType === 'vacation' || req.leaveType === 'overseas') {
          balanceUpdate.usedVacationDays = (targetStaff.usedVacationDays || 0) + days;
        } else if (req.leaveType === 'sick') {
          balanceUpdate.usedSickDays = (targetStaff.usedSickDays || 0) + days;
        } else if (req.leaveType === 'personal') {
          balanceUpdate.usedPersonalDays = (targetStaff.usedPersonalDays || 0) + days;
        } else {
          balanceUpdate.usedOtherDays = (targetStaff.usedOtherDays || 0) + days;
        }
        batch.update(doc(db, 'staff_directory', targetStaff.uid), balanceUpdate);
      }
    }

    batch.set(doc(db, 'leave_requests', req.requestId, 'audit_logs', `log_${Date.now()}`), {
      actorUid: currentStaff.uid,
      actorName: currentStaff.fullName,
      action: decision,
      note:
        comment.trim().slice(0, MAX_LENGTHS.supervisorComment) ||
        (decision === 'approved' ? 'อนุมัติคำขอการลา' : 'ไม่อนุญาตคำขอการลา'),
      createdAt: serverTimestamp(),
    });

    try {
      await batch.commit();
      setComment('');
      setActionMsg(
        decision === 'approved'
          ? 'อนุมัติการลาและปรับปรุงสถิติวันลาของบุคลากรเรียบร้อยแล้ว'
          : 'บันทึกผลการไม่อนุญาตเรียบร้อยแล้ว'
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `leave_requests/${req.requestId}`);
    } finally {
      setProcessing(false);
    }
  };

  const handleCancelOwn = async (req: LeaveRequest) => {
    setProcessing(true);
    setActionErr('');
    const batch = writeBatch(db);
    batch.update(doc(db, 'leave_requests', req.requestId), {
      status: 'cancelled',
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'leave_requests', req.requestId, 'audit_logs', `log_${Date.now()}`), {
      actorUid: currentStaff.uid,
      actorName: currentStaff.fullName,
      action: 'cancelled',
      note: 'ผู้ยื่นขอยกเลิกคำขอการลา',
      createdAt: serverTimestamp(),
    });

    try {
      await batch.commit();
      setActionMsg('ยกเลิกคำขอการลาเรียบร้อยแล้ว');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `leave_requests/${req.requestId}`);
    } finally {
      setProcessing(false);
    }
  };

  const handleCopyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      // Clipboard fallback ignored
    }
  };

  return (
    <div className="space-y-6">
      {deepLinkBanner && (
        <div
          className={`border rounded-xl p-4 flex items-center justify-between gap-3 ${
            deepLinkBanner.validToken
              ? 'bg-teal-50 border-teal-200 text-teal-900'
              : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}
        >
          <div className="flex items-center gap-2.5 text-sm">
            <ShieldCheck className="w-5 h-5 shrink-0" />
            <span>
              {deepLinkBanner.validToken
                ? `เปิดจากลิงก์แจ้งเตือน Telegram สำเร็จ · ยืนยันลายเซ็นคำขอ ${deepLinkBanner.requestId} แล้ว`
                : `เปิดคำขอ ${deepLinkBanner.requestId} จากลิงก์ภายนอก กรุณาตรวจสอบรายละเอียดก่อนลงนาม`}
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Queue */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-100 space-y-3">
            <h2 className="text-base font-semibold text-slate-900">
              ศูนย์อนุมัติและแจ้งเตือนผ่าน Telegram
            </h2>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
              {(
                [
                  { id: 'pending', label: 'รอดำเนินการ' },
                  { id: 'mine', label: 'คำขอของฉัน' },
                  { id: 'all', label: 'ทั้งหมด' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilterMode(tab.id)}
                  className={`flex-1 min-h-[40px] px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                    filterMode === tab.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {visibleRequests.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              ไม่มีรายการคำขอการลาในหมวดหมู่นี้
            </div>
          ) : (
            <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
              {visibleRequests.map((req) => {
                const isSelected = activeReq?.requestId === req.requestId;
                return (
                  <button
                    key={req.requestId}
                    type="button"
                    onClick={() => onSelectRequest(req)}
                    className={`w-full text-left p-4 transition-colors cursor-pointer ${
                      isSelected ? 'bg-teal-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{req.requesterName}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {LEAVE_TYPE_LABELS[req.leaveType]} · {req.department}
                        </p>
                      </div>
                      <span className="text-xs font-bold text-slate-900 tabular-nums shrink-0">
                        {req.workingDays} วัน
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="text-slate-500 tabular-nums">
                        {formatThaiDateShort(req.startDate)} – {formatThaiDateShort(req.endDate)}
                      </span>
                      <span
                        className={`font-medium ${
                          req.status === 'approved'
                            ? 'text-emerald-700'
                            : req.status === 'rejected' || req.status === 'cancelled'
                              ? 'text-rose-700'
                              : 'text-amber-700'
                        }`}
                      >
                        {LEAVE_STATUS_LABELS[req.status]}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Detail, Approval Actions & Telegram Real-Time Card */}
        <div className="lg:col-span-7 space-y-6">
          {!activeReq ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
              เลือกคำขอการลาจากรายการด้านซ้ายเพื่อตรวจสอบรายละเอียด อนุมัติ หรือส่งแจ้งเตือนผ่าน Telegram
            </div>
          ) : (
            <>
              <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-slate-100 pb-4">
                  <div>
                    <p className="text-xs font-medium text-teal-700">
                      {activeReq.documentNo ?? activeReq.requestId} · {LEAVE_STATUS_LABELS[activeReq.status]}
                    </p>
                    <h3 className="text-xl font-bold text-slate-900 mt-1">
                      {activeReq.requesterName}
                    </h3>
                    <p className="text-sm text-slate-600">
                      {activeReq.requesterPosition} · {activeReq.department}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {(isAdmin ||
                      ((activeReq.status === 'pending_verifier' ||
                        activeReq.status === 'pending_supervisor') &&
                        (activeReq.requesterUid === currentStaff.uid || canVerify))) && (
                      <button
                        type="button"
                        onClick={() => setEditModalOpen(true)}
                        className="min-h-[44px] px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl inline-flex items-center justify-center gap-2 shrink-0 cursor-pointer"
                      >
                        <Pencil className="w-4 h-4" />
                        <span>แก้ไขใบลา</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onOpenPrint(activeReq)}
                      className="min-h-[44px] px-4 py-2 text-sm font-medium text-teal-800 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded-xl inline-flex items-center justify-center gap-2 shrink-0 cursor-pointer"
                    >
                      <Printer className="w-4 h-4" />
                      <span>พิมพ์แบบฟอร์ม PDF</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div className="border border-slate-200 rounded-xl p-3">
                    <p className="text-xs text-slate-500">ประเภท</p>
                    <p className="font-semibold text-slate-900 mt-0.5">
                      {LEAVE_TYPE_LABELS[activeReq.leaveType]}
                    </p>
                  </div>
                  <div className="border border-slate-200 rounded-xl p-3">
                    <p className="text-xs text-slate-500">จำนวนวันลา</p>
                    <p className="font-semibold text-teal-700 tabular-nums mt-0.5">
                      {activeReq.workingDays} วันทำการ
                    </p>
                  </div>
                  <div className="border border-slate-200 rounded-xl p-3 col-span-2">
                    <p className="text-xs text-slate-500">ช่วงวันที่ลา</p>
                    <p className="font-semibold text-slate-900 mt-0.5">
                      {formatThaiDateFull(activeReq.startDate)} ถึง {formatThaiDateFull(activeReq.endDate)}
                    </p>
                  </div>
                </div>

                <div className="text-sm space-y-2 border-t border-slate-100 pt-4">
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-500">ผู้ปฏิบัติงานแทน</span>
                    <span className="font-medium text-slate-900">
                      {activeReq.substituteName || '-'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-500">สถิติลามาแล้ว (ปีงบ {activeReq.fiscalYear})</span>
                    <span className="font-medium text-slate-900 tabular-nums">
                      {activeReq.priorUsedDays} วันทำการ
                    </span>
                  </div>
                  {privateDetails && (
                    <>
                      <div className="flex justify-between gap-4">
                        <span className="text-slate-500">เหตุผลการลา</span>
                        <span className="font-medium text-slate-900 text-right">
                          {privateDetails.reason || '-'}
                        </span>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span className="text-slate-500">ติดต่อระหว่างลา</span>
                        <span className="font-medium text-slate-900 text-right">
                          {privateDetails.contactAddress || '-'} ({privateDetails.contactPhone || '-'})
                        </span>
                      </div>
                      {activeReq.leaveType === 'overseas' && (
                        <div className="flex justify-between gap-4">
                          <span className="text-slate-500">ประเทศ / วัตถุประสงค์</span>
                          <span className="font-medium text-slate-900 text-right">
                            {privateDetails.overseasCountry} · {privateDetails.overseasPurpose}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {actionMsg && (
                  <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                    {actionMsg}
                  </div>
                )}
                {actionErr && (
                  <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">
                    {actionErr}
                  </div>
                )}

                {/* Approval Action Controls */}
                {(activeReq.status === 'pending_verifier' ||
                  activeReq.status === 'pending_supervisor') && (
                  <div className="border-t border-slate-100 pt-4 space-y-3">
                    {(canVerify || canApprove) && (
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1.5">
                          ความเห็นผู้ตรวจสอบ / ผู้บังคับบัญชา
                        </label>
                        <input
                          type="text"
                          maxLength={MAX_LENGTHS.supervisorComment}
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                          placeholder="เช่น เห็นสมควรอนุญาต / มอบหมายงานเรียบร้อย"
                          className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl"
                        />
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2.5">
                      {activeReq.status === 'pending_verifier' && canVerify && (
                        <button
                          type="button"
                          disabled={processing}
                          onClick={() => void handleVerifyStep(activeReq)}
                          className="flex-1 min-h-[44px] px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium rounded-xl flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <Clock className="w-4 h-4" />
                          <span>รับรองสถิติและส่งต่อผู้มีอำนาจอนุญาต</span>
                        </button>
                      )}

                      {canApprove && (
                        <>
                          <button
                            type="button"
                            disabled={processing}
                            onClick={() => void handleFinalDecision(activeReq, 'approved')}
                            className="flex-1 min-h-[44px] px-4 py-2 bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-medium rounded-xl flex items-center justify-center gap-2 cursor-pointer"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            <span>อนุญาตการลา</span>
                          </button>
                          <button
                            type="button"
                            disabled={processing}
                            onClick={() => void handleFinalDecision(activeReq, 'rejected')}
                            className="min-h-[44px] px-4 py-2 bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-50 text-sm font-medium rounded-xl flex items-center justify-center gap-2 cursor-pointer"
                          >
                            <XCircle className="w-4 h-4" />
                            <span>ไม่อนุญาต</span>
                          </button>
                        </>
                      )}

                      {activeReq.requesterUid === currentStaff.uid && (
                        <button
                          type="button"
                          disabled={processing}
                          onClick={() => void handleCancelOwn(activeReq)}
                          className="min-h-[44px] px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium rounded-xl cursor-pointer"
                        >
                          ยกเลิกคำขอ
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Telegram Real-Time Approval Notification & Inline Keyboard Card */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
                  <div>
                    <h4 className="text-base font-semibold text-slate-900">
                      ระบบแจ้งเตือนและอนุมัติผ่าน Telegram แบบเรียลไทม์
                    </h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      ส่งข้อความแจ้งเตือนผ่าน Telegram Bot พร้อมปุ่ม Inline Keyboard ลงนามอนุมัติที่เข้ารหัสยืนยันตัวตน
                    </p>
                  </div>
                  <MessageSquare className="w-5 h-5 text-sky-600 shrink-0" />
                </div>

                {/* Telegram Bot Message Preview */}
                <div className="max-w-sm space-y-1.5">
                  <div className="border border-sky-200 rounded-2xl overflow-hidden bg-sky-50/50 p-4 space-y-2 text-xs">
                    <p className="font-bold text-slate-900">สสอ.ดอนพุด · แจ้งเตือนคำขออนุมัติการลา</p>
                    <p className="italic text-sky-800">
                      {activeReq.status === 'pending_verifier'
                        ? 'รอผู้ตรวจสอบรับรองสถิติการลา'
                        : activeReq.status === 'pending_supervisor'
                          ? 'รอสาธารณสุขอำเภอพิจารณาอนุมัติ'
                          : LEAVE_STATUS_LABELS[activeReq.status]}
                    </p>
                    <div className="border-t border-sky-200/70 pt-2 space-y-1 text-slate-700">
                      <p>
                        <strong className="text-slate-900">ผู้ขอลา:</strong> {activeReq.requesterName}
                      </p>
                      <p>
                        <strong className="text-slate-900">สังกัด:</strong> {activeReq.requesterPosition} ·{' '}
                        {activeReq.department}
                      </p>
                      <p>
                        <strong className="text-slate-900">ประเภท:</strong>{' '}
                        {LEAVE_TYPE_LABELS[activeReq.leaveType]}
                      </p>
                      <p>
                        <strong className="text-slate-900">ระยะเวลา:</strong>{' '}
                        {formatThaiDateFull(activeReq.startDate)} – {formatThaiDateFull(activeReq.endDate)}{' '}
                        <strong className="text-teal-700 tabular-nums">({activeReq.workingDays} วันทำการ)</strong>
                      </p>
                    </div>
                  </div>
                  <div className="bg-sky-600 text-white text-center text-xs font-medium py-2 rounded-xl">
                    เปิดพิจารณาอนุมัติทันที (Telegram Inline Button)
                  </div>
                </div>

                <div className="flex flex-wrap gap-2.5">
                  <button
                    type="button"
                    disabled={telegramSending}
                    onClick={() =>
                      void handleDispatchTelegram(
                        activeReq,
                        activeReq.status === 'pending_verifier' ? 'verifier' : 'supervisor'
                      )
                    }
                    className="min-h-[44px] px-4 py-2 bg-[#229ED9] hover:bg-[#1c89be] disabled:opacity-60 text-white text-sm font-medium rounded-xl inline-flex items-center gap-2 cursor-pointer"
                  >
                    <Send className="w-4 h-4" />
                    <span>
                      {telegramSending
                        ? 'กำลังสร้างแจ้งเตือน...'
                        : 'สร้างแจ้งเตือน Telegram / ส่งผ่าน Bot API'}
                    </span>
                  </button>

                  {telegramPreview?.shareUrl && (
                    <a
                      href={telegramPreview.shareUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-[44px] px-4 py-2 bg-white border border-sky-600 text-sky-700 hover:bg-sky-50 text-sm font-medium rounded-xl inline-flex items-center gap-2"
                    >
                      <ExternalLink className="w-4 h-4" />
                      <span>เปิดแอป Telegram เพื่อส่งให้ผู้อนุมัติ</span>
                    </a>
                  )}

                  {telegramPreview?.approvalUrl && (
                    <button
                      type="button"
                      onClick={() => void handleCopyUrl(telegramPreview.approvalUrl)}
                      className="min-h-[44px] px-3.5 py-2 border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-medium rounded-xl inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedUrl ? 'คัดลอกลิงก์แล้ว' : 'คัดลอกลิงก์อนุมัติ'}</span>
                    </button>
                  )}
                </div>

                {/* Audit Trail */}
                {auditLogs.length > 0 && (
                  <div className="border-t border-slate-100 pt-4 space-y-2">
                    <p className="text-xs font-medium text-slate-500">ประวัติการดำเนินการ (Audit Trail)</p>
                    <div className="space-y-2">
                      {auditLogs.map((log, i) => (
                        <div
                          key={log.id ?? i}
                          className="flex items-start justify-between gap-2 text-xs text-slate-600"
                        >
                          <span>
                            <strong className="text-slate-900">{log.actorName}</strong> · {log.note || log.action}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {editModalOpen && activeReq && (
        <EditLeaveModal
          request={activeReq}
          currentStaff={currentStaff}
          staffList={staffList}
          departments={departments}
          isAdmin={isAdmin}
          onClose={() => setEditModalOpen(false)}
          onSaved={(msg) => {
            setEditModalOpen(false);
            setActionMsg(msg);
          }}
        />
      )}
    </div>
  );
};
