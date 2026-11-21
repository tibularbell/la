import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  ShieldAlert,
  ShieldCheck,
  Settings,
  DatabaseBackup,
  Download,
  Upload,
  FileSpreadsheet,
  Pencil,
  Trash2,
  UserPlus,
  Plus,
  X,
  CheckCircle2,
  AlertTriangle,
  History,
  Search,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  buildBackupArchive,
  downloadTextFile,
  generateLeaveRequestsCsv,
  generateStaffCsv,
  verifyBackupArchive,
} from '../lib/backupUtils';
import { formatThaiDateShort } from '../lib/thaiDate';
import {
  DEFAULT_SYSTEM_SETTINGS,
  LEAVE_STATUS_LABELS,
  LEAVE_TYPE_LABELS,
  MAX_LENGTHS,
} from '../types/leave';
import type {
  AdminMarker,
  BackupLog,
  EmploymentType,
  LeaveRequest,
  LeaveRequestPrivateDetails,
  LeaveStatus,
  LeaveType,
  StaffPrivatePII,
  StaffPublicProfile,
  StaffRole,
  SystemBackupArchive,
  SystemSettings,
} from '../types/leave';

interface AdminSystemPanelProps {
  currentStaff: StaffPublicProfile;
  staffList: StaffPublicProfile[];
  leaveRequests: LeaveRequest[];
  systemSettings: SystemSettings | null;
  departments: string[];
  isAdmin: boolean;
  isBootstrapAdmin: boolean;
  userEmail: string;
}

type AdminSubTab = 'settings' | 'editor' | 'backup';

const EMPLOYMENT_TYPES: EmploymentType[] = [
  'ข้าราชการ',
  'พนักงานราชการ',
  'ลูกจ้างประจำ',
  'พนักงานกระทรวงสาธารณสุข',
  'ลูกจ้างชั่วคราว',
];

const ROLE_LABELS: Record<StaffRole, string> = {
  staff: 'บุคลากรทั่วไป',
  verifier: 'ผู้ตรวจสอบสถิติ (HR)',
  supervisor: 'ผู้บังคับบัญชา / สสอ.',
  executive: 'ผู้บริหาร',
  admin: 'ผู้ดูแลระบบ',
};

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

