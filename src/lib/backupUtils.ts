import {
  LEAVE_STATUS_LABELS,
  LEAVE_TYPE_LABELS,
} from '../types/leave';
import type {
  BackupLeaveBundle,
  LeaveRequest,
  LeaveRequestPrivateDetails,
  StaffPrivatePII,
  StaffPublicProfile,
  SystemBackupArchive,
  SystemSettings,
} from '../types/leave';

export async function computeSha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function stripTimestamps<T extends Record<string, unknown>>(obj: T): Omit<T, 'createdAt' | 'updatedAt'> {
  const copy = { ...obj };
  delete copy.createdAt;
  delete copy.updatedAt;
  return copy as Omit<T, 'createdAt' | 'updatedAt'>;
}

export async function buildBackupArchive(params: {
  exportedBy: { uid: string; name: string; email: string };
  systemSettings: SystemSettings | null;
  staffDirectory: StaffPublicProfile[];
  staffPrivate: StaffPrivatePII[];
  leaveBundles: Array<{
    request: LeaveRequest;
    privateDetails: LeaveRequestPrivateDetails | null;
  }>;
}): Promise<SystemBackupArchive> {
  const exportedAt = new Date().toISOString();

  const cleanSettings = params.systemSettings
    ? stripTimestamps(params.systemSettings as unknown as Record<string, unknown>)
    : null;
  const cleanStaffDir = params.staffDirectory.map((s) =>
    stripTimestamps(s as unknown as Record<string, unknown>)
  ) as Array<Omit<StaffPublicProfile, 'createdAt' | 'updatedAt'>>;
  const cleanStaffPrivate = params.staffPrivate.map((p) =>
    stripTimestamps(p as unknown as Record<string, unknown>)
  ) as Array<Omit<StaffPrivatePII, 'updatedAt'>>;
  const cleanLeaves: BackupLeaveBundle[] = params.leaveBundles.map(({ request, privateDetails }) => ({
    request: {
      ...(stripTimestamps(request as unknown as Record<string, unknown>) as Omit<
        LeaveRequest,
        'createdAt' | 'updatedAt'
      >),
      createdAtIso: request.createdAt ? request.createdAt.toDate().toISOString() : undefined,
      updatedAtIso: request.updatedAt ? request.updatedAt.toDate().toISOString() : undefined,
    },
    privateDetails: privateDetails
      ? (stripTimestamps(privateDetails as unknown as Record<string, unknown>) as Omit<
          LeaveRequestPrivateDetails,
          'updatedAt'
        >)
      : null,
  }));

  const data: SystemBackupArchive['data'] = {
    systemSettings: cleanSettings as Omit<SystemSettings, 'updatedAt'> | null,
    staffDirectory: cleanStaffDir,
    staffPrivate: cleanStaffPrivate,
    leaveRequests: cleanLeaves,
  };

  const counts: SystemBackupArchive['counts'] = {
    staffDirectory: cleanStaffDir.length,
    staffPrivate: cleanStaffPrivate.length,
    leaveRequests: cleanLeaves.length,
    systemSettings: cleanSettings ? 1 : 0,
  };

  const canonical = JSON.stringify({
    schemaVersion: 'donphut-leave-v1',
    exportedAt,
    counts,
    data,
  });
  const checksumSha256 = await computeSha256Hex(canonical);

  return {
    schemaVersion: 'donphut-leave-v1',
    exportedAt,
    exportedBy: params.exportedBy,
    checksumSha256,
    counts,
    data,
  };
}

