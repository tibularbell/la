import React, { useEffect, useState } from 'react';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { ShieldCheck, Save, CheckCircle2, Lock } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { DON_PHUT_DEPARTMENTS, MAX_LENGTHS } from '../types/leave';
import type { StaffPrivatePII, StaffPublicProfile, StaffRole } from '../types/leave';

interface PersonnelManagementProps {
  currentStaff: StaffPublicProfile;
  staffList: StaffPublicProfile[];
  departments?: string[];
  isAdmin: boolean;
  userEmail: string;
  onOpenAdminPanel?: () => void;
}

const ROLE_LABELS: Record<StaffRole, string> = {
  staff: 'บุคลากรทั่วไป',
  verifier: 'ผู้ตรวจสอบสถิติ (HR)',
  supervisor: 'ผู้บังคับบัญชา / สสอ.',
  executive: 'ผู้บริหาร',
  admin: 'ผู้ดูแลระบบ',
};

export const PersonnelManagement: React.FC<PersonnelManagementProps> = ({
  currentStaff,
  staffList,
  departments,
  isAdmin,
  userEmail,
  onOpenAdminPanel,
}) => {
  const activeDepartments = departments?.length ? departments : [...DON_PHUT_DEPARTMENTS];
  const [phone, setPhone] = useState('');
  const [contactAddress, setContactAddress] = useState('');
  const [age, setAge] = useState('32');
  const [hireDate, setHireDate] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [savingPrivate, setSavingPrivate] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<StaffRole>('staff');
  const [editDept, setEditDept] = useState<string>(DON_PHUT_DEPARTMENTS[0]);
  const [editAccDays, setEditAccDays] = useState('10');
  const [editQuota, setEditQuota] = useState('10');

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const snap = await getDoc(doc(db, 'staff_private', currentStaff.uid));
        if (mounted && snap.exists()) {
          const d = snap.data() as StaffPrivatePII;
          setPhone(d.phone ?? '');
          setContactAddress(d.contactAddress ?? '');
          setAge(String(d.age ?? 32));
          setHireDate(d.hireDate ?? '');
          setTelegramChatId(d.telegramChatId ?? '');
        }
      } catch {
        // Ignore if not yet created
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [currentStaff.uid]);

  const handleSavePrivatePII = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPrivate(true);
    setSavedMsg('');
    const parsedAge = Math.min(90, Math.max(18, Math.round(Number(age) || 30)));
    try {
      await setDoc(doc(db, 'staff_private', currentStaff.uid), {
        uid: currentStaff.uid,
        email: userEmail.slice(0, 160),
        phone: phone.trim().slice(0, MAX_LENGTHS.phone),
        contactAddress: contactAddress.trim().slice(0, MAX_LENGTHS.contactAddress),
        age: parsedAge,
        hireDate: hireDate.trim().slice(0, 40),
        telegramChatId: telegramChatId.trim().slice(0, MAX_LENGTHS.telegramChatId),
        updatedAt: serverTimestamp(),
      });
      setSavedMsg('บันทึกข้อมูลส่วนบุคคลและ Telegram Chat ID เรียบร้อยแล้ว');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `staff_private/${currentStaff.uid}`);
    } finally {
      setSavingPrivate(false);
    }
  };

  const handleStartEditStaff = (s: StaffPublicProfile) => {
    setEditingUid(s.uid);
    setEditRole(s.role);
    setEditDept(s.department);
    setEditAccDays(String(s.accumulatedVacationDays));
    setEditQuota(String(s.annualVacationQuota));
  };

  const handleSaveAdminStaff = async (uid: string) => {
    try {
      await updateDoc(doc(db, 'staff_directory', uid), {
        role: editRole,
        department: editDept,
        accumulatedVacationDays: Math.min(60, Math.max(0, Number(editAccDays) || 0)),
        annualVacationQuota: Math.min(30, Math.max(0, Number(editQuota) || 10)),
        updatedAt: serverTimestamp(),
      });
      setEditingUid(null);
      setSavedMsg('อัปเดตสิทธิ์และสิทธิวันลาบุคลากรเรียบร้อยแล้ว');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `staff_directory/${uid}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Own Isolated PII Form */}
        <form
          onSubmit={handleSavePrivatePII}
          className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4"
        >
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                ข้อมูลส่วนบุคคลและการเชื่อมต่อ Telegram
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                จัดเก็บแยกเฉพาะเจ้าของบัญชี ผู้ตรวจสอบ และผู้ดูแลระบบ
              </p>
            </div>
            <Lock className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                หมายเลขโทรศัพท์ติดต่อ
              </label>
              <input
                type="tel"
                maxLength={MAX_LENGTHS.phone}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl tabular-nums"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                ที่อยู่ติดต่อระหว่างลา
              </label>
              <input
                type="text"
                maxLength={MAX_LENGTHS.contactAddress}
                value={contactAddress}
                onChange={(e) => setContactAddress(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">อายุ (ปี)</label>
                <input
                  type="number"
                  min={18}
                  max={90}
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">บรรจุเมื่อ</label>
                <input
                  type="text"
                  maxLength={40}
                  value={hireDate}
                  onChange={(e) => setHireDate(e.target.value)}
                  placeholder="1 ตุลาคม 2562"
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Telegram Chat ID (สำหรับรับการแจ้งเตือนผ่านบอทอัตโนมัติ)
              </label>
              <input
                type="text"
                maxLength={MAX_LENGTHS.telegramChatId}
                value={telegramChatId}
                onChange={(e) => setTelegramChatId(e.target.value)}
                placeholder="เช่น 123456789 หรือ -1001234567890 (ถ้ามี)"
                className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl font-mono-tabular"
              />
            </div>
          </div>

          {savedMsg && (
            <div className="flex items-center gap-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{savedMsg}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={savingPrivate}
            className="w-full min-h-[44px] px-4 py-2 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-medium rounded-xl inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>{savingPrivate ? 'กำลังบันทึก...' : 'บันทึกข้อมูลส่วนบุคคล'}</span>
          </button>
        </form>

        {/* Organizational Directory & Role RBAC */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                ทำเนียบบุคลากรและสิทธิวันลา ({staffList.length} คน)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {isAdmin
                  ? 'ผู้ดูแลระบบสามารถกำหนดบทบาท (ผู้ตรวจสอบ / ผู้อนุมัติ) และวันลาสะสมของบุคลากรได้'
                  : 'แสดงข้อมูลตำแหน่ง หน่วยงาน และวันลาคงเหลือ (ไม่เปิดเผยเบอร์โทรหรือที่อยู่ส่วนตัว)'}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isAdmin && onOpenAdminPanel && (
                <button
                  type="button"
                  onClick={onOpenAdminPanel}
                  className="min-h-[38px] px-3 py-1.5 text-xs font-medium text-teal-800 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded-lg cursor-pointer"
                >
                  แก้ไขข้อมูลทั้งหมด / สำรองข้อมูล
                </button>
              )}
              <ShieldCheck className="w-5 h-5 text-teal-700 shrink-0" />
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {staffList.map((s) => {
              const isEditing = editingUid === s.uid;
              const remaining =
                s.accumulatedVacationDays + s.annualVacationQuota - s.usedVacationDays;
              return (
                <div key={s.uid} className="p-4 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{s.fullName}</p>
                      <p className="text-xs text-slate-500">
                        {s.position} · {s.department} · {ROLE_LABELS[s.role]}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-600 tabular-nums">
                        พักผ่อนคงเหลือ <strong className="text-teal-700">{remaining}</strong> วัน
                      </span>
                      {isAdmin && !isEditing && (
                        <button
                          type="button"
                          onClick={() => handleStartEditStaff(s)}
                          className="min-h-[38px] px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                        >
                          กำหนดสิทธิ์
                        </button>
                      )}
                    </div>
                  </div>

                  {isAdmin && isEditing && (
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                      <div>
                        <label className="block text-[11px] text-slate-600 mb-1">บทบาท</label>
                        <select
                          value={editRole}
                          onChange={(e) => setEditRole(e.target.value as StaffRole)}
                          className="w-full min-h-[40px] px-2 text-xs bg-white border border-slate-200 rounded-lg"
                        >
                          {(Object.keys(ROLE_LABELS) as StaffRole[]).map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-600 mb-1">หน่วยงาน</label>
                        <select
                          value={editDept}
                          onChange={(e) => setEditDept(e.target.value)}
                          className="w-full min-h-[40px] px-2 text-xs bg-white border border-slate-200 rounded-lg"
                        >
                          {activeDepartments.map((d) => (
                            <option key={d} value={d}>
                              {d}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-600 mb-1">สะสม (วัน)</label>
                        <input
                          type="number"
                          min={0}
                          max={60}
                          value={editAccDays}
                          onChange={(e) => setEditAccDays(e.target.value)}
                          className="w-full min-h-[40px] px-2 text-xs bg-white border border-slate-200 rounded-lg tabular-nums"
                        />
                      </div>
                      <div className="flex items-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleSaveAdminStaff(s.uid)}
                          className="flex-1 min-h-[40px] px-2 bg-teal-700 text-white text-xs font-medium rounded-lg cursor-pointer"
                        >
                          บันทึก
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingUid(null)}
                          className="min-h-[40px] px-2 bg-white border border-slate-200 text-xs rounded-lg cursor-pointer"
                        >
                          ยกเลิก
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
