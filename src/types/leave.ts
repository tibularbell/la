import type { Timestamp } from 'firebase/firestore';

export type StaffRole = 'staff' | 'verifier' | 'supervisor' | 'executive' | 'admin';

export type EmploymentType =
  | 'ข้าราชการ'
  | 'พนักงานราชการ'
  | 'ลูกจ้างประจำ'
  | 'พนักงานกระทรวงสาธารณสุข'
  | 'ลูกจ้างชั่วคราว';

export type LeaveType =
  | 'vacation'
  | 'sick'
  | 'personal'
  | 'maternity'
  | 'ordination'
  | 'overseas'
  | 'other';

export type LeaveStatus =
  | 'pending_verifier'
  | 'pending_supervisor'
  | 'approved'
  | 'rejected'
  | 'cancelled';

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  vacation: 'ลาพักผ่อน',
  sick: 'ลาป่วย',
  personal: 'ลากิจส่วนตัว',
  maternity: 'ลาคลอดบุตร',
  ordination: 'ลาอุปสมบท',
  overseas: 'ขออนุญาตไปต่างประเทศ',
  other: 'ลาอื่นๆ',
};

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  pending_verifier: 'รอผู้ตรวจสอบสถิติ',
  pending_supervisor: 'รอผู้มีอำนาจอนุญาต',
  approved: 'อนุญาตแล้ว',
  rejected: 'ไม่อนุญาต',
  cancelled: 'ยกเลิกคำขอ',
};

export const DON_PHUT_DEPARTMENTS = [
  'สำนักงานสาธารณสุขอำเภอดอนพุด',
  'รพ.สต.ดอนพุด',
  'รพ.สต.ดงตะงาว',
  'รพ.สต.ไผ่หลิ่ว',
  'รพ.สต.บ้านหลวง',
  'รพ.สต.บ้านรี',
  'รพ.สต.บ้านหนองมน',
] as const;

export const MAX_LENGTHS = {
  fullName: 120,
  position: 120,
  department: 120,
  phone: 32,
  contactAddress: 300,
  reason: 500,
  writtenAt: 120,
  addressedTo: 120,
  supervisorComment: 400,
  overseasCountry: 100,
  overseasPurpose: 200,
  telegramChatId: 64,
  officeName: 160,
  provinceName: 100,
  documentPrefix: 40,
  documentNo: 40,
} as const;

