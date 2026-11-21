import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import {
  LayoutDashboard,
  FilePlus2,
  CheckSquare,
  ClipboardList,
  Users,
  LogOut,
  Plus,
  Settings,
} from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType } from './lib/firebase';
import { seedDonPhutSampleData } from './lib/seedData';
import { getCurrentFiscalYear } from './lib/thaiDate';
import { AuthGate } from './components/AuthGate';
import { ExecutiveDashboard } from './components/ExecutiveDashboard';
import { LeaveRequestForm } from './components/LeaveRequestForm';
import { ApprovalCenter } from './components/ApprovalCenter';
import { LeaveRecordCardView } from './components/LeaveRecordCardView';
import { OfficialPrintModal } from './components/OfficialPrintModal';
import type { PrintTemplateType } from './components/OfficialPrintModal';
import { PersonnelManagement } from './components/PersonnelManagement';
import { AdminSystemPanel } from './components/AdminSystemPanel';
import { DON_PHUT_DEPARTMENTS } from './types/leave';
import type {
  LeaveRequest,
  StaffPublicProfile,
  SystemSettings,
  TelegramDispatchResponse,
} from './types/leave';

type ActiveTab = 'dashboard' | 'apply' | 'approvals' | 'record_card' | 'personnel' | 'admin';