export const AdminSystemPanel: React.FC<AdminSystemPanelProps> = ({
  currentStaff,
  staffList,
  leaveRequests,
  systemSettings,
  departments,
  isAdmin,
  isBootstrapAdmin,
  userEmail,
}) => {
  const [subTab, setSubTab] = useState<AdminSubTab>('settings');
  const [statusBanner, setStatusBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  // Admin management state
  const [adminMarkers, setAdminMarkers] = useState<AdminMarker[]>([]);
  const [grantUid, setGrantUid] = useState('');
  const [grantEmail, setGrantEmail] = useState('');
  const [grantBusy, setGrantBusy] = useState(false);

  // System settings state
  const [officeName, setOfficeName] = useState(
    systemSettings?.officeName ?? DEFAULT_SYSTEM_SETTINGS.officeName
  );
  const [provinceName, setProvinceName] = useState(
    systemSettings?.provinceName ?? DEFAULT_SYSTEM_SETTINGS.provinceName
  );
  const [defaultDocumentPrefix, setDefaultDocumentPrefix] = useState(
    systemSettings?.defaultDocumentPrefix ?? DEFAULT_SYSTEM_SETTINGS.defaultDocumentPrefix
  );
  const [defaultAddressedTo, setDefaultAddressedTo] = useState(
    systemSettings?.defaultAddressedTo ?? DEFAULT_SYSTEM_SETTINGS.defaultAddressedTo
  );
  const [defaultSupervisorTitle, setDefaultSupervisorTitle] = useState(
    systemSettings?.defaultSupervisorTitle ?? DEFAULT_SYSTEM_SETTINGS.defaultSupervisorTitle
  );
  const [defaultAnnualVacationQuota, setDefaultAnnualVacationQuota] = useState(
    String(
      systemSettings?.defaultAnnualVacationQuota ??
        DEFAULT_SYSTEM_SETTINGS.defaultAnnualVacationQuota
    )
  );
  const [activeFiscalYear, setActiveFiscalYear] = useState(
    String(systemSettings?.activeFiscalYear ?? DEFAULT_SYSTEM_SETTINGS.activeFiscalYear)
  );
  const [autoNotifyOnSubmit, setAutoNotifyOnSubmit] = useState(
    systemSettings?.autoNotifyOnSubmit ?? DEFAULT_SYSTEM_SETTINGS.autoNotifyOnSubmit
  );
  const [deptList, setDeptList] = useState<string[]>(
    systemSettings?.departments ?? DEFAULT_SYSTEM_SETTINGS.departments
  );
  const [newDeptName, setNewDeptName] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);

  // Sync settings form when Firestore updates
  useEffect(() => {
    if (!systemSettings) return;
    setOfficeName(systemSettings.officeName);
    setProvinceName(systemSettings.provinceName);
    setDefaultDocumentPrefix(systemSettings.defaultDocumentPrefix);
    setDefaultAddressedTo(systemSettings.defaultAddressedTo);
    setDefaultSupervisorTitle(systemSettings.defaultSupervisorTitle);
    setDefaultAnnualVacationQuota(String(systemSettings.defaultAnnualVacationQuota));
    setActiveFiscalYear(String(systemSettings.activeFiscalYear));
    setAutoNotifyOnSubmit(systemSettings.autoNotifyOnSubmit);
    setDeptList(systemSettings.departments);
  }, [systemSettings]);

  // Editor state: Staff
  const [staffSearch, setStaffSearch] = useState('');
  const [editingStaffModal, setEditingStaffModal] = useState<{
    mode: 'create' | 'edit';
    uid: string;
    fullName: string;
    position: string;
    department: string;
    employmentType: EmploymentType;
    role: StaffRole;
    isActive: boolean;
    accumulatedVacationDays: string;
    annualVacationQuota: string;
    usedVacationDays: string;
    usedSickDays: string;
    usedPersonalDays: string;
    usedOtherDays: string;
    email: string;
    phone: string;
    contactAddress: string;
    age: string;
    hireDate: string;
    telegramChatId: string;
  } | null>(null);
  const [savingStaffModal, setSavingStaffModal] = useState(false);
  const [confirmDeleteStaffUid, setConfirmDeleteStaffUid] = useState<string | null>(null);

  // Editor state: Leave requests
  const [leaveSearch, setLeaveSearch] = useState('');
  const [editingLeaveModal, setEditingLeaveModal] = useState<{
    requestId: string;
    requesterUid: string;
    documentNo: string;
    requesterName: string;
    requesterPosition: string;
    department: string;
    leaveType: LeaveType;
    startDate: string;
    endDate: string;
    workingDays: string;
    fiscalYear: string;
    priorUsedDays: string;
    substituteName: string;
    status: LeaveStatus;
    verifierName: string;
    supervisorName: string;
    supervisorComment: string;
    hasPrivateDoc: boolean;
    writtenAt: string;
    addressedTo: string;
    reason: string;
    contactAddress: string;
    contactPhone: string;
    overseasCountry: string;
    overseasPurpose: string;
  } | null>(null);
  const [savingLeaveModal, setSavingLeaveModal] = useState(false);
  const [confirmDeleteLeaveId, setConfirmDeleteLeaveId] = useState<string | null>(null);

  // Backup & Restore state
  const [backupLogs, setBackupLogs] = useState<BackupLog[]>([]);
  const [backingUp, setBackingUp] = useState(false);
  const [restorePreview, setRestorePreview] = useState<{
    filename: string;
    validStructure: boolean;
    checksumValid: boolean;
    archive: SystemBackupArchive | null;
    error?: string;
  } | null>(null);
  const [restoreSettings, setRestoreSettings] = useState(true);
  const [restoreStaff, setRestoreStaff] = useState(true);
  const [restoreLeaves, setRestoreLeaves] = useState(true);
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // Subscribe to admins (bootstrap admin only) & backup_logs
  useEffect(() => {
    if (!isAdmin) return;
    let unsubAdmins = () => {};
    if (isBootstrapAdmin) {
      const adminsQ = query(collection(db, 'admins'), where('uid', '>=', ''));
      unsubAdmins = onSnapshot(
        adminsQ,
        (snap) => {
          setAdminMarkers(snap.docs.map((d) => d.data() as AdminMarker));
        },
        () => {
          setAdminMarkers([]);
        }
      );
    }

    const logsQ = isBootstrapAdmin
      ? query(collection(db, 'backup_logs'), where('backupId', '>=', ''))
      : query(collection(db, 'backup_logs'), where('createdByUid', '==', currentStaff.uid));

    const unsubLogs = onSnapshot(
      logsQ,
      (snap) => {
        const list = snap.docs.map((d) => d.data() as BackupLog);
        list.sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
        setBackupLogs(list);
      },
      (err) => {
        console.warn('backup_logs subscription skipped:', err.message);
      }
    );

    return () => {
      unsubAdmins();
      unsubLogs();
    };
  }, [isAdmin, isBootstrapAdmin, currentStaff.uid]);

  // Auto-load email from staff_private when selecting a candidate to promote to Admin
  useEffect(() => {
    if (!grantUid) {
      setGrantEmail('');
      return;
    }
    let mounted = true;
    const loadEmail = async () => {
      try {
        const snap = await getDoc(doc(db, 'staff_private', grantUid));
        if (mounted && snap.exists()) {
          const data = snap.data() as StaffPrivatePII;
          if (data.email) setGrantEmail(data.email);
        }
      } catch {
        // Admin can still type email manually
      }
    };
    void loadEmail();
    return () => {
      mounted = false;
    };
  }, [grantUid]);

  const filteredStaff = useMemo(() => {
    const q = staffSearch.trim().toLowerCase();
    if (!q) return staffList;
    return staffList.filter((s) =>
      `${s.fullName} ${s.position} ${s.department} ${s.uid}`.toLowerCase().includes(q)
    );
  }, [staffList, staffSearch]);

  const filteredLeaves = useMemo(() => {
    const q = leaveSearch.trim().toLowerCase();
    if (!q) return leaveRequests;
    return leaveRequests.filter((r) =>
      `${r.requesterName} ${r.department} ${r.documentNo ?? ''} ${r.requestId}`
        .toLowerCase()
        .includes(q)
    );
  }, [leaveRequests, leaveSearch]);

  if (!isAdmin) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-2">
        <ShieldAlert className="w-8 h-8 text-rose-600 mx-auto" />
        <h2 className="text-base font-semibold text-slate-900">เฉพาะผู้ดูแลระบบเท่านั้น</h2>
        <p className="text-sm text-slate-500">
          บัญชีของคุณไม่มีสิทธิ์เข้าถึงส่วนตั้งค่าระบบและการสำรองข้อมูล
        </p>
      </div>
    );
  }

  // --- Handlers: Admin Grant / Revoke ---
  const handleGrantAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isBootstrapAdmin || !grantUid) return;
    const cleanEmail = grantEmail.trim().slice(0, 160);
    if (cleanEmail.length < 3 || !cleanEmail.includes('@')) {
      setStatusBanner({ type: 'err', text: 'กรุณาระบุอีเมล Google ของบุคลากรที่ต้องการแต่งตั้งให้ถูกต้อง' });
      return;
    }
    setGrantBusy(true);
    setStatusBanner(null);
    const batch = writeBatch(db);
    batch.set(doc(db, 'admins', grantUid), {
      uid: grantUid,
      email: cleanEmail,
      createdAt: serverTimestamp(),
    });
    batch.update(doc(db, 'staff_directory', grantUid), {
      role: 'admin',
      updatedAt: serverTimestamp(),
    });
    try {
      await batch.commit();
      setGrantUid('');
      setGrantEmail('');
      setStatusBanner({ type: 'ok', text: `แต่งตั้ง ${cleanEmail} เป็นผู้ดูแลระบบเรียบร้อยแล้ว` });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `admins/${grantUid}`);
    } finally {
      setGrantBusy(false);
    }
  };

  const handleRevokeAdmin = async (targetUid: string) => {
    if (!isBootstrapAdmin || targetUid === currentStaff.uid) return;
    setGrantBusy(true);
    setStatusBanner(null);
    try {
      await deleteDoc(doc(db, 'admins', targetUid));
      const targetStaff = staffList.find((s) => s.uid === targetUid);
      if (targetStaff) {
        await updateDoc(doc(db, 'staff_directory', targetUid), {
          role: 'staff',
          updatedAt: serverTimestamp(),
        });
      }
      setStatusBanner({ type: 'ok', text: 'เพิกถอนสิทธิ์ผู้ดูแลระบบเรียบร้อยแล้ว' });
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `admins/${targetUid}`);
    } finally {
      setGrantBusy(false);
    }
  };

  // --- Handlers: System Settings ---
  const handleAddDepartment = () => {
    const clean = newDeptName.trim().slice(0, MAX_LENGTHS.department);
    if (clean.length < 2) return;
    if (deptList.includes(clean)) {
      setStatusBanner({ type: 'err', text: 'มีชื่อหน่วยสถานบริการนี้อยู่ในระบบแล้ว' });
      return;
    }
    if (deptList.length >= 30) {
      setStatusBanner({ type: 'err', text: 'รองรับหน่วยสถานบริการสูงสุด 30 หน่วย' });
      return;
    }
    setDeptList([...deptList, clean]);
    setNewDeptName('');
  };

  const handleSaveSystemSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanOffice = officeName.trim().slice(0, MAX_LENGTHS.officeName);
    const cleanProvince = provinceName.trim().slice(0, MAX_LENGTHS.provinceName);
    const cleanPrefix = defaultDocumentPrefix.trim().slice(0, MAX_LENGTHS.documentPrefix);
    const cleanAddressed = defaultAddressedTo.trim().slice(0, MAX_LENGTHS.addressedTo);
    const cleanSupervisor = defaultSupervisorTitle.trim().slice(0, MAX_LENGTHS.addressedTo);
    const parsedQuota = Math.min(30, Math.max(0, Number(defaultAnnualVacationQuota) || 10));
    const parsedFiscal = Math.min(2650, Math.max(2560, Math.round(Number(activeFiscalYear) || 2570)));
    const cleanDepts = deptList.map((d) => d.trim().slice(0, MAX_LENGTHS.department)).filter((d) => d.length >= 2);

    if (cleanOffice.length < 2 || cleanDepts.length === 0) {
      setStatusBanner({ type: 'err', text: 'กรุณากรอกชื่อหน่วยงานและมีหน่วยบริการอย่างน้อย 1 แห่ง' });
      return;
    }

    setSavingSettings(true);
    setStatusBanner(null);
    try {
      await setDoc(doc(db, 'system_settings', 'general'), {
        settingId: 'general',
        officeName: cleanOffice,
        provinceName: cleanProvince || 'จังหวัดสระบุรี',
        defaultDocumentPrefix: cleanPrefix || 'สบ ๐๔๓๒/ว',
        defaultAddressedTo: cleanAddressed || 'สาธารณสุขอำเภอดอนพุด',
        defaultSupervisorTitle: cleanSupervisor || 'สาธารณสุขอำเภอดอนพุด',
        defaultAnnualVacationQuota: parsedQuota,
        activeFiscalYear: parsedFiscal,
        departments: cleanDepts.slice(0, 30),
        autoNotifyOnSubmit,
        updatedByUid: currentStaff.uid,
        updatedByName: currentStaff.fullName.slice(0, MAX_LENGTHS.fullName),
        updatedAt: serverTimestamp(),
      });
      setStatusBanner({ type: 'ok', text: 'บันทึกการตั้งค่าระบบและหน่วยสถานบริการเรียบร้อยแล้ว' });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'system_settings/general');
    } finally {
      setSavingSettings(false);
    }
  };

  // --- Handlers: Staff Editor ---
  const openCreateStaffModal = () => {
    setEditingStaffModal({
      mode: 'create',
      uid: `staff_${Date.now()}`,
      fullName: '',
      position: 'นักวิชาการสาธารณสุขปฏิบัติการ',
      department: departments[0] ?? DEFAULT_SYSTEM_SETTINGS.departments[0],
      employmentType: 'ข้าราชการ',
      role: 'staff',
      isActive: true,
      accumulatedVacationDays: '10',
      annualVacationQuota: String(systemSettings?.defaultAnnualVacationQuota ?? 10),
      usedVacationDays: '0',
      usedSickDays: '0',
      usedPersonalDays: '0',
      usedOtherDays: '0',
      email: '',
      phone: '',
      contactAddress: '',
      age: '30',
      hireDate: '',
      telegramChatId: '',
    });
  };

  const openEditStaffModal = async (staff: StaffPublicProfile) => {
    let pii: Partial<StaffPrivatePII> = {};
    try {
      const snap = await getDoc(doc(db, 'staff_private', staff.uid));
      if (snap.exists()) pii = snap.data() as StaffPrivatePII;
    } catch {
      // Optional private record
    }
    setEditingStaffModal({
      mode: 'edit',
      uid: staff.uid,
      fullName: staff.fullName,
      position: staff.position,
      department: staff.department,
      employmentType: staff.employmentType,
      role: staff.role,
      isActive: staff.isActive,
      accumulatedVacationDays: String(staff.accumulatedVacationDays),
      annualVacationQuota: String(staff.annualVacationQuota),
      usedVacationDays: String(staff.usedVacationDays),
      usedSickDays: String(staff.usedSickDays),
      usedPersonalDays: String(staff.usedPersonalDays),
      usedOtherDays: String(staff.usedOtherDays),
      email: pii.email ?? '',
      phone: pii.phone ?? '',
      contactAddress: pii.contactAddress ?? '',
      age: pii.age ? String(pii.age) : '30',
      hireDate: pii.hireDate ?? '',
      telegramChatId: pii.telegramChatId ?? '',
    });
  };

  const handleSaveStaffModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStaffModal) return;
    const cleanUid = editingStaffModal.uid.trim();
    const cleanName = editingStaffModal.fullName.trim().slice(0, MAX_LENGTHS.fullName);
    const cleanPos = editingStaffModal.position.trim().slice(0, MAX_LENGTHS.position);
    const cleanDept = editingStaffModal.department.trim().slice(0, MAX_LENGTHS.department);

    if (!VALID_ID_REGEX.test(cleanUid) || cleanName.length < 2 || cleanPos.length < 2) {
      setStatusBanner({
        type: 'err',
        text: 'รหัส UID ต้องเป็นตัวอักษรภาษาอังกฤษ/ตัวเลข และกรอกชื่อ-ตำแหน่งให้ครบถ้วน',
      });
      return;
    }

    setSavingStaffModal(true);
    setStatusBanner(null);

    const publicData = {
      uid: cleanUid,
      fullName: cleanName,
      position: cleanPos,
      department: cleanDept,
      employmentType: editingStaffModal.employmentType,
      role: editingStaffModal.role,
      accumulatedVacationDays: Math.min(60, Math.max(0, Number(editingStaffModal.accumulatedVacationDays) || 0)),
      annualVacationQuota: Math.min(30, Math.max(0, Number(editingStaffModal.annualVacationQuota) || 0)),
      usedVacationDays: Math.min(90, Math.max(0, Number(editingStaffModal.usedVacationDays) || 0)),
      usedSickDays: Math.min(365, Math.max(0, Number(editingStaffModal.usedSickDays) || 0)),
      usedPersonalDays: Math.min(90, Math.max(0, Number(editingStaffModal.usedPersonalDays) || 0)),
      usedOtherDays: Math.min(365, Math.max(0, Number(editingStaffModal.usedOtherDays) || 0)),
      isActive: editingStaffModal.isActive,
      updatedAt: serverTimestamp(),
    };

    const batch = writeBatch(db);
    if (editingStaffModal.mode === 'create') {
      batch.set(doc(db, 'staff_directory', cleanUid), {
        ...publicData,
        createdAt: serverTimestamp(),
      });
    } else {
      batch.update(doc(db, 'staff_directory', cleanUid), publicData);
    }

    const cleanEmail = editingStaffModal.email.trim().slice(0, 160);
    if (cleanEmail.length >= 3) {
      batch.set(doc(db, 'staff_private', cleanUid), {
        uid: cleanUid,
        email: cleanEmail,
        phone: editingStaffModal.phone.trim().slice(0, MAX_LENGTHS.phone),
        contactAddress: editingStaffModal.contactAddress.trim().slice(0, MAX_LENGTHS.contactAddress),
        age: Math.min(90, Math.max(18, Math.round(Number(editingStaffModal.age) || 30))),
        hireDate: editingStaffModal.hireDate.trim().slice(0, 40),
        telegramChatId: editingStaffModal.telegramChatId.trim().slice(0, MAX_LENGTHS.telegramChatId),
        updatedAt: serverTimestamp(),
      });
    }

    try {
      await batch.commit();
      setEditingStaffModal(null);
      setStatusBanner({
        type: 'ok',
        text:
          editingStaffModal.mode === 'create'
            ? `เพิ่มข้อมูลบุคลากร ${cleanName} เรียบร้อยแล้ว`
            : `อัปเดตข้อมูลบุคลากร ${cleanName} เรียบร้อยแล้ว`,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `staff_directory/${cleanUid}`);
    } finally {
      setSavingStaffModal(false);
    }
  };

  const handleDeleteStaff = async (uid: string) => {
    if (uid === currentStaff.uid) return;
    setStatusBanner(null);
    const batch = writeBatch(db);
    batch.delete(doc(db, 'staff_directory', uid));
    batch.delete(doc(db, 'staff_private', uid));
    try {
      await batch.commit();
      setConfirmDeleteStaffUid(null);
      setStatusBanner({ type: 'ok', text: 'ลบข้อมูลบุคลากรออกจากระบบเรียบร้อยแล้ว' });
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `staff_directory/${uid}`);
    }
  };

  // --- Handlers: Leave Request Editor ---
  const openEditLeaveModal = async (req: LeaveRequest) => {
    let priv: Partial<LeaveRequestPrivateDetails> = {};
    let hasPrivateDoc = false;
    try {
      const snap = await getDoc(doc(db, 'leave_requests', req.requestId, 'private', 'details'));
      if (snap.exists()) {
        priv = snap.data() as LeaveRequestPrivateDetails;
        hasPrivateDoc = true;
      }
    } catch {
      // Ignore if missing
    }

    setEditingLeaveModal({
      requestId: req.requestId,
      requesterUid: req.requesterUid,
      documentNo: req.documentNo ?? '',
      requesterName: req.requesterName,
      requesterPosition: req.requesterPosition,
      department: req.department,
      leaveType: req.leaveType,
      startDate: req.startDate,
      endDate: req.endDate,
      workingDays: String(req.workingDays),
      fiscalYear: String(req.fiscalYear),
      priorUsedDays: String(req.priorUsedDays),
      substituteName: req.substituteName ?? '',
      status: req.status,
      verifierName: req.verifierName ?? '',
      supervisorName: req.supervisorName ?? '',
      supervisorComment: req.supervisorComment ?? '',
      hasPrivateDoc,
      writtenAt: priv.writtenAt ?? req.department,
      addressedTo: priv.addressedTo ?? 'สาธารณสุขอำเภอดอนพุด',
      reason: priv.reason ?? '',
      contactAddress: priv.contactAddress ?? '',
      contactPhone: priv.contactPhone ?? '',
      overseasCountry: priv.overseasCountry ?? '',
      overseasPurpose: priv.overseasPurpose ?? '',
    });
  };

  const handleSaveLeaveModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLeaveModal) return;
    if (editingLeaveModal.endDate < editingLeaveModal.startDate) {
      setStatusBanner({ type: 'err', text: 'วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มลา' });
      return;
    }

    setSavingLeaveModal(true);
    setStatusBanner(null);

    const batch = writeBatch(db);
    batch.update(doc(db, 'leave_requests', editingLeaveModal.requestId), {
      documentNo: editingLeaveModal.documentNo.trim().slice(0, MAX_LENGTHS.documentNo),
      requesterName: editingLeaveModal.requesterName.trim().slice(0, MAX_LENGTHS.fullName),
      requesterPosition: editingLeaveModal.requesterPosition.trim().slice(0, MAX_LENGTHS.position),
      department: editingLeaveModal.department.trim().slice(0, MAX_LENGTHS.department),
      leaveType: editingLeaveModal.leaveType,
      startDate: editingLeaveModal.startDate,
      endDate: editingLeaveModal.endDate,
      workingDays: Math.min(180, Math.max(0.5, Number(editingLeaveModal.workingDays) || 1)),
      fiscalYear: Math.min(2650, Math.max(2560, Math.round(Number(editingLeaveModal.fiscalYear) || 2570))),
      priorUsedDays: Math.min(365, Math.max(0, Number(editingLeaveModal.priorUsedDays) || 0)),
      substituteName: editingLeaveModal.substituteName.trim().slice(0, MAX_LENGTHS.fullName),
      status: editingLeaveModal.status,
      verifierName: editingLeaveModal.verifierName.trim().slice(0, MAX_LENGTHS.fullName),
      supervisorName: editingLeaveModal.supervisorName.trim().slice(0, MAX_LENGTHS.fullName),
      supervisorComment: editingLeaveModal.supervisorComment.trim().slice(0, MAX_LENGTHS.supervisorComment),
      updatedAt: serverTimestamp(),
    });

    const privPayload = {
      requesterUid: editingLeaveModal.requesterUid,
      writtenAt: (editingLeaveModal.writtenAt || editingLeaveModal.department)
        .trim()
        .slice(0, MAX_LENGTHS.writtenAt),
      addressedTo: (editingLeaveModal.addressedTo || 'สาธารณสุขอำเภอดอนพุด')
        .trim()
        .slice(0, MAX_LENGTHS.addressedTo),
      reason: editingLeaveModal.reason.trim().slice(0, MAX_LENGTHS.reason),
      contactAddress: editingLeaveModal.contactAddress.trim().slice(0, MAX_LENGTHS.contactAddress),
      contactPhone: editingLeaveModal.contactPhone.trim().slice(0, MAX_LENGTHS.phone),
      overseasCountry: editingLeaveModal.overseasCountry.trim().slice(0, MAX_LENGTHS.overseasCountry),
      overseasPurpose: editingLeaveModal.overseasPurpose.trim().slice(0, MAX_LENGTHS.overseasPurpose),
      updatedAt: serverTimestamp(),
    };

    const privRef = doc(db, 'leave_requests', editingLeaveModal.requestId, 'private', 'details');
    if (editingLeaveModal.hasPrivateDoc) {
      batch.update(privRef, privPayload);
    } else {
      batch.set(privRef, privPayload);
    }

    batch.set(
      doc(db, 'leave_requests', editingLeaveModal.requestId, 'audit_logs', `log_${Date.now()}`),
      {
        actorUid: currentStaff.uid,
        actorName: currentStaff.fullName,
        action: 'admin_edited',
        note: 'ผู้ดูแลระบบแก้ไขข้อมูลใบลาและรายละเอียด',
        createdAt: serverTimestamp(),
      }
    );

    try {
      await batch.commit();
      setEditingLeaveModal(null);
      setStatusBanner({ type: 'ok', text: 'บันทึกการแก้ไขข้อมูลคำขอการลาเรียบร้อยแล้ว' });
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.UPDATE,
        `leave_requests/${editingLeaveModal.requestId}`
      );
    } finally {
      setSavingLeaveModal(false);
    }
  };

  const handleDeleteLeave = async (requestId: string) => {
    setStatusBanner(null);
    const batch = writeBatch(db);
    batch.delete(doc(db, 'leave_requests', requestId, 'private', 'details'));
    batch.delete(doc(db, 'leave_requests', requestId));
    try {
      await batch.commit();
      setConfirmDeleteLeaveId(null);
      setStatusBanner({ type: 'ok', text: `ลบคำขอการลา ${requestId} เรียบร้อยแล้ว` });
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `leave_requests/${requestId}`);
    }
  };

  // --- Handlers: Backup & Restore ---
  const logBackupAction = async (params: {
    actionType: BackupLog['actionType'];
    staffCount: number;
    leaveRequestCount: number;
    settingsIncluded: boolean;
    checksumSha256: string;
    note: string;
  }) => {
    const backupId = `bk_${Date.now()}`;
    await setDoc(doc(db, 'backup_logs', backupId), {
      backupId,
      actionType: params.actionType,
      createdByUid: currentStaff.uid,
      createdByName: currentStaff.fullName.slice(0, MAX_LENGTHS.fullName),
      staffCount: Math.max(0, Math.round(params.staffCount)),
      leaveRequestCount: Math.max(0, Math.round(params.leaveRequestCount)),
      settingsIncluded: params.settingsIncluded,
      checksumSha256: params.checksumSha256.slice(0, 128),
      note: params.note.slice(0, 400),
      createdAt: serverTimestamp(),
    });
  };

  const handleExportFullJson = async () => {
    setBackingUp(true);
    setStatusBanner(null);
    try {
      const staffPrivateDocs: StaffPrivatePII[] = [];
      for (const s of staffList) {
        try {
          const snap = await getDoc(doc(db, 'staff_private', s.uid));
          if (snap.exists()) staffPrivateDocs.push(snap.data() as StaffPrivatePII);
        } catch {
          // Skip missing PII doc
        }
      }

      const leaveBundles: Array<{
        request: LeaveRequest;
        privateDetails: LeaveRequestPrivateDetails | null;
      }> = [];
      for (const req of leaveRequests) {
        let priv: LeaveRequestPrivateDetails | null = null;
        try {
          const snap = await getDoc(doc(db, 'leave_requests', req.requestId, 'private', 'details'));
          if (snap.exists()) priv = snap.data() as LeaveRequestPrivateDetails;
        } catch {
          // Skip missing private details
        }
        leaveBundles.push({ request: req, privateDetails: priv });
      }

      const archive = await buildBackupArchive({
        exportedBy: {
          uid: currentStaff.uid,
          name: currentStaff.fullName,
          email: userEmail,
        },
        systemSettings,
        staffDirectory: staffList,
        staffPrivate: staffPrivateDocs,
        leaveBundles,
      });

      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      downloadTextFile(
        `donphut-leave-backup-${stamp}.json`,
        JSON.stringify(archive, null, 2),
        'application/json;charset=utf-8'
      );

      await logBackupAction({
        actionType: 'export_json',
        staffCount: archive.counts.staffDirectory,
        leaveRequestCount: archive.counts.leaveRequests,
        settingsIncluded: archive.counts.systemSettings > 0,
        checksumSha256: archive.checksumSha256,
        note: `สำรองข้อมูลเต็มรูปแบบ JSON (บุคลากร ${archive.counts.staffDirectory} คน, ใบลา ${archive.counts.leaveRequests} รายการ)`,
      });

      setStatusBanner({
        type: 'ok',
        text: `ส่งออกไฟล์สำรองข้อมูลเรียบร้อยแล้ว (SHA-256: ${archive.checksumSha256.slice(0, 12)}...)`,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'backup_logs');
    } finally {
      setBackingUp(false);
    }
  };

  const handleExportCsv = async (target: 'staff' | 'leaves') => {
    setBackingUp(true);
    setStatusBanner(null);
    const stamp = new Date().toISOString().slice(0, 10);
    try {
      if (target === 'staff') {
        const csv = generateStaffCsv(staffList);
        downloadTextFile(`donphut-staff-summary-${stamp}.csv`, csv, 'text/csv;charset=utf-8');
        await logBackupAction({
          actionType: 'export_csv',
          staffCount: staffList.length,
          leaveRequestCount: 0,
          settingsIncluded: false,
          checksumSha256: `csv_staff_${Date.now()}`,
          note: `ส่งออกรายงานวันลาบุคลากร CSV (${staffList.length} คน)`,
        });
      } else {
        const csv = generateLeaveRequestsCsv(leaveRequests);
        downloadTextFile(`donphut-leave-requests-${stamp}.csv`, csv, 'text/csv;charset=utf-8');
        await logBackupAction({
          actionType: 'export_csv',
          staffCount: 0,
          leaveRequestCount: leaveRequests.length,
          settingsIncluded: false,
          checksumSha256: `csv_leaves_${Date.now()}`,
          note: `ส่งออกทะเบียนคำขอการลา CSV (${leaveRequests.length} รายการ)`,
        });
      }
      setStatusBanner({ type: 'ok', text: 'ส่งออกไฟล์รายงาน CSV (รองรับภาษาไทยใน Excel) เรียบร้อยแล้ว' });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'backup_logs');
    } finally {
      setBackingUp(false);
    }
  };

  const handleSelectRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRestoreConfirmed(false);
    const text = await file.text();
    const verified = await verifyBackupArchive(text);
    setRestorePreview({
      filename: file.name,
      ...verified,
    });
    e.target.value = '';
  };

  const handleExecuteRestore = async () => {
    if (!restorePreview?.validStructure || !restorePreview.archive || !restoreConfirmed) return;
    const archive = restorePreview.archive;

    setRestoring(true);
    setStatusBanner(null);

    try {
      // Collect operations into chunks of <= 150 writes to respect Firestore 500-op batch limit
      type BatchOp = (batch: ReturnType<typeof writeBatch>) => void;
      const ops: BatchOp[] = [];

      if (restoreSettings && archive.data.systemSettings) {
        const st = archive.data.systemSettings;
        ops.push((batch) => {
          batch.set(doc(db, 'system_settings', 'general'), {
            settingId: 'general',
            officeName: (st.officeName || DEFAULT_SYSTEM_SETTINGS.officeName).slice(0, MAX_LENGTHS.officeName),
            provinceName: (st.provinceName || DEFAULT_SYSTEM_SETTINGS.provinceName).slice(0, MAX_LENGTHS.provinceName),
            defaultDocumentPrefix: (st.defaultDocumentPrefix || DEFAULT_SYSTEM_SETTINGS.defaultDocumentPrefix).slice(0, MAX_LENGTHS.documentPrefix),
            defaultAddressedTo: (st.defaultAddressedTo || DEFAULT_SYSTEM_SETTINGS.defaultAddressedTo).slice(0, MAX_LENGTHS.addressedTo),
            defaultSupervisorTitle: (st.defaultSupervisorTitle || DEFAULT_SYSTEM_SETTINGS.defaultSupervisorTitle).slice(0, MAX_LENGTHS.addressedTo),
            defaultAnnualVacationQuota: Math.min(30, Math.max(0, Number(st.defaultAnnualVacationQuota) || 10)),
            activeFiscalYear: Math.min(2650, Math.max(2560, Math.round(Number(st.activeFiscalYear) || 2570))),
            departments:
              Array.isArray(st.departments) && st.departments.length > 0
                ? st.departments.slice(0, 30)
                : [...DEFAULT_SYSTEM_SETTINGS.departments],
            autoNotifyOnSubmit: Boolean(st.autoNotifyOnSubmit),
            updatedByUid: currentStaff.uid,
            updatedByName: currentStaff.fullName.slice(0, MAX_LENGTHS.fullName),
            updatedAt: serverTimestamp(),
          });
        });
      }

      const existingStaffUids = new Set(staffList.map((s) => s.uid));
      const restoredStaffUids = new Set<string>(existingStaffUids);

      if (restoreStaff) {
        for (const s of archive.data.staffDirectory) {
          if (!VALID_ID_REGEX.test(s.uid)) continue;
          restoredStaffUids.add(s.uid);
          const payload = {
            uid: s.uid,
            fullName: String(s.fullName || 'บุคลากร').slice(0, MAX_LENGTHS.fullName),
            position: String(s.position || 'เจ้าหน้าที่').slice(0, MAX_LENGTHS.position),
            department: String(s.department || DEFAULT_SYSTEM_SETTINGS.departments[0]).slice(0, MAX_LENGTHS.department),
            employmentType: EMPLOYMENT_TYPES.includes(s.employmentType) ? s.employmentType : 'ข้าราชการ',
            role: ['staff', 'verifier', 'supervisor', 'executive', 'admin'].includes(s.role)
              ? s.role
              : 'staff',
            accumulatedVacationDays: Math.min(60, Math.max(0, Number(s.accumulatedVacationDays) || 0)),
            annualVacationQuota: Math.min(30, Math.max(0, Number(s.annualVacationQuota) || 10)),
            usedVacationDays: Math.min(90, Math.max(0, Number(s.usedVacationDays) || 0)),
            usedSickDays: Math.min(365, Math.max(0, Number(s.usedSickDays) || 0)),
            usedPersonalDays: Math.min(90, Math.max(0, Number(s.usedPersonalDays) || 0)),
            usedOtherDays: Math.min(365, Math.max(0, Number(s.usedOtherDays) || 0)),
            isActive: Boolean(s.isActive),
            updatedAt: serverTimestamp(),
          };
          if (existingStaffUids.has(s.uid)) {
            ops.push((batch) => batch.update(doc(db, 'staff_directory', s.uid), payload));
          } else {
            ops.push((batch) =>
              batch.set(doc(db, 'staff_directory', s.uid), {
                ...payload,
                createdAt: serverTimestamp(),
              })
            );
          }
        }

        for (const p of archive.data.staffPrivate) {
          if (!VALID_ID_REGEX.test(p.uid) || !p.email || p.email.length < 3) continue;
          ops.push((batch) =>
            batch.set(doc(db, 'staff_private', p.uid), {
              uid: p.uid,
              email: String(p.email).slice(0, 160),
              phone: String(p.phone ?? '').slice(0, MAX_LENGTHS.phone),
              contactAddress: String(p.contactAddress ?? '').slice(0, MAX_LENGTHS.contactAddress),
              age: Math.min(90, Math.max(18, Math.round(Number(p.age) || 30))),
              hireDate: String(p.hireDate ?? '').slice(0, 40),
              telegramChatId: String(p.telegramChatId ?? '').slice(0, MAX_LENGTHS.telegramChatId),
              updatedAt: serverTimestamp(),
            })
          );
        }
      }

      // Commit phase 1 (settings & staff) before leave requests so parent staff_directory exists() passes
      for (let i = 0; i < ops.length; i += 150) {
        const batch = writeBatch(db);
        ops.slice(i, i + 150).forEach((fn) => fn(batch));
        await batch.commit();
      }

      const leaveOps: BatchOp[] = [];
      const existingLeaveIds = new Set(leaveRequests.map((r) => r.requestId));

      if (restoreLeaves) {
        const validLeaveTypes: LeaveType[] = [
          'vacation',
          'sick',
          'personal',
          'maternity',
          'ordination',
          'overseas',
          'other',
        ];
        const validStatuses: LeaveStatus[] = [
          'pending_verifier',
          'pending_supervisor',
          'approved',
          'rejected',
          'cancelled',
        ];
        const isoDateRe = /^\d{4}-\d{2}-\d{2}$/;

        archive.data.leaveRequests.forEach((bundle, idx) => {
          const r = bundle.request;
          if (
            !VALID_ID_REGEX.test(r.requestId) ||
            !restoredStaffUids.has(r.requesterUid) ||
            !isoDateRe.test(r.startDate) ||
            !isoDateRe.test(r.endDate)
          ) {
            return;
          }
          const safeLeaveType = validLeaveTypes.includes(r.leaveType) ? r.leaveType : 'other';
          const safeStatus = validStatuses.includes(r.status) ? r.status : 'pending_verifier';
          const reqPayload = {
            requestId: r.requestId,
            documentNo: String(r.documentNo ?? '').slice(0, MAX_LENGTHS.documentNo),
            requesterUid: r.requesterUid,
            requesterName: String(r.requesterName || 'บุคลากร').slice(0, MAX_LENGTHS.fullName),
            requesterPosition: String(r.requesterPosition || 'เจ้าหน้าที่').slice(0, MAX_LENGTHS.position),
            department: String(r.department || DEFAULT_SYSTEM_SETTINGS.departments[0]).slice(
              0,
              MAX_LENGTHS.department
            ),
            leaveType: safeLeaveType,
            startDate: r.startDate,
            endDate: r.endDate >= r.startDate ? r.endDate : r.startDate,
            workingDays: Math.min(180, Math.max(0.5, Number(r.workingDays) || 1)),
            fiscalYear: Math.min(2650, Math.max(2560, Math.round(Number(r.fiscalYear) || 2570))),
            priorUsedDays: Math.min(365, Math.max(0, Number(r.priorUsedDays) || 0)),
            accumulatedDaysAtSubmit: Math.min(60, Math.max(0, Number(r.accumulatedDaysAtSubmit) || 0)),
            annualQuotaAtSubmit: Math.min(30, Math.max(0, Number(r.annualQuotaAtSubmit) || 10)),
            substituteUid: String(r.substituteUid ?? '').slice(0, 128),
            substituteName: String(r.substituteName ?? '').slice(0, MAX_LENGTHS.fullName),
            status: safeStatus,
            verifierUid: String(r.verifierUid ?? '').slice(0, 128),
            verifierName: String(r.verifierName ?? '').slice(0, MAX_LENGTHS.fullName),
            verifierPosition: String(r.verifierPosition ?? '').slice(0, MAX_LENGTHS.position),
            verifiedAt: String(r.verifiedAt ?? '').slice(0, 40),
            supervisorUid: String(r.supervisorUid ?? '').slice(0, 128),
            supervisorName: String(r.supervisorName ?? '').slice(0, MAX_LENGTHS.fullName),
            supervisorPosition: String(r.supervisorPosition ?? '').slice(0, MAX_LENGTHS.position),
            supervisorComment: String(r.supervisorComment ?? '').slice(0, MAX_LENGTHS.supervisorComment),
            decisionAt: String(r.decisionAt ?? '').slice(0, 40),
            telegramNotifiedAt: String(r.telegramNotifiedAt ?? '').slice(0, 40),
            updatedAt: serverTimestamp(),
          };

          if (existingLeaveIds.has(r.requestId)) {
            leaveOps.push((batch) => batch.update(doc(db, 'leave_requests', r.requestId), reqPayload));
          } else {
            leaveOps.push((batch) =>
              batch.set(doc(db, 'leave_requests', r.requestId), {
                ...reqPayload,
                createdAt: serverTimestamp(),
              })
            );
          }

          if (bundle.privateDetails) {
            const p = bundle.privateDetails;
            leaveOps.push((batch) =>
              batch.set(doc(db, 'leave_requests', r.requestId, 'private', 'details'), {
                requesterUid: r.requesterUid,
                writtenAt: String(p.writtenAt || r.department).slice(0, MAX_LENGTHS.writtenAt),
                addressedTo: String(p.addressedTo || 'สาธารณสุขอำเภอดอนพุด').slice(
                  0,
                  MAX_LENGTHS.addressedTo
                ),
                reason: String(p.reason ?? '').slice(0, MAX_LENGTHS.reason),
                contactAddress: String(p.contactAddress ?? '').slice(0, MAX_LENGTHS.contactAddress),
                contactPhone: String(p.contactPhone ?? '').slice(0, MAX_LENGTHS.phone),
                overseasCountry: String(p.overseasCountry ?? '').slice(0, MAX_LENGTHS.overseasCountry),
                overseasPurpose: String(p.overseasPurpose ?? '').slice(0, MAX_LENGTHS.overseasPurpose),
                holidayDays: Math.min(180, Math.max(0, Number(p.holidayDays) || 0)),
                holidayRange: String(p.holidayRange ?? '').slice(0, 100),
                personalDays: Math.min(180, Math.max(0, Number(p.personalDays) || 0)),
                personalRange: String(p.personalRange ?? '').slice(0, 100),
                vacationDays: Math.min(180, Math.max(0, Number(p.vacationDays) || 0)),
                vacationRange: String(p.vacationRange ?? '').slice(0, 100),
                otherDays: Math.min(180, Math.max(0, Number(p.otherDays) || 0)),
                otherLabel: String(p.otherLabel ?? '').slice(0, 120),
                otherRange: String(p.otherRange ?? '').slice(0, 100),
                updatedAt: serverTimestamp(),
              })
            );
          }

          leaveOps.push((batch) =>
            batch.set(
              doc(db, 'leave_requests', r.requestId, 'audit_logs', `log_restore_${Date.now()}_${idx}`),
              {
                actorUid: currentStaff.uid,
                actorName: currentStaff.fullName,
                action: 'system_restored',
                note: `กู้คืนข้อมูลจากไฟล์สำรอง (${restorePreview.filename})`,
                createdAt: serverTimestamp(),
              }
            )
          );
        });
      }

      for (let i = 0; i < leaveOps.length; i += 150) {
        const batch = writeBatch(db);
        leaveOps.slice(i, i + 150).forEach((fn) => fn(batch));
        await batch.commit();
      }

      await logBackupAction({
        actionType: 'restore_json',
        staffCount: restoreStaff ? archive.counts.staffDirectory : 0,
        leaveRequestCount: restoreLeaves ? archive.counts.leaveRequests : 0,
        settingsIncluded: Boolean(restoreSettings && archive.data.systemSettings),
        checksumSha256: archive.checksumSha256,
        note: `กู้คืนข้อมูลจากไฟล์ ${restorePreview.filename}`,
      });

      setRestorePreview(null);
      setRestoreConfirmed(false);
      setStatusBanner({
        type: 'ok',
        text: 'กู้คืนข้อมูลจากไฟล์สำรองเข้าสู่ฐานข้อมูลเรียบร้อยแล้ว',
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'backup_restore');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Sub-navigation */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-teal-700">ศูนย์ควบคุมผู้ดูแลระบบ · สสอ.ดอนพุด</p>
          <h2 className="text-xl font-bold text-slate-900 mt-0.5">
            ผู้ดูแลระบบ การแก้ไขข้อมูลทั้งหมด และการสำรองข้อมูล
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            กำหนดสิทธิ์ผู้ดูแลระบบ แก้ไขการตั้งค่าหน่วยงาน ปรับปรุงข้อมูลบุคลากร/ใบลา และสำรอง-กู้คืนฐานข้อมูล
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto shrink-0">
          {(
            [
              { id: 'settings', label: 'ผู้ดูแล & ตั้งค่าระบบ', icon: Settings },
              { id: 'editor', label: 'แก้ไขบุคลากร & ใบลา', icon: Pencil },
              { id: 'backup', label: 'สำรอง & กู้คืนข้อมูล', icon: DatabaseBackup },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSubTab(tab.id)}
                className={`min-h-[42px] px-3.5 py-2 text-xs font-medium rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
                  subTab === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {statusBanner && (
        <div
          className={`border rounded-xl p-3.5 text-sm flex items-center justify-between gap-3 ${
            statusBanner.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusBanner.type === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            <span>{statusBanner.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            className="text-xs opacity-70 hover:opacity-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* SUB-TAB 1: ADMIN RBAC & SYSTEM SETTINGS */}
      {subTab === 'settings' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Admin Privileges Management */}
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  จัดการสิทธิ์ผู้ดูแลระบบ (System Admins)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  ผู้ดูแลระบบสามารถแก้ไขข้อมูลทั้งหมด ตั้งค่าหน่วยงาน และสำรองฐานข้อมูลได้
                </p>
              </div>
              <ShieldCheck className="w-5 h-5 text-teal-700 shrink-0" />
            </div>

            <div className="border border-teal-200 bg-teal-50/50 rounded-xl p-3.5 text-xs space-y-1">
              <p className="font-semibold text-teal-900">ผู้ดูแลระบบหลัก (Bootstrap Admin)</p>
              <p className="text-teal-800 font-mono-tabular">tibularbell@gmail.com</p>
              <p className="text-teal-700">
                มีสิทธิ์สูงสุดในการแต่งตั้งหรือเพิกถอนสิทธิ์ผู้ดูแลระบบเพิ่มเติม
              </p>
            </div>

            {isBootstrapAdmin ? (
              <form onSubmit={handleGrantAdmin} className="space-y-3 border-b border-slate-100 pb-4">
                <p className="text-xs font-semibold text-slate-800">เพิ่มผู้ดูแลระบบใหม่</p>
                <div>
                  <label className="block text-[11px] text-slate-600 mb-1">
                    เลือกบุคลากรในทำเนียบ
                  </label>
                  <select
                    value={grantUid}
                    onChange={(e) => setGrantUid(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white"
                  >
                    <option value="">-- เลือกบุคลากร --</option>
                    {staffList
                      .filter((s) => s.uid !== currentStaff.uid)
                      .map((s) => (
                        <option key={s.uid} value={s.uid}>
                          {s.fullName} ({s.department})
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-600 mb-1">
                    อีเมล Google Account ของผู้รับสิทธิ์
                  </label>
                  <input
                    type="email"
                    required
                    maxLength={160}
                    value={grantEmail}
                    onChange={(e) => setGrantEmail(e.target.value)}
                    placeholder="user@gmail.com"
                    className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-xl"
                  />
                </div>
                <button
                  type="submit"
                  disabled={grantBusy || !grantUid}
                  className="w-full min-h-[44px] px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium rounded-xl cursor-pointer"
                >
                  {grantBusy ? 'กำลังบันทึก...' : 'แต่งตั้งเป็นผู้ดูแลระบบ'}
                </button>
              </form>
            ) : (
              <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl p-3">
                การแต่งตั้งหรือถอนสิทธิ์ผู้ดูแลระบบระดับสูงสุดสงวนสิทธิ์เฉพาะบัญชีหลัก (tibularbell@gmail.com)
              </p>
            )}

            <div className="space-y-2.5">
              <p className="text-xs font-semibold text-slate-700">
                รายชื่อผู้ดูแลระบบที่ได้รับแต่งตั้ง
              </p>
              {isBootstrapAdmin ? (
                adminMarkers.length === 0 ? (
                  <p className="text-xs text-slate-500">ยังไม่มีผู้ดูแลระบบที่แต่งตั้งเพิ่มเติม</p>
                ) : (
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
                    {adminMarkers.map((am) => {
                      const matched = staffList.find((s) => s.uid === am.uid);
                      return (
                        <div key={am.uid} className="p-3 flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-slate-900">
                              {matched?.fullName ?? am.uid}
                            </p>
                            <p className="text-xs text-slate-500">{am.email}</p>
                          </div>
                          {am.uid !== currentStaff.uid && (
                            <button
                              type="button"
                              disabled={grantBusy}
                              onClick={() => void handleRevokeAdmin(am.uid)}
                              className="min-h-[36px] px-3 py-1.5 text-xs font-medium text-rose-700 border border-rose-200 hover:bg-rose-50 rounded-lg cursor-pointer"
                            >
                              ถอนสิทธิ์
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
                  {staffList
                    .filter((s) => s.role === 'admin')
                    .map((s) => (
                      <div key={s.uid} className="p-3">
                        <p className="text-sm font-medium text-slate-900">{s.fullName}</p>
                        <p className="text-xs text-slate-500">
                          {s.position} · {s.department}
                        </p>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>

          {/* System Settings Form */}
          <form
            onSubmit={handleSaveSystemSettings}
            className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5"
          >
            <div className="border-b border-slate-100 pb-4">
              <h3 className="text-base font-semibold text-slate-900">
                ตั้งค่าข้อมูลพื้นฐานของระบบและหน่วยสถานบริการ
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                ใช้เป็นค่าเริ่มต้นสำหรับแบบฟอร์มใบลา การคำนวณปีงบประมาณ และรายชื่อ รพ.สต. ในระบบ
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  ชื่อหน่วยงานหลัก
                </label>
                <input
                  type="text"
                  required
                  maxLength={MAX_LENGTHS.officeName}
                  value={officeName}
                  onChange={(e) => setOfficeName(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">จังหวัด</label>
                <input
                  type="text"
                  required
                  maxLength={MAX_LENGTHS.provinceName}
                  value={provinceName}
                  onChange={(e) => setProvinceName(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  คำขึ้นต้นเลขที่หนังสือ
                </label>
                <input
                  type="text"
                  required
                  maxLength={MAX_LENGTHS.documentPrefix}
                  value={defaultDocumentPrefix}
                  onChange={(e) => setDefaultDocumentPrefix(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  เรียนถึงเริ่มต้น (ในแบบใบลา)
                </label>
                <input
                  type="text"
                  required
                  maxLength={MAX_LENGTHS.addressedTo}
                  value={defaultAddressedTo}
                  onChange={(e) => setDefaultAddressedTo(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  ตำแหน่งผู้มีอำนาจอนุญาตเริ่มต้น
                </label>
                <input
                  type="text"
                  required
                  maxLength={MAX_LENGTHS.addressedTo}
                  value={defaultSupervisorTitle}
                  onChange={(e) => setDefaultSupervisorTitle(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    ปีงบประมาณ (พ.ศ.)
                  </label>
                  <input
                    type="number"
                    min={2560}
                    max={2650}
                    value={activeFiscalYear}
                    onChange={(e) => setActiveFiscalYear(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-xl tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    วันลาพักผ่อน/ปี
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={30}
                    value={defaultAnnualVacationQuota}
                    onChange={(e) => setDefaultAnnualVacationQuota(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-xl tabular-nums"
                  />
                </div>
              </div>
            </div>

            <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={autoNotifyOnSubmit}
                onChange={(e) => setAutoNotifyOnSubmit(e.target.checked)}
                className="w-4 h-4 accent-teal-700"
              />
              <span>ส่งแจ้งเตือนเข้า Telegram อัตโนมัติทันทีเมื่อบุคลากรยื่นใบลาใหม่</span>
            </label>

            {/* Service Units Editor */}
            <div className="border-t border-slate-100 pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-800">
                  รายชื่อหน่วยสถานบริการในสังกัด ({deptList.length}/30 แห่ง)
                </p>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  maxLength={MAX_LENGTHS.department}
                  value={newDeptName}
                  onChange={(e) => setNewDeptName(e.target.value)}
                  placeholder="เพิ่มหน่วยสถานบริการใหม่ เช่น รพ.สต.บ้านใหม่"
                  className="flex-1 min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl"
                />
                <button
                  type="button"
                  onClick={handleAddDepartment}
                  className="min-h-[44px] px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-xl inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>เพิ่มหน่วย</span>
                </button>
              </div>

              <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl max-h-60 overflow-y-auto">
                {deptList.map((dept, idx) => (
                  <div key={`${dept}_${idx}`} className="px-3.5 py-2.5 flex items-center justify-between gap-2 text-sm">
                    <span className="text-slate-800">{dept}</span>
                    {deptList.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setDeptList(deptList.filter((_, i) => i !== idx))}
                        className="text-xs text-rose-700 hover:text-rose-800 px-2 py-1 cursor-pointer"
                      >
                        ลบ
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={savingSettings}
              className="w-full min-h-[46px] px-5 py-2.5 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-medium rounded-xl cursor-pointer"
            >
              {savingSettings ? 'กำลังบันทึกการตั้งค่า...' : 'บันทึกการตั้งค่าระบบทั้งหมด'}
            </button>
          </form>
        </div>
      )}

      {/* SUB-TAB 2: FULL RECORD EDITOR (STAFF + LEAVE REQUESTS) */}
      {subTab === 'editor' && (
        <div className="space-y-6">
          {/* Staff Full Editor */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  แก้ไขข้อมูลบุคลากรและยอดวันลาทั้งหมด ({staffList.length} คน)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  เพิ่ม แก้ไขชื่อ ตำแหน่ง หน่วยสังกัด บทบาท วันลาสะสม วันลาที่ใช้แล้ว และข้อมูลติดต่อส่วนตัว
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={staffSearch}
                    onChange={(e) => setStaffSearch(e.target.value)}
                    placeholder="ค้นหาบุคลากร..."
                    className="min-h-[42px] pl-9 pr-3 py-1.5 text-sm border border-slate-200 rounded-xl"
                  />
                </div>
                <button
                  type="button"
                  onClick={openCreateStaffModal}
                  className="min-h-[42px] px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium rounded-xl inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>เพิ่มบุคลากรใหม่</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                    <th className="py-3 px-4">ชื่อ-นามสกุล / ตำแหน่ง</th>
                    <th className="py-3 px-4">หน่วยงาน</th>
                    <th className="py-3 px-4">บทบาท</th>
                    <th className="py-3 px-4 text-right">สะสม+ปีนี้ / ใช้แล้ว</th>
                    <th className="py-3 px-4 text-center">สถานะ</th>
                    <th className="py-3 px-4 text-right">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredStaff.map((s) => (
                    <tr key={s.uid} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4">
                        <p className="font-medium text-slate-900">{s.fullName}</p>
                        <p className="text-xs text-slate-500">{s.position}</p>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700">{s.department}</td>
                      <td className="py-3 px-4 text-xs text-slate-700">{ROLE_LABELS[s.role]}</td>
                      <td className="py-3 px-4 text-right text-xs tabular-nums text-slate-700">
                        {s.accumulatedVacationDays + s.annualVacationQuota} /{' '}
                        <strong className="text-slate-900">{s.usedVacationDays}</strong>
                      </td>
                      <td className="py-3 px-4 text-center text-xs">
                        <span className={s.isActive ? 'text-emerald-700 font-medium' : 'text-rose-700 font-medium'}>
                          {s.isActive ? 'ใช้งาน' : 'ระงับ'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void openEditStaffModal(s)}
                            className="min-h-[36px] px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-100 rounded-lg inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            <span>แก้ไข</span>
                          </button>
                          {s.uid !== currentStaff.uid && (
                            confirmDeleteStaffUid === s.uid ? (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteStaff(s.uid)}
                                  className="min-h-[36px] px-2.5 py-1 text-xs font-medium bg-rose-700 text-white rounded-lg cursor-pointer"
                                >
                                  ยืนยันลบ
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteStaffUid(null)}
                                  className="min-h-[36px] px-2 py-1 text-xs border border-slate-200 rounded-lg cursor-pointer"
                                >
                                  ยกเลิก
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteStaffUid(s.uid)}
                                className="min-h-[36px] px-2.5 py-1.5 text-xs text-rose-700 border border-rose-200 hover:bg-rose-50 rounded-lg cursor-pointer"
                                aria-label="ลบบุคลากร"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Leave Requests Full Editor */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  แก้ไขข้อมูลคำขอการลาทั้งหมด ({leaveRequests.length} รายการ)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  แก้ไขวันที่ลา เลขที่หนังสือ สถานะการอนุมัติ ความเห็น หรือลบรายการที่บันทึกผิดพลาด
                </p>
              </div>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={leaveSearch}
                  onChange={(e) => setLeaveSearch(e.target.value)}
                  placeholder="ค้นหาชื่อผู้ขอลา / เลขที่..."
                  className="min-h-[42px] pl-9 pr-3 py-1.5 text-sm border border-slate-200 rounded-xl"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                    <th className="py-3 px-4">เลขที่ / ผู้ขอลา</th>
                    <th className="py-3 px-4">ประเภท</th>
                    <th className="py-3 px-4">ช่วงวันที่</th>
                    <th className="py-3 px-4 text-right">วันทำการ</th>
                    <th className="py-3 px-4">สถานะ</th>
                    <th className="py-3 px-4 text-right">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredLeaves.map((r) => (
                    <tr key={r.requestId} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4">
                        <p className="font-medium text-slate-900">{r.requesterName}</p>
                        <p className="text-xs text-slate-500">
                          {r.documentNo || r.requestId} · {r.department}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700">
                        {LEAVE_TYPE_LABELS[r.leaveType]}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700 tabular-nums">
                        {formatThaiDateShort(r.startDate)} – {formatThaiDateShort(r.endDate)}
                      </td>
                      <td className="py-3 px-4 text-right font-semibold tabular-nums text-slate-900">
                        {r.workingDays}
                      </td>
                      <td className="py-3 px-4 text-xs font-medium text-slate-700">
                        {LEAVE_STATUS_LABELS[r.status]}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void openEditLeaveModal(r)}
                            className="min-h-[36px] px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-100 rounded-lg inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            <span>แก้ไขใบลา</span>
                          </button>
                          {confirmDeleteLeaveId === r.requestId ? (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => void handleDeleteLeave(r.requestId)}
                                className="min-h-[36px] px-2.5 py-1 text-xs font-medium bg-rose-700 text-white rounded-lg cursor-pointer"
                              >
                                ยืนยันลบ
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteLeaveId(null)}
                                className="min-h-[36px] px-2 py-1 text-xs border border-slate-200 rounded-lg cursor-pointer"
                              >
                                ยกเลิก
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteLeaveId(r.requestId)}
                              className="min-h-[36px] px-2.5 py-1.5 text-xs text-rose-700 border border-rose-200 hover:bg-rose-50 rounded-lg cursor-pointer"
                              aria-label="ลบคำขอการลา"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
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

      {/* SUB-TAB 3: DATA BACKUP & RESTORE */}
      {subTab === 'backup' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Export Backup & CSV */}
          <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5">
            <div className="border-b border-slate-100 pb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  สำรองข้อมูลและส่งออกรายงาน (Backup & Export)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  สำรองข้อมูลทั้งระบบเป็นไฟล์ JSON พร้อมรหัสตรวจสอบ SHA-256 และส่งออกไฟล์ Excel CSV
                </p>
              </div>
              <Download className="w-5 h-5 text-teal-700 shrink-0" />
            </div>

            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="border border-slate-200 rounded-xl p-3">
                <p className="text-[11px] text-slate-500">บุคลากร</p>
                <p className="text-xl font-bold text-slate-900 tabular-nums">{staffList.length}</p>
              </div>
              <div className="border border-slate-200 rounded-xl p-3">
                <p className="text-[11px] text-slate-500">คำขอการลา</p>
                <p className="text-xl font-bold text-slate-900 tabular-nums">{leaveRequests.length}</p>
              </div>
              <div className="border border-slate-200 rounded-xl p-3">
                <p className="text-[11px] text-slate-500">หน่วยงาน</p>
                <p className="text-xl font-bold text-slate-900 tabular-nums">{departments.length}</p>
              </div>
            </div>

            <div className="space-y-2.5">
              <button
                type="button"
                disabled={backingUp}
                onClick={() => void handleExportFullJson()}
                className="w-full min-h-[48px] px-4 py-2.5 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-medium rounded-xl inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <DatabaseBackup className="w-4 h-4 shrink-0" />
                <span>
                  {backingUp
                    ? 'กำลังรวบรวมข้อมูลทั้งระบบ...'
                    : 'สำรองข้อมูลทั้งระบบเป็นไฟล์ JSON (Full Backup)'}
                </span>
              </button>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  disabled={backingUp}
                  onClick={() => void handleExportCsv('staff')}
                  className="min-h-[44px] px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 text-xs font-medium rounded-xl inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>ส่งออกสรุปวันลาบุคลากร (CSV)</span>
                </button>

                <button
                  type="button"
                  disabled={backingUp}
                  onClick={() => void handleExportCsv('leaves')}
                  className="min-h-[44px] px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 text-xs font-medium rounded-xl inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>ส่งออกทะเบียนใบลาทั้งหมด (CSV)</span>
                </button>
              </div>
            </div>
          </div>

          {/* Restore Backup */}
          <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5">
            <div className="border-b border-slate-100 pb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  กู้คืนข้อมูลจากไฟล์สำรอง (Restore JSON)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  ตรวจสอบลายนิ้วมือ SHA-256 และดูตัวอย่างรายการก่อนนำเข้าฐานข้อมูลจริง
                </p>
              </div>
              <Upload className="w-5 h-5 text-slate-700 shrink-0" />
            </div>

            <label className="block border-2 border-dashed border-slate-200 hover:border-teal-600 rounded-xl p-6 text-center cursor-pointer transition-colors">
              <input
                type="file"
                accept=".json,application/json"
                onChange={(e) => void handleSelectRestoreFile(e)}
                className="sr-only"
              />
              <Upload className="w-6 h-6 text-slate-400 mx-auto mb-2" />
              <p className="text-sm font-medium text-slate-800">
                เลือกไฟล์สำรองข้อมูล (.json) ของระบบ สสอ.ดอนพุด
              </p>
              <p className="text-xs text-slate-500 mt-1">
                ระบบจะตรวจสอบโครงสร้างและ Checksum อัตโนมัติก่อนกู้คืน
              </p>
            </label>

            {restorePreview && (
              <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/70 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">{restorePreview.filename}</span>
                  {restorePreview.validStructure && (
                    <span
                      className={`font-medium ${
                        restorePreview.checksumValid ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {restorePreview.checksumValid
                        ? 'SHA-256 ถูกต้องสมบูรณ์'
                        : 'คำเตือน: Checksum ไม่ตรงกัน'}
                    </span>
                  )}
                </div>

                {!restorePreview.validStructure || !restorePreview.archive ? (
                  <p className="text-rose-700">{restorePreview.error}</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2 text-slate-700">
                      <p>วันที่สำรอง: {restorePreview.archive.exportedAt.slice(0, 16).replace('T', ' ')}</p>
                      <p>ผู้สำรอง: {restorePreview.archive.exportedBy?.name}</p>
                      <p>บุคลากรในไฟล์: {restorePreview.archive.counts.staffDirectory} คน</p>
                      <p>คำขอการลาในไฟล์: {restorePreview.archive.counts.leaveRequests} รายการ</p>
                    </div>

                    <div className="space-y-1.5 border-t border-slate-200 pt-2.5">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={restoreSettings}
                          onChange={(e) => setRestoreSettings(e.target.checked)}
                          className="accent-teal-700"
                        />
                        <span>กู้คืนการตั้งค่าระบบและหน่วยบริการ</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={restoreStaff}
                          onChange={(e) => setRestoreStaff(e.target.checked)}
                          className="accent-teal-700"
                        />
                        <span>กู้คืนข้อมูลบุคลากรและข้อมูลส่วนบุคคล</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={restoreLeaves}
                          onChange={(e) => setRestoreLeaves(e.target.checked)}
                          className="accent-teal-700"
                        />
                        <span>กู้คืนข้อมูลคำขอการลาทั้งหมด</span>
                      </label>
                    </div>

                    <label className="flex items-center gap-2 font-medium text-slate-900 border-t border-slate-200 pt-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={restoreConfirmed}
                        onChange={(e) => setRestoreConfirmed(e.target.checked)}
                        className="accent-teal-700"
                      />
                      <span>ยืนยันการกู้คืนและอัปเดตข้อมูลทับรายการที่ตรงกัน</span>
                    </label>

                    <button
                      type="button"
                      disabled={restoring || !restoreConfirmed}
                      onClick={() => void handleExecuteRestore()}
                      className="w-full min-h-[44px] px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-medium rounded-xl cursor-pointer"
                    >
                      {restoring ? 'กำลังกู้คืนข้อมูลเข้าฐานข้อมูล...' : 'เริ่มกู้คืนข้อมูลเข้าฐานข้อมูล'}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Backup Audit Log */}
          <div className="lg:col-span-12 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  ประวัติการสำรองและกู้คืนข้อมูล (Backup Audit Trail)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  บันทึกถาวรไม่สามารถแก้ไขหรือลบย้อนหลังได้ เพื่อความปลอดภัยและการตรวจสอบ
                </p>
              </div>
              <History className="w-5 h-5 text-slate-400 shrink-0" />
            </div>

            {backupLogs.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                ยังไม่มีประวัติการสำรองข้อมูลในระบบ
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                      <th className="py-3 px-4">วัน-เวลา</th>
                      <th className="py-3 px-4">กิจกรรม</th>
                      <th className="py-3 px-4">ผู้ดำเนินการ</th>
                      <th className="py-3 px-4">รายละเอียด</th>
                      <th className="py-3 px-4">Checksum / Fingerprint</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {backupLogs.map((log) => (
                      <tr key={log.backupId}>
                        <td className="py-3 px-4 tabular-nums text-slate-600">
                          {log.createdAt
                            ? log.createdAt.toDate().toLocaleString('th-TH')
                            : '-'}
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-900">
                          {log.actionType === 'export_json'
                            ? 'สำรองข้อมูล JSON'
                            : log.actionType === 'export_csv'
                              ? 'ส่งออกรายงาน CSV'
                              : 'กู้คืนข้อมูล JSON'}
                        </td>
                        <td className="py-3 px-4 text-slate-700">{log.createdByName}</td>
                        <td className="py-3 px-4 text-slate-600">{log.note || '-'}</td>
                        <td className="py-3 px-4 font-mono-tabular text-slate-500">
                          {log.checksumSha256.slice(0, 16)}...
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: CREATE / EDIT STAFF */}
      {editingStaffModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveStaffModal}
            className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-5 sm:p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editingStaffModal.mode === 'create'
                  ? 'เพิ่มข้อมูลบุคลากรใหม่'
                  : `แก้ไขข้อมูลบุคลากร: ${editingStaffModal.fullName}`}
              </h3>
              <button
                type="button"
                onClick={() => setEditingStaffModal(null)}
                className="p-2 text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-sm">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">ชื่อ-นามสกุล</label>
                <input
                  type="text"
                  required
                  maxLength={MAX_LENGTHS.fullName}
                  value={editingStaffModal.fullName}
                  onChange={(e) =>
                    setEditingStaffModal({ ...editingStaffModal, fullName: e.target.value })
                  }
                  className="w-full min-h-[42px] px-3 py-2 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">ตำแหน่ง</label>
                <input
                  type="text"
                  required
                  maxLength={MAX_LENGTHS.position}
                  value={editingStaffModal.position}
                  onChange={(e) =>
                    setEditingStaffModal({ ...editingStaffModal, position: e.target.value })
                  }
                  className="w-full min-h-[42px] px-3 py-2 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">หน่วยงานสังกัด</label>
                <select
                  value={editingStaffModal.department}
                  onChange={(e) =>
                    setEditingStaffModal({ ...editingStaffModal, department: e.target.value })
                  }
                  className="w-full min-h-[42px] px-3 py-2 border border-slate-200 rounded-xl bg-white"
                >
                  {departments.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                  {!departments.includes(editingStaffModal.department) && (
                    <option value={editingStaffModal.department}>
                      {editingStaffModal.department}
                    </option>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">ประเภทบุคลากร</label>
                <select
                  value={editingStaffModal.employmentType}
                  onChange={(e) =>
                    setEditingStaffModal({
                      ...editingStaffModal,
                      employmentType: e.target.value as EmploymentType,
                    })
                  }
                  className="w-full min-h-[42px] px-3 py-2 border border-slate-200 rounded-xl bg-white"
                >
                  {EMPLOYMENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">บทบาทในระบบ</label>
                <select
                  value={editingStaffModal.role}
                  onChange={(e) =>
                    setEditingStaffModal({
                      ...editingStaffModal,
                      role: e.target.value as StaffRole,
                    })
                  }
                  className="w-full min-h-[42px] px-3 py-2 border border-slate-200 rounded-xl bg-white"
                >
                  {(Object.keys(ROLE_LABELS) as StaffRole[]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingStaffModal.isActive}
                    onChange={(e) =>
                      setEditingStaffModal({ ...editingStaffModal, isActive: e.target.checked })
                    }
                    className="w-4 h-4 accent-teal-700"
                  />
                  <span>เปิดใช้งานบัญชีบุคลากร (Active)</span>
                </label>
              </div>

              <div className="sm:col-span-2 grid grid-cols-3 sm:grid-cols-6 gap-2.5 border-t border-slate-100 pt-3">
                <div>
                  <label className="block text-[11px] text-slate-600 mb-1">สะสม (วัน)</label>
                  <input
                    type="number"
                    min={0}
                    max={60}
                    step="0.5"
                    value={editingStaffModal.accumulatedVacationDays}
                    onChange={(e) =>
                      setEditingStaffModal({
                        ...editingStaffModal,
                        accumulatedVacationDays: e.target.value,
                      })
                    }
                    className="w-full min-h-[40px] px-2.5 border border-slate-200 rounded-lg tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-600 mb-1">สิทธิปีนี้</label>
                  <input
                    type="number"
                    min={0}
                    max={30}
                    step="0.5"
                    value={editingStaffModal.annualVacationQuota}
                    onChange={(e) =>
                      setEditingStaffModal({
                        ...editingStaffModal,
                        annualVacationQuota: e.target.value,
                      })
                    }
                    className="w-full min-h-[40px] px-2.5 border border-slate-200 rounded-lg tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-600 mb-1">ใช้พักผ่อน</label>
                  <input
                    type="number"
                    min={0}
                    max={90}
                    step="0.5"
                    value={editingStaffModal.usedVacationDays}
                    onChange={(e) =>
                      setEditingStaffModal({
                        ...editingStaffModal,
                        usedVacationDays: e.target.value,
                      })
                    }
                    className="w-full min-h-[40px] px-2.5 border border-slate-200 rounded-lg tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-600 mb-1">ใช้ลาป่วย</label>
                  <input
                    type="number"
                    min={0}
                    max={365}
                    step="0.5"
                    value={editingStaffModal.usedSickDays}
                    onChange={(e) =>
                      setEditingStaffModal({ ...editingStaffModal, usedSickDays: e.target.value })
                    }
                    className="w-full min-h-[40px] px-2.5 border border-slate-200 rounded-lg tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-600 mb-1">ใช้ลากิจ</label>
                  <input
                    type="number"
                    min={0}
                    max={90}
                    step="0.5"
                    value={editingStaffModal.usedPersonalDays}
                    onChange={(e) =>
                      setEditingStaffModal({
                        ...editingStaffModal,
                        usedPersonalDays: e.target.value,
                      })
                    }
                    className="w-full min-h-[40px] px-2.5 border border-slate-200 rounded-lg tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-600 mb-1">ลาอื่นๆ</label>
                  <input
                    type="number"
                    min={0}
                    max={365}
                    step="0.5"
                    value={editingStaffModal.usedOtherDays}
                    onChange={(e) =>
                      setEditingStaffModal({
                        ...editingStaffModal,
                        usedOtherDays: e.target.value,
                      })
                    }
                    className="w-full min-h-[40px] px-2.5 border border-slate-200 rounded-lg tabular-nums"
                  />
                </div>
              </div>

              <div className="sm:col-span-2 border-t border-slate-100 pt-3">
                <p className="text-xs font-semibold text-slate-700 mb-2">
                  ข้อมูลส่วนบุคคลและการเชื่อมต่อ Telegram (เก็บแยกใน staff_private)
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="email"
                    maxLength={160}
                    value={editingStaffModal.email}
                    onChange={(e) =>
                      setEditingStaffModal({ ...editingStaffModal, email: e.target.value })
                    }
                    placeholder="อีเมล (จำเป็นสำหรับการบันทึกข้อมูลส่วนตัว)"
                    className="w-full min-h-[40px] px-3 border border-slate-200 rounded-xl text-xs"
                  />
                  <input
                    type="tel"
                    maxLength={MAX_LENGTHS.phone}
                    value={editingStaffModal.phone}
                    onChange={(e) =>
                      setEditingStaffModal({ ...editingStaffModal, phone: e.target.value })
                    }
                    placeholder="เบอร์โทรศัพท์"
                    className="w-full min-h-[40px] px-3 border border-slate-200 rounded-xl text-xs"
                  />
                  <input
                    type="text"
                    maxLength={MAX_LENGTHS.telegramChatId}
                    value={editingStaffModal.telegramChatId}
                    onChange={(e) =>
                      setEditingStaffModal({
                        ...editingStaffModal,
                        telegramChatId: e.target.value,
                      })
                    }
                    placeholder="Telegram Chat ID"
                    className="w-full min-h-[40px] px-3 border border-slate-200 rounded-xl text-xs font-mono-tabular"
                  />
                  <input
                    type="text"
                    maxLength={40}
                    value={editingStaffModal.hireDate}
                    onChange={(e) =>
                      setEditingStaffModal({ ...editingStaffModal, hireDate: e.target.value })
                    }
                    placeholder="วันที่บรรจุ เช่น 1 ตุลาคม 2562"
                    className="w-full min-h-[40px] px-3 border border-slate-200 rounded-xl text-xs"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => setEditingStaffModal(null)}
                className="min-h-[42px] px-4 py-2 text-xs font-medium border border-slate-200 rounded-xl cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={savingStaffModal}
                className="min-h-[42px] px-5 py-2 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-xs font-medium rounded-xl cursor-pointer"
              >
                {savingStaffModal ? 'กำลังบันทึก...' : 'บันทึกข้อมูลบุคลากร'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: EDIT LEAVE REQUEST */}
      {editingLeaveModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveLeaveModal}
            className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-5 sm:p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                แก้ไขข้อมูลคำขอการลา ({editingLeaveModal.requestId})
              </h3>
              <button
                type="button"
                onClick={() => setEditingLeaveModal(null)}
                className="p-2 text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-sm">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">เลขที่หนังสือ</label>
                <input
                  type="text"
                  maxLength={MAX_LENGTHS.documentNo}
                  value={editingLeaveModal.documentNo}
                  onChange={(e) =>
                    setEditingLeaveModal({ ...editingLeaveModal, documentNo: e.target.value })
                  }
                  className="w-full min-h-[42px] px-3 py-2 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">สถานะคำขอ</label>
                <select
                  value={editingLeaveModal.status}
                  onChange={(e) =>
                    setEditingLeaveModal({
                      ...editingLeaveModal,
                      status: e.target.value as LeaveStatus,
                    })
                  }
                  className="w-full min-h-[42px] px-3 py-2 border border-slate-200 rounded-xl bg-white"
                >
                  {(Object.keys(LEAVE_STATUS_LABELS) as LeaveStatus[]).map((st) => (
                    <option key={st} value={st}>
                      {LEAVE_STATUS_LABELS[st]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">ประเภทการลา</label>
                <select
                  value={editingLeaveModal.leaveType}
                  onChange={(e) =>
                    setEditingLeaveModal({
                      ...editingLeaveModal,
                      leaveType: e.target.value as LeaveType,
                    })
                  }
                  className="w-full min-h-[42px] px-3 py-2 border border-slate-200 rounded-xl bg-white"
                >
                  {(Object.keys(LEAVE_TYPE_LABELS) as LeaveType[]).map((lt) => (
                    <option key={lt} value={lt}>
                      {LEAVE_TYPE_LABELS[lt]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">หน่วยงาน</label>
                <select
                  value={editingLeaveModal.department}
                  onChange={(e) =>
                    setEditingLeaveModal({ ...editingLeaveModal, department: e.target.value })
                  }
                  className="w-full min-h-[42px] px-3 py-2 border border-slate-200 rounded-xl bg-white"
                >
                  {departments.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                  {!departments.includes(editingLeaveModal.department) && (
                    <option value={editingLeaveModal.department}>
                      {editingLeaveModal.department}
                    </option>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">วันที่เริ่มลา</label>
                <input
                  type="date"
                  required
                  value={editingLeaveModal.startDate}
                  onChange={(e) =>
                    setEditingLeaveModal({ ...editingLeaveModal, startDate: e.target.value })
                  }
                  className="w-full min-h-[42px] px-3 py-2 border border-slate-200 rounded-xl tabular-nums"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">วันที่สิ้นสุด</label>
                <input
                  type="date"
                  required
                  value={editingLeaveModal.endDate}
                  onChange={(e) =>
                    setEditingLeaveModal({ ...editingLeaveModal, endDate: e.target.value })
                  }
                  className="w-full min-h-[42px] px-3 py-2 border border-slate-200 rounded-xl tabular-nums"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  จำนวนวันทำการ
                </label>
                <input
                  type="number"
                  step="0.5"
                  min={0.5}
                  max={180}
                  value={editingLeaveModal.workingDays}
                  onChange={(e) =>
                    setEditingLeaveModal({ ...editingLeaveModal, workingDays: e.target.value })
                  }
                  className="w-full min-h-[42px] px-3 py-2 border border-slate-200 rounded-xl tabular-nums"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  ปีงบประมาณ (พ.ศ.)
                </label>
                <input
                  type="number"
                  min={2560}
                  max={2650}
                  value={editingLeaveModal.fiscalYear}
                  onChange={(e) =>
                    setEditingLeaveModal({ ...editingLeaveModal, fiscalYear: e.target.value })
                  }
                  className="w-full min-h-[42px] px-3 py-2 border border-slate-200 rounded-xl tabular-nums"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  ผู้ปฏิบัติงานแทน
                </label>
                <input
                  type="text"
                  maxLength={MAX_LENGTHS.fullName}
                  value={editingLeaveModal.substituteName}
                  onChange={(e) =>
                    setEditingLeaveModal({ ...editingLeaveModal, substituteName: e.target.value })
                  }
                  className="w-full min-h-[42px] px-3 py-2 border border-slate-200 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  ความเห็นผู้บังคับบัญชา
                </label>
                <input
                  type="text"
                  maxLength={MAX_LENGTHS.supervisorComment}
                  value={editingLeaveModal.supervisorComment}
                  onChange={(e) =>
                    setEditingLeaveModal({
                      ...editingLeaveModal,
                      supervisorComment: e.target.value,
                    })
                  }
                  className="w-full min-h-[42px] px-3 py-2 border border-slate-200 rounded-xl"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">เหตุผลการลา</label>
                <input
                  type="text"
                  maxLength={MAX_LENGTHS.reason}
                  value={editingLeaveModal.reason}
                  onChange={(e) =>
                    setEditingLeaveModal({ ...editingLeaveModal, reason: e.target.value })
                  }
                  className="w-full min-h-[42px] px-3 py-2 border border-slate-200 rounded-xl"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2.5 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => setEditingLeaveModal(null)}
                className="min-h-[42px] px-4 py-2 text-xs font-medium border border-slate-200 rounded-xl cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={savingLeaveModal}
                className="min-h-[42px] px-5 py-2 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-xs font-medium rounded-xl cursor-pointer"
              >
                {savingLeaveModal ? 'กำลังบันทึก...' : 'บันทึกการแก้ไขคำขอการลา'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