export interface StaffPublicProfile {
  uid: string;
  fullName: string;
  position: string;
  department: string;
  employmentType: EmploymentType;
  role: StaffRole;
  accumulatedVacationDays: number;
  annualVacationQuota: number;
  usedVacationDays: number;
  usedSickDays: number;
  usedPersonalDays: number;
  usedOtherDays: number;
  isActive: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface StaffPrivatePII {
  uid: string;
  email: string;
  phone?: string;
  contactAddress?: string;
  age?: number;
  hireDate?: string;
  telegramChatId?: string;
  lineUserId?: string;
  updatedAt?: Timestamp;
}

export interface LeaveRequest {
  requestId: string;
  documentNo?: string;
  requesterUid: string;
  requesterName: string;
  requesterPosition: string;
  department: string;
  leaveType: LeaveType;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  workingDays: number;
  fiscalYear: number;
  priorUsedDays: number;
  accumulatedDaysAtSubmit?: number;
  annualQuotaAtSubmit?: number;
  substituteUid?: string;
  substituteName?: string;
  status: LeaveStatus;
  verifierUid?: string;
  verifierName?: string;
  verifierPosition?: string;
  verifiedAt?: string;
  supervisorUid?: string;
  supervisorName?: string;
  supervisorPosition?: string;
  supervisorComment?: string;
  decisionAt?: string;
  telegramNotifiedAt?: string;
  lineNotifiedAt?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface LeaveRequestPrivateDetails {
  requesterUid: string;
  writtenAt: string;
  addressedTo: string;
  reason?: string;
  contactAddress?: string;
  contactPhone?: string;
  overseasCountry?: string;
  overseasPurpose?: string;
  holidayDays?: number;
  holidayRange?: string;
  personalDays?: number;
  personalRange?: string;
  vacationDays?: number;
  vacationRange?: string;
  otherDays?: number;
  otherLabel?: string;
  otherRange?: string;
  updatedAt?: Timestamp;
}

export interface LeaveAuditLog {
  id?: string;
  actorUid: string;
  actorName: string;
  action:
    | 'submitted'
    | 'verified'
    | 'approved'
    | 'rejected'
    | 'cancelled'
    | 'telegram_notified'
    | 'line_notified'
    | 'admin_edited'
    | 'system_restored'
    | 'edited';
  note?: string;
  createdAt?: Timestamp;
}

export interface TelegramNotificationLog {
  notificationId: string;
  requestId: string;
  senderUid: string;
  recipientRole: 'verifier' | 'supervisor' | 'requester';
  channelMode: 'telegram_bot_api' | 'telegram_share' | 'in_app_realtime';
  deliveryStatus: 'sent' | 'ready_to_share' | 'failed';
  summaryText: string;
  createdAt?: Timestamp;
}

export interface TelegramDispatchResponse {
  delivered: boolean;
  channelMode: 'telegram_bot_api' | 'telegram_share';
  warning?: string;
  approvalUrl: string;
  shareUrl: string;
  telegramPayload: Record<string, unknown>;
  summaryText: string;
}

export interface AiLeaveAssistantResult {
  shouldFillForm: boolean;
  leaveType?: LeaveType | '';
  startDate?: string;
  endDate?: string;
  reason?: string;
  contactAddress?: string;
  contactPhone?: string;
  substituteName?: string;
  overseasCountry?: string;
  overseasPurpose?: string;
  assistantReply: string;
  policyNotes: string[];
}

export interface AiExecutiveInsightResult {
  headline: string;
  executiveSummary: string;
  highlights: string[];
  recommendations: string[];
}

export interface AdminMarker {
  uid: string;
  email: string;
  createdAt?: Timestamp;
}

export interface SystemSettings {
  settingId: string;
  officeName: string;
  provinceName: string;
  defaultDocumentPrefix: string;
  defaultAddressedTo: string;
  defaultSupervisorTitle: string;
  defaultAnnualVacationQuota: number;
  activeFiscalYear: number;
  departments: string[];
  autoNotifyOnSubmit: boolean;
  updatedByUid: string;
  updatedByName: string;
  updatedAt?: Timestamp;
}

export const DEFAULT_SYSTEM_SETTINGS: Omit<
  SystemSettings,
  'updatedByUid' | 'updatedByName' | 'updatedAt'
> = {
  settingId: 'general',
  officeName: 'สำนักงานสาธารณสุขอำเภอดอนพุด',
  provinceName: 'จังหวัดสระบุรี',
  defaultDocumentPrefix: 'สบ ๐๔๓๒/ว',
  defaultAddressedTo: 'สาธารณสุขอำเภอดอนพุด',
  defaultSupervisorTitle: 'สาธารณสุขอำเภอดอนพุด',
  defaultAnnualVacationQuota: 10,
  activeFiscalYear: 2570,
  departments: [...DON_PHUT_DEPARTMENTS],
  autoNotifyOnSubmit: true,
};

export interface BackupLog {
  backupId: string;
  actionType: 'export_json' | 'export_csv' | 'restore_json';
  createdByUid: string;
  createdByName: string;
  staffCount: number;
  leaveRequestCount: number;
  settingsIncluded: boolean;
  checksumSha256: string;
  note?: string;
  createdAt?: Timestamp;
}

export interface BackupLeaveBundle {
  request: Omit<LeaveRequest, 'createdAt' | 'updatedAt'> & {
    createdAtIso?: string;
    updatedAtIso?: string;
  };
  privateDetails?: Omit<LeaveRequestPrivateDetails, 'updatedAt'> | null;
}

export interface SystemBackupArchive {
  schemaVersion: 'donphut-leave-v1';
  exportedAt: string;
  exportedBy: {
    uid: string;
    name: string;
    email: string;
  };
  checksumSha256: string;
  counts: {
    staffDirectory: number;
    staffPrivate: number;
    leaveRequests: number;
    systemSettings: number;
  };
  data: {
    systemSettings?: Omit<SystemSettings, 'updatedAt'> | null;
    staffDirectory: Array<Omit<StaffPublicProfile, 'createdAt' | 'updatedAt'>>;
    staffPrivate: Array<Omit<StaffPrivatePII, 'updatedAt'>>;
    leaveRequests: BackupLeaveBundle[];
  };
}