const BOOTSTRAP_ADMIN_EMAIL = 'tibularbell@gmail.com';

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [currentStaff, setCurrentStaff] = useState<StaffPublicProfile | null>(null);
  const [staffLoading, setStaffLoading] = useState(true);
  const [isAdminDoc, setIsAdminDoc] = useState(false);

  const [staffList, setStaffList] = useState<StaffPublicProfile[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(null);
  const [dataLoading, setDataLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [selectedRequest, setSelectedRequest] = useState<LeaveRequest | null>(null);
  const [lastTelegramDispatch, setLastTelegramDispatch] = useState<TelegramDispatchResponse | null>(
    null
  );
  const [deepLinkBanner, setDeepLinkBanner] = useState<{
    requestId: string;
    validToken: boolean;
  } | null>(null);

  const [printOpen, setPrintOpen] = useState(false);
  const [printTemplate, setPrintTemplate] = useState<PrintTemplateType>('leave_form');
  const [printRequest, setPrintRequest] = useState<LeaveRequest | null>(null);
  const [printStaff, setPrintStaff] = useState<StaffPublicProfile | null>(null);
  const [printFiscalYear, setPrintFiscalYear] = useState<number>(getCurrentFiscalYear());
  const [printRecords, setPrintRecords] = useState<LeaveRequest[]>([]);

  const isBootstrapAdmin = useMemo(
    () => Boolean(user?.emailVerified && user.email === BOOTSTRAP_ADMIN_EMAIL),
    [user]
  );

  const isAdmin = useMemo(() => {
    if (!user?.emailVerified) return false;
    return (
      isBootstrapAdmin ||
      isAdminDoc ||
      currentStaff?.role === 'admin'
    );
  }, [user, isBootstrapAdmin, isAdminDoc, currentStaff?.role]);

  const activeDepartments = useMemo(
    () =>
      systemSettings?.departments?.length
        ? systemSettings.departments
        : [...DON_PHUT_DEPARTMENTS],
    [systemSettings]
  );

  const resolvedSelectedRequest = useMemo(() => {
    if (!selectedRequest) return null;
    return (
      leaveRequests.find((r) => r.requestId === selectedRequest.requestId) ?? selectedRequest
    );
  }, [selectedRequest, leaveRequests]);

  // 1. Auth Listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setUser(fbUser);
      setAuthReady(true);
      if (!fbUser) {
        setCurrentStaff(null);
        setStaffLoading(false);
        setIsAdminDoc(false);
        return;
      }

      setStaffLoading(true);
      try {
        const staffSnap = await getDoc(doc(db, 'staff_directory', fbUser.uid));
        setCurrentStaff(
          staffSnap.exists() ? (staffSnap.data() as StaffPublicProfile) : null
        );
      } catch {
        setCurrentStaff(null);
      }

      try {
        const adminSnap = await getDoc(doc(db, 'admins', fbUser.uid));
        setIsAdminDoc(adminSnap.exists());
      } catch {
        setIsAdminDoc(false);
      } finally {
        setStaffLoading(false);
      }
    });
    return () => unsub();
  }, []);

  // 2. Real-time Firestore Subscriptions (only when authenticated and registered)
  useEffect(() => {
    if (!authReady || !user || !currentStaff) {
      return;
    }

    setDataLoading(true);
    const staffQ = query(
      collection(db, 'staff_directory'),
      where('isActive', 'in', [true, false])
    );
    const unsubStaff = onSnapshot(
      staffQ,
      (snap) => {
        const list = snap.docs.map((d) => d.data() as StaffPublicProfile);
        list.sort((a, b) => a.fullName.localeCompare(b.fullName, 'th'));
        setStaffList(list);
        const me = list.find((s) => s.uid === user.uid);
        if (me) setCurrentStaff(me);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'staff_directory');
      }
    );

    const leavesQ = query(
      collection(db, 'leave_requests'),
      where('fiscalYear', '>=', 2560)
    );
    const unsubLeaves = onSnapshot(
      leavesQ,
      (snap) => {
        const list = snap.docs.map((d) => d.data() as LeaveRequest);
        list.sort((a, b) => b.startDate.localeCompare(a.startDate));
        setLeaveRequests(list);
        setDataLoading(false);
      },
      (error) => {
        setDataLoading(false);
        handleFirestoreError(error, OperationType.LIST, 'leave_requests');
      }
    );

    const unsubSettings = onSnapshot(
      doc(db, 'system_settings', 'general'),
      (snap) => {
        setSystemSettings(snap.exists() ? (snap.data() as SystemSettings) : null);
      },
      () => {
        setSystemSettings(null);
      }
    );

    return () => {
      unsubStaff();
      unsubLeaves();
      unsubSettings();
    };
  }, [authReady, user?.uid, Boolean(currentStaff)]);

  // 3. Handle Telegram 1-Tap Deep Link (?approveRequestId=...&actionToken=...)
  useEffect(() => {
    if (!user || !currentStaff || leaveRequests.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const reqId = params.get('approveRequestId');
    const actionToken = params.get('actionToken');
    if (!reqId) return;

    const matched = leaveRequests.find((r) => r.requestId === reqId);
    if (matched) {
      setSelectedRequest(matched);
      setActiveTab('approvals');
    }

    const verify = async () => {
      let valid = false;
      if (actionToken) {
        try {
          const idToken = await user.getIdToken();
          const res = await fetch('/api/telegram/verify-action-token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({ requestId: reqId, actionToken }),
          });
          const data = (await res.json()) as { valid?: boolean };
          valid = Boolean(data.valid);
        } catch {
          valid = false;
        }
      }
      setDeepLinkBanner({ requestId: reqId, validToken: valid });
      window.history.replaceState({}, '', window.location.pathname);
    };
    void verify();
  }, [user, currentStaff, leaveRequests.length]);

  const getIdToken = useCallback(async () => {
    if (!auth.currentUser) return null;
    return auth.currentUser.getIdToken();
  }, []);

  const handleOpenPrintForRequest = (req: LeaveRequest) => {
    const matchedStaff = staffList.find((s) => s.uid === req.requesterUid) ?? currentStaff;
    setPrintRequest(req);
    setPrintStaff(matchedStaff);
    setPrintTemplate(req.leaveType === 'overseas' ? 'overseas_memo' : 'leave_form');
    setPrintFiscalYear(req.fiscalYear);
    setPrintRecords(
      leaveRequests.filter(
        (r) => r.requesterUid === req.requesterUid && r.fiscalYear === req.fiscalYear
      )
    );
    setPrintOpen(true);
  };

  const handleOpenPrintRecordCard = (
    staff: StaffPublicProfile,
    fiscalYear: number,
    records: LeaveRequest[]
  ) => {
    setPrintRequest(records[0] ?? null);
    setPrintStaff(staff);
    setPrintFiscalYear(fiscalYear);
    setPrintRecords(records);
    setPrintTemplate('record_card');
    setPrintOpen(true);
  };

  const handleSeedData = async () => {
    if (!user || !currentStaff) return;
    await seedDonPhutSampleData(user.uid, currentStaff.fullName);
  };

  if (!authReady || (user && staffLoading)) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-sm text-slate-600">กำลังตรวจสอบสิทธิ์และการเชื่อมต่อฐานข้อมูล...</div>
      </div>
    );
  }

  if (!user) {
    return <AuthGate mode="login" />;
  }

  if (!currentStaff) {
    return (
      <AuthGate
        mode="onboarding"
        userEmail={user.email ?? ''}
        userUid={user.uid}
        displayName={user.displayName ?? ''}
        onProfileCreated={(profile) => setCurrentStaff(profile)}
      />
    );
  }

  const pendingApprovalsCount = leaveRequests.filter(
    (r) => r.status === 'pending_verifier' || r.status === 'pending_supervisor'
  ).length;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Navigation Bar (Strict 3-Zone Contract, Hidden in Print) */}
      <header className="no-print sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 md:h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single-line Brand Wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('dashboard')}
            className="text-base sm:text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
          >
            สสอ.ดอนพุด
          </button>

          {/* Zone 2: Clean Single-Line Text Navigation Links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            {[
              { id: 'dashboard' as const, label: 'แดชบอร์ด' },
              { id: 'apply' as const, label: 'ยื่นใบลา' },
              {
                id: 'approvals' as const,
                label:
                  pendingApprovalsCount > 0
                    ? `อนุมัติ / Telegram (${pendingApprovalsCount})`
                    : 'อนุมัติ / Telegram',
              },
              { id: 'record_card' as const, label: 'บัตรบันทึกการลา' },
              { id: 'personnel' as const, label: 'บุคลากร' },
              ...(isAdmin ? [{ id: 'admin' as const, label: 'ผู้ดูแลระบบ' }] : []),
            ].map((nav) => (
              <button
                key={nav.id}
                type="button"
                onClick={() => setActiveTab(nav.id)}
                className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === nav.id
                    ? 'border-teal-700 text-slate-900 font-semibold'
                    : 'border-transparent hover:text-slate-900'
                }`}
              >
                {nav.label}
              </button>
            ))}
          </nav>

          {/* Zone 3: 1 Primary Action */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('apply')}
              className="min-h-[40px] px-4 py-2 text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span>ยื่นใบลาใหม่</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Workspace */}
      <main className="no-print flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-5 sm:py-8 pb-24 md:pb-12 space-y-6">
        {/* Contextual User Identity Strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 border-b border-slate-200/80 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-800">{currentStaff.fullName}</span>
            <span aria-hidden="true">·</span>
            <span>{currentStaff.position}</span>
            <span aria-hidden="true">·</span>
            <span>{currentStaff.department}</span>
          </div>
          <button
            type="button"
            onClick={() => signOut(auth)}
            className="text-xs font-medium text-slate-600 hover:text-slate-900 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>ออกจากระบบ</span>
          </button>
        </div>

        {activeTab === 'dashboard' && (
          <ExecutiveDashboard
            currentStaff={currentStaff}
            staffList={staffList}
            leaveRequests={leaveRequests}
            departments={activeDepartments}
            systemSettings={systemSettings}
            loading={dataLoading}
            isAdmin={isAdmin}
            onSeedSampleData={handleSeedData}
            onSelectRequestForPrint={handleOpenPrintForRequest}
            onNavigateTab={setActiveTab}
            onInspectApproval={(req) => {
              setSelectedRequest(req);
              setActiveTab('approvals');
            }}
            getIdToken={getIdToken}
          />
        )}

        {activeTab === 'apply' && (
          <LeaveRequestForm
            currentStaff={currentStaff}
            staffList={staffList}
            systemSettings={systemSettings}
            getIdToken={getIdToken}
            onSubmitted={(newReq, telegramDispatch) => {
              setSelectedRequest(newReq);
              setLastTelegramDispatch(telegramDispatch);
              setActiveTab('approvals');
            }}
          />
        )}

        {activeTab === 'approvals' && (
          <ApprovalCenter
            currentStaff={currentStaff}
            staffList={staffList}
            leaveRequests={leaveRequests}
            departments={activeDepartments}
            selectedRequest={resolvedSelectedRequest}
            deepLinkBanner={deepLinkBanner}
            lastTelegramDispatch={lastTelegramDispatch}
            isAdmin={isAdmin}
            onSelectRequest={setSelectedRequest}
            onOpenPrint={handleOpenPrintForRequest}
            getIdToken={getIdToken}
          />
        )}

        {activeTab === 'record_card' && (
          <LeaveRecordCardView
            currentStaff={currentStaff}
            staffList={staffList}
            leaveRequests={leaveRequests}
            onPrintRecordCard={handleOpenPrintRecordCard}
          />
        )}

        {activeTab === 'personnel' && (
          <PersonnelManagement
            currentStaff={currentStaff}
            staffList={staffList}
            departments={activeDepartments}
            isAdmin={isAdmin}
            userEmail={user.email ?? ''}
            onOpenAdminPanel={() => setActiveTab('admin')}
          />
        )}

        {activeTab === 'admin' && (
          <AdminSystemPanel
            currentStaff={currentStaff}
            staffList={staffList}
            leaveRequests={leaveRequests}
            systemSettings={systemSettings}
            departments={activeDepartments}
            isAdmin={isAdmin}
            isBootstrapAdmin={isBootstrapAdmin}
            userEmail={user.email ?? ''}
          />
        )}
      </main>

      {/* Mobile Bottom Thumb-Zone Navigation (< md) */}
      <nav
        aria-label="เมนูหลักมือถือ"
        className="no-print md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-safe"
      >
        <div className={`grid items-center h-16 ${isAdmin ? 'grid-cols-6' : 'grid-cols-5'}`}>
          {[
            { id: 'dashboard' as const, label: 'ภาพรวม', icon: LayoutDashboard },
            { id: 'apply' as const, label: 'ยื่นลา', icon: FilePlus2 },
            { id: 'approvals' as const, label: 'อนุมัติ', icon: CheckSquare },
            { id: 'record_card' as const, label: 'บัตรลา', icon: ClipboardList },
            { id: 'personnel' as const, label: 'บุคลากร', icon: Users },
            ...(isAdmin ? [{ id: 'admin' as const, label: 'ผู้ดูแล', icon: Settings }] : []),
          ].map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 ${
                  active ? 'text-teal-700 font-semibold' : 'text-slate-500'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] tracking-tight">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Printable Official Thai Government A4 PDF Modal */}
      <OfficialPrintModal
        open={printOpen}
        initialTemplate={printTemplate}
        leaveRequest={printRequest}
        staffProfile={printStaff}
        fiscalYear={printFiscalYear}
        staffRecords={printRecords}
        onClose={() => setPrintOpen(false)}
      />
    </div>
  );
}