export async function verifyBackupArchive(rawText: string): Promise<{
  validStructure: boolean;
  checksumValid: boolean;
  archive: SystemBackupArchive | null;
  error?: string;
}> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return {
      validStructure: false,
      checksumValid: false,
      archive: null,
      error: 'ไฟล์ไม่ใช่รูปแบบ JSON ที่ถูกต้อง',
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      validStructure: false,
      checksumValid: false,
      archive: null,
      error: 'โครงสร้างข้อมูลในไฟล์ไม่ถูกต้อง',
    };
  }

  const obj = parsed as Partial<SystemBackupArchive>;
  if (
    obj.schemaVersion !== 'donphut-leave-v1' ||
    !obj.exportedAt ||
    !obj.counts ||
    !obj.data ||
    !Array.isArray(obj.data.staffDirectory) ||
    !Array.isArray(obj.data.staffPrivate) ||
    !Array.isArray(obj.data.leaveRequests)
  ) {
    return {
      validStructure: false,
      checksumValid: false,
      archive: null,
      error: 'ไฟล์สำรองข้อมูลไม่ตรงกับรูปแบบระบบ สสอ.ดอนพุด (donphut-leave-v1)',
    };
  }

  const canonical = JSON.stringify({
    schemaVersion: obj.schemaVersion,
    exportedAt: obj.exportedAt,
    counts: obj.counts,
    data: obj.data,
  });
  const computed = await computeSha256Hex(canonical);
  const checksumValid = typeof obj.checksumSha256 === 'string' && computed === obj.checksumSha256;

  return {
    validStructure: true,
    checksumValid,
    archive: obj as SystemBackupArchive,
  };
}

function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  const raw = value === null || value === undefined ? '' : String(value);
  // Protect Excel against formula injection (=, +, -, @)
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  const escaped = safe.replace(/"/g, '""');
  return `"${escaped}"`;
}

export function generateStaffCsv(staffList: StaffPublicProfile[]): string {
  const headers = [
    'UID',
    'ชื่อ-นามสกุล',
    'ตำแหน่ง',
    'หน่วยงานสังกัด',
    'ประเภทบุคลากร',
    'บทบาทในระบบ',
    'วันลาพักผ่อนสะสม',
    'สิทธิลาพักผ่อนประจำปี',
    'ใช้ลาพักผ่อนแล้ว',
    'คงเหลือลาพักผ่อน',
    'ใช้ลาป่วยแล้ว',
    'ใช้ลากิจแล้ว',
    'ใช้ลาอื่นๆแล้ว',
    'สถานะใช้งาน',
  ];
  const rows = staffList.map((s) => {
    const remaining = Math.max(0, s.accumulatedVacationDays + s.annualVacationQuota - s.usedVacationDays);
    return [
      s.uid,
      s.fullName,
      s.position,
      s.department,
      s.employmentType,
      s.role,
      s.accumulatedVacationDays,
      s.annualVacationQuota,
      s.usedVacationDays,
      remaining,
      s.usedSickDays,
      s.usedPersonalDays,
      s.usedOtherDays,
      s.isActive ? 'ใช้งาน' : 'ระงับ',
    ]
      .map(escapeCsvCell)
      .join(',');
  });
  return `\uFEFF${[headers.map(escapeCsvCell).join(','), ...rows].join('\r\n')}`;
}

export function generateLeaveRequestsCsv(requests: LeaveRequest[]): string {
  const headers = [
    'รหัสคำขอ',
    'เลขที่หนังสือ',
    'ชื่อผู้ขอลา',
    'ตำแหน่ง',
    'หน่วยงาน',
    'ประเภทการลา',
    'วันที่เริ่มลา',
    'วันที่สิ้นสุด',
    'จำนวนวันทำการ',
    'ปีงบประมาณ',
    'สถานะ',
    'ผู้ปฏิบัติงานแทน',
    'ผู้ตรวจสอบสถิติ',
    'ผู้อนุมัติ',
    'ความเห็นผู้อนุมัติ',
  ];
  const rows = requests.map((r) =>
    [
      r.requestId,
      r.documentNo ?? '',
      r.requesterName,
      r.requesterPosition,
      r.department,
      LEAVE_TYPE_LABELS[r.leaveType] ?? r.leaveType,
      r.startDate,
      r.endDate,
      r.workingDays,
      r.fiscalYear,
      LEAVE_STATUS_LABELS[r.status] ?? r.status,
      r.substituteName ?? '',
      r.verifierName ?? '',
      r.supervisorName ?? '',
      r.supervisorComment ?? '',
    ]
      .map(escapeCsvCell)
      .join(',')
  );
  return `\uFEFF${[headers.map(escapeCsvCell).join(','), ...rows].join('\r\n')}`;
}

export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
