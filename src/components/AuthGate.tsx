import React, { useState } from 'react';
import { signInWithPopup, signOut } from 'firebase/auth';
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { ShieldCheck, Lock, Smartphone, FileText, LogIn, LogOut } from 'lucide-react';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../lib/firebase';
import { DON_PHUT_DEPARTMENTS, MAX_LENGTHS } from '../types/leave';
import type { EmploymentType, StaffPublicProfile } from '../types/leave';

interface AuthGateProps {
  mode: 'login' | 'onboarding';
  userEmail?: string;
  userUid?: string;
  displayName?: string;
  onProfileCreated?: (profile: StaffPublicProfile) => void;
}

const EMPLOYMENT_TYPES: EmploymentType[] = [
  'ข้าราชการ',
  'พนักงานราชการ',
  'ลูกจ้างประจำ',
  'พนักงานกระทรวงสาธารณสุข',
  'ลูกจ้างชั่วคราว',
];

export const AuthGate: React.FC<AuthGateProps> = ({
  mode,
  userEmail,
  userUid,
  displayName,
  onProfileCreated,
}) => {
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState('');

  const [fullName, setFullName] = useState(displayName || '');
  const [position, setPosition] = useState('นักวิชาการสาธารณสุขปฏิบัติการ');
  const [department, setDepartment] = useState<string>(DON_PHUT_DEPARTMENTS[0]);
  const [employmentType, setEmploymentType] = useState<EmploymentType>('ข้าราชการ');
  const [phone, setPhone] = useState('');
  const [contactAddress, setContactAddress] = useState('');
  const [age, setAge] = useState('32');
  const [hireDate, setHireDate] = useState('1 ตุลาคม 2562');
  const [saving, setSaving] = useState(false);

  const handleGoogleLogin = async () => {
    setSigningIn(true);
    setAuthError('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'ไม่สามารถเข้าสู่ระบบได้';
      setAuthError(
        msg.includes('popup-closed')
          ? 'หน้าต่างเข้าสู่ระบบถูกปิดก่อนเสร็จสิ้น กรุณาลองใหม่อีกครั้ง'
          : `เข้าสู่ระบบไม่สำเร็จ: ${msg}`
      );
    } finally {
      setSigningIn(false);
    }
  };

  const handleCreateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userUid || !userEmail) return;

    const cleanName = fullName.trim().slice(0, MAX_LENGTHS.fullName);
    const cleanPos = position.trim().slice(0, MAX_LENGTHS.position);
    const cleanDept = department.trim().slice(0, MAX_LENGTHS.department);
    if (cleanName.length < 2 || cleanPos.length < 2) {
      setAuthError('กรุณากรอกชื่อ-นามสกุล และตำแหน่งให้ครบถ้วน');
      return;
    }

    setSaving(true);
    setAuthError('');
    const parsedAge = Math.min(90, Math.max(18, Math.round(Number(age) || 30)));

    const batch = writeBatch(db);
    const publicPayload: Omit<StaffPublicProfile, 'createdAt' | 'updatedAt'> & {
      createdAt: ReturnType<typeof serverTimestamp>;
      updatedAt: ReturnType<typeof serverTimestamp>;
    } = {
      uid: userUid,
      fullName: cleanName,
      position: cleanPos,
      department: cleanDept,
      employmentType,
      role: 'staff',
      accumulatedVacationDays: 10,
      annualVacationQuota: 10,
      usedVacationDays: 0,
      usedSickDays: 0,
      usedPersonalDays: 0,
      usedOtherDays: 0,
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    batch.set(doc(db, 'staff_directory', userUid), publicPayload);
    batch.set(doc(db, 'staff_private', userUid), {
      uid: userUid,
      email: userEmail.slice(0, 160),
      phone: phone.trim().slice(0, MAX_LENGTHS.phone),
      contactAddress: contactAddress.trim().slice(0, MAX_LENGTHS.contactAddress),
      age: parsedAge,
      hireDate: hireDate.trim().slice(0, 40),
      telegramChatId: '',
      updatedAt: serverTimestamp(),
    });

    try {
      await batch.commit();
      if (onProfileCreated) {
        onProfileCreated({
          ...publicPayload,
          createdAt: undefined,
          updatedAt: undefined,
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `staff_directory/${userUid}`);
    } finally {
      setSaving(false);
    }
  };

  if (mode === 'onboarding') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 sm:p-6">
        <div className="max-w-xl w-full bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-5">
            <div>
              <p className="text-xs font-medium text-teal-700">ลงทะเบียนบุคลากรครั้งแรก</p>
              <h1 className="text-xl font-semibold text-slate-900 mt-1">
                ข้อมูลทะเบียนประวัติบุคลากร สสอ.ดอนพุด
              </h1>
              <p className="text-sm text-slate-600 mt-1">
                เข้าสู่ระบบด้วยบัญชี {userEmail} · ข้อมูลติดต่อส่วนตัวถูกแยกจัดเก็บแบบจำกัดสิทธิ์
              </p>
            </div>
            <button
              type="button"
              onClick={() => signOut(auth)}
              className="min-h-[44px] px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-xl flex items-center gap-1.5 shrink-0"
            >
              <LogOut className="w-4 h-4" />
              ออก
            </button>
          </div>

          <form onSubmit={handleCreateProfile} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  ชื่อ-นามสกุล (พร้อมคำนำหน้า)
                </label>
                <input
                  type="text"
                  required
                  maxLength={MAX_LENGTHS.fullName}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="เช่น นางสาวรักดี ใจชื่น"
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">ตำแหน่ง</label>
                <input
                  type="text"
                  required
                  maxLength={MAX_LENGTHS.position}
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  หน่วยงานสังกัด
                </label>
                <select
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                >
                  {DON_PHUT_DEPARTMENTS.map((dept) => (
                    <option key={dept} value={dept}>
                      {dept}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  ประเภทบุคลากร
                </label>
                <select
                  value={employmentType}
                  onChange={(e) => setEmploymentType(e.target.value as EmploymentType)}
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                >
                  {EMPLOYMENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  หมายเลขโทรศัพท์ติดต่อ (ข้อมูลส่วนบุคคล)
                </label>
                <input
                  type="tel"
                  maxLength={MAX_LENGTHS.phone}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="08x-xxx-xxxx"
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  อายุ (ปี) สำหรับบัตรบันทึกการลา
                </label>
                <input
                  type="number"
                  min={18}
                  max={90}
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-600 tabular-nums"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  บรรจุเมื่อ (วัน เดือน ปี)
                </label>
                <input
                  type="text"
                  maxLength={40}
                  value={hireDate}
                  onChange={(e) => setHireDate(e.target.value)}
                  placeholder="1 ตุลาคม 2562"
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  ที่อยู่ติดต่อระหว่างลา (ข้อมูลส่วนบุคคล)
                </label>
                <input
                  type="text"
                  maxLength={MAX_LENGTHS.contactAddress}
                  value={contactAddress}
                  onChange={(e) => setContactAddress(e.target.value)}
                  placeholder="บ้านเลขที่ หมู่ ตำบล อำเภอดอนพุด จังหวัดสระบุรี"
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
            </div>

            {authError && (
              <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3.5 py-2.5">
                {authError}
              </p>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full min-h-[48px] bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-colors"
            >
              {saving ? 'กำลังบันทึกข้อมูลอย่างปลอดภัย...' : 'บันทึกทะเบียนบุคลากรและเข้าใช้งานระบบ'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between p-4 sm:p-8">
      <div className="max-w-5xl w-full mx-auto my-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        <div className="lg:col-span-7 flex flex-col justify-center space-y-6">
          <div className="space-y-3">
            <p className="text-xs font-medium text-teal-700">
              สำนักงานสาธารณสุขอำเภอดอนพุด · จังหวัดสระบุรี
            </p>
            <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight text-balance">
              ระบบบริหารจัดการการลาออนไลน์อัจฉริยะ สสอ.ดอนพุด
            </h1>
            <p className="text-base text-slate-600 leading-relaxed max-w-2xl">
              ยื่นใบลาด้วย AI ผู้ช่วยอัจฉริยะ แจ้งเตือนและอนุมัติแบบเรียลไทม์ผ่านแอปพลิเคชัน Telegram
              ติดตามสถิติบุคลากรบนแดชบอร์ดผู้บริหาร และพิมพ์แบบฟอร์มใบลา บัตรบันทึกการลา
              และบันทึกข้อความไปต่างประเทศเป็น PDF ได้โดยอัตโนมัติ
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1.5">
              <div className="flex items-center gap-2 text-teal-700">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span className="text-sm font-semibold text-slate-900">แยกเก็บข้อมูลส่วนบุคคล</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                เบอร์โทร ที่อยู่ และข้อมูลเฉพาะบุคคลถูกแยกจัดเก็บแบบจำกัดสิทธิ์เฉพาะเจ้าของและผู้ตรวจสอบ
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1.5">
              <div className="flex items-center gap-2 text-teal-700">
                <Smartphone className="w-4 h-4 shrink-0" />
                <span className="text-sm font-semibold text-slate-900">แจ้งเตือนอนุมัติผ่าน Telegram</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                ส่งข้อความแจ้งเตือนผ่าน Telegram Bot พร้อมปุ่มลิงก์ลงนามอนุมัติแบบเรียลไทม์ ใช้งานได้บนมือถือทุกรุ่น
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1.5">
              <div className="flex items-center gap-2 text-teal-700">
                <FileText className="w-4 h-4 shrink-0" />
                <span className="text-sm font-semibold text-slate-900">พิมพ์แบบฟอร์มราชการ PDF</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                รองรับแบบใบลาพักผ่อน บัตรบันทึกการลาข้าราชการ และบันทึกข้อความขออนุญาตไปต่างประเทศ
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1.5">
              <div className="flex items-center gap-2 text-teal-700">
                <Lock className="w-4 h-4 shrink-0" />
                <span className="text-sm font-semibold text-slate-900">ควบคุมสิทธิ์ตามตำแหน่งงาน</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                ตรวจสอบความถูกต้องทั้งระดับผู้ตรวจสอบสถิติ สาธารณสุขอำเภอ และผู้ดูแลระบบ
              </p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-5 flex items-center">
          <div className="w-full bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6">
            <div className="space-y-1.5">
              <h2 className="text-xl font-semibold text-slate-900">เข้าสู่ระบบบุคลากร</h2>
              <p className="text-sm text-slate-600">
                ยืนยันตัวตนด้วยบัญชี Google ที่ได้รับการรับรองอีเมลเพื่อเข้าถึงฐานข้อมูลการลา
              </p>
            </div>

            {authError && (
              <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">
                {authError}
              </div>
            )}

            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={signingIn}
              className="w-full min-h-[48px] px-4 py-3 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-medium rounded-xl flex items-center justify-center gap-2.5 transition-colors cursor-pointer"
            >
              <LogIn className="w-4 h-4 shrink-0" />
              <span>{signingIn ? 'กำลังตรวจสอบสิทธิ์...' : 'เข้าสู่ระบบด้วย Google'}</span>
            </button>

            <div className="border-t border-slate-100 pt-4 text-xs text-slate-500 space-y-1">
              <p>ครอบคลุมหน่วยงานในสังกัดอำเภอดอนพุด จังหวัดสระบุรี</p>
              <p>
                สสอ.ดอนพุด · รพ.สต.ดอนพุด · รพ.สต.ดงตะงาว · รพ.สต.ไผ่หลิ่ว · รพ.สต.บ้านหลวง · รพ.สต.บ้านรี · รพ.สต.บ้านหนองมน
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
