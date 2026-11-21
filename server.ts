import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface FirebaseConfigFile {
  apiKey?: string;
  projectId?: string;
}

let firebaseApiKey = '';
try {
  const cfgPath = path.resolve(__dirname, 'firebase-applet-config.json');
  if (fs.existsSync(cfgPath)) {
    const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as FirebaseConfigFile;
    firebaseApiKey = parsed.apiKey ?? '';
  }
} catch {
  firebaseApiKey = '';
}

const SIGNING_SECRET =
  process.env.TELEGRAM_WEBHOOK_SECRET && process.env.TELEGRAM_WEBHOOK_SECRET.trim().length > 0
    ? process.env.TELEGRAM_WEBHOOK_SECRET.trim()
    : crypto.randomBytes(32).toString('hex');

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

interface AuthedUser {
  uid: string;
  email: string;
  emailVerified: boolean;
}

interface AuthedRequest extends Request {
  authUser?: AuthedUser;
}

async function verifyFirebaseIdToken(idToken: string): Promise<AuthedUser | null> {
  if (!firebaseApiKey || !idToken || idToken.length > 4096) {
    return null;
  }
  try {
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseApiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!resp.ok) {
      return null;
    }
    const data = (await resp.json()) as {
      users?: Array<{ localId?: string; email?: string; emailVerified?: boolean }>;
    };
    const user = data.users?.[0];
    if (!user?.localId || !user.email || user.emailVerified !== true) {
      return null;
    }
    return {
      uid: user.localId,
      email: user.email,
      emailVerified: true,
    };
  } catch {
    return null;
  }
}

async function requireFirebaseAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'กรุณาเข้าสู่ระบบด้วยบัญชีกูเกิลที่ยืนยันแล้วก่อนใช้งาน' });
    return;
  }
  const token = authHeader.slice(7).trim();
  const user = await verifyFirebaseIdToken(token);
  if (!user) {
    res.status(401).json({ error: 'สิทธิ์การเข้าใช้งานหมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่' });
    return;
  }
  req.authUser = user;
  next();
}

function signActionToken(requestId: string): string {
  const exp = Date.now() + 72 * 60 * 60 * 1000;
  const payload = `${requestId}.${exp}`;
  const sig = crypto.createHmac('sha256', SIGNING_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyActionToken(token: string, expectedRequestId: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return false;
  }
  const [reqId, expStr, sig] = parts;
  if (reqId !== expectedRequestId) {
    return false;
  }
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) {
    return false;
  }
  const expectedSig = crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(`${reqId}.${expStr}`)
    .digest('hex');
  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

function sanitizeShortText(val: unknown, maxLen: number): string {
  if (typeof val !== 'string') {
    return '';
  }
  return val.trim().slice(0, maxLen);
}

function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

  // Telegram Bot Webhook (verifies X-Telegram-Bot-Api-Secret-Token via timingSafeEqual)
  app.post('/api/telegram/webhook', (req: Request, res: Response) => {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
    if (!secret) {
      res.status(503).json({ error: 'TELEGRAM_WEBHOOK_SECRET is not configured on the server.' });
      return;
    }
    const headerToken = req.header('x-telegram-bot-api-secret-token') ?? '';
    const hdrBuf = Buffer.from(headerToken, 'utf8');
    const secBuf = Buffer.from(secret, 'utf8');
    if (hdrBuf.length !== secBuf.length || !crypto.timingSafeEqual(hdrBuf, secBuf)) {
      res.status(403).json({ error: 'Invalid Telegram secret token' });
      return;
    }
    res.status(200).json({ ok: true });
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      telegramBotConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    });
  });

  // AI Smart Leave Assistant (Gemini 4 Hydrogen)
  app.post('/api/ai/leave-assistant', requireFirebaseAuth, async (req: AuthedRequest, res: Response) => {
    if (!process.env.GEMINI_API_KEY) {
      res.status(503).json({
        error: 'ยังไม่ได้ตั้งค่า GEMINI_API_KEY ใน Settings > Secrets ของระบบ',
      });
      return;
    }

    const prompt = sanitizeShortText(req.body?.prompt, 1200);
    const staffContext = req.body?.staffContext ?? {};
    const todayIso = new Date().toISOString().slice(0, 10);

    if (!prompt) {
      res.status(400).json({ error: 'กรุณาระบุข้อความที่ต้องการให้ AI ช่วยวิเคราะห์หรือกรอกใบลา' });
      return;
    }

    try {
      const staffSummary = JSON.stringify({
        fullName: sanitizeShortText(staffContext.fullName, 120),
        position: sanitizeShortText(staffContext.position, 120),
        department: sanitizeShortText(staffContext.department, 120),
        employmentType: sanitizeShortText(staffContext.employmentType, 60),
        accumulatedVacationDays: Number(staffContext.accumulatedVacationDays ?? 0),
        annualVacationQuota: Number(staffContext.annualVacationQuota ?? 10),
        usedVacationDays: Number(staffContext.usedVacationDays ?? 0),
        usedSickDays: Number(staffContext.usedSickDays ?? 0),
        usedPersonalDays: Number(staffContext.usedPersonalDays ?? 0),
        colleagues: Array.isArray(staffContext.colleagues)
          ? staffContext.colleagues.slice(0, 30).map((c: unknown) => sanitizeShortText(c, 80))
          : [],
      });

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `วันที่ปัจจุบัน: ${todayIso}\nข้อมูลบุคลากร: ${staffSummary}\nคำขอของผู้ใช้งาน: "${prompt}"`,
        config: {
          systemInstruction:
            'คุณคือ AI ผู้ช่วยอัจฉริยะด้านงานสารบรรณและระเบียบการลาของสำนักงานสาธารณสุขอำเภอดอนพุด จังหวัดสระบุรี (อ้างอิงระเบียบสำนักนายกรัฐมนตรีว่าด้วยการลาของข้าราชการ พ.ศ. 2555) จงตอบเป็นภาษาไทยที่สุภาพ กระชับ และแม่นยำ หากผู้ใช้ระบุความต้องการลาหรือเดินทาง ให้สกัดข้อมูลลงฟิลด์ JSON เพื่อกรอกแบบฟอร์มอัตโนมัติ (แปลง พ.ศ. เป็น ค.ศ. รูปแบบ YYYY-MM-DD หากผู้ใช้อ้างอิง พ.ศ. เช่น 2569 -> 2026, 2570 -> 2027) หากเป็นคำถามระเบียบการลา ให้ตอบใน assistantReply และ policyNotes โดยไม่ต้องเปลี่ยนวันที่หากไม่ได้ขอลา',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              shouldFillForm: { type: Type.BOOLEAN },
              leaveType: {
                type: Type.STRING,
                description: 'One of: vacation, sick, personal, maternity, ordination, overseas, other, or empty string',
              },
              startDate: { type: Type.STRING, description: 'YYYY-MM-DD or empty string' },
              endDate: { type: Type.STRING, description: 'YYYY-MM-DD or empty string' },
              reason: { type: Type.STRING },
              contactAddress: { type: Type.STRING },
              contactPhone: { type: Type.STRING },
              substituteName: { type: Type.STRING },
              overseasCountry: { type: Type.STRING },
              overseasPurpose: { type: Type.STRING },
              assistantReply: { type: Type.STRING },
              policyNotes: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: ['shouldFillForm', 'assistantReply', 'policyNotes'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json(parsed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'ไม่สามารถเชื่อมต่อ AI ได้ในขณะนี้';
      res.status(502).json({ error: `AI ขัดข้องชั่วคราว: ${msg}` });
    }
  });

  // AI Executive Insights (Gemini 4 Hydrogen)
  app.post('/api/ai/executive-insights', requireFirebaseAuth, async (req: AuthedRequest, res: Response) => {
    if (!process.env.GEMINI_API_KEY) {
      res.status(503).json({
        error: 'ยังไม่ได้ตั้งค่า GEMINI_API_KEY ใน Settings > Secrets ของระบบ',
      });
      return;
    }

    const summaryStats = req.body?.summaryStats;
    if (!summaryStats || typeof summaryStats !== 'object') {
      res.status(400).json({ error: 'ข้อมูลสถิติไม่ครบถ้วน' });
      return;
    }

    try {
      const serialized = JSON.stringify(summaryStats).slice(0, 6000);
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `ข้อมูลสถิติการลาแบบไม่ระบุตัวตนเชิงลึก (Aggregated Statistics) ของสำนักงานสาธารณสุขอำเภอดอนพุดและ รพ.สต. ในสังกัด:\n${serialized}`,
        config: {
          systemInstruction:
            'คุณคือผู้ช่วยวิเคราะห์ข้อมูลสำหรับผู้บริหาร (สาธารณสุขอำเภอดอนพุด จังหวัดสระบุรี) สรุปภาพรวมสถิติการลา ความเสี่ยงด้านอัตรากำลังแทนกัน และข้อเสนอแนะเชิงบริหารเป็นภาษาไทยระดับผู้บริหารราชการ กระชับ ชัดเจน เป็นรูปธรรม',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              headline: { type: Type.STRING },
              executiveSummary: { type: Type.STRING },
              highlights: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              recommendations: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: ['headline', 'executiveSummary', 'highlights', 'recommendations'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json(parsed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'ไม่สามารถวิเคราะห์สถิติได้ในขณะนี้';
      res.status(502).json({ error: `การวิเคราะห์ AI ขัดข้อง: ${msg}` });
    }
  });

  // Telegram Real-Time Approval Notification Dispatcher
  app.post('/api/telegram/notify-approval', requireFirebaseAuth, async (req: AuthedRequest, res: Response) => {
    const requestId = sanitizeShortText(req.body?.requestId, 128);
    if (!requestId || !/^[a-zA-Z0-9_\-]+$/.test(requestId)) {
      res.status(400).json({ error: 'รหัสใบลาไม่ถูกต้อง' });
      return;
    }

    const requesterName = sanitizeShortText(req.body?.requesterName, 120);
    const requesterPosition = sanitizeShortText(req.body?.requesterPosition, 120);
    const department = sanitizeShortText(req.body?.department, 120);
    const leaveTypeLabel = sanitizeShortText(req.body?.leaveTypeLabel, 80);
    const startDateTh = sanitizeShortText(req.body?.startDateTh, 60);
    const endDateTh = sanitizeShortText(req.body?.endDateTh, 60);
    const workingDays = Number(req.body?.workingDays ?? 0);
    const substituteName = sanitizeShortText(req.body?.substituteName, 120) || 'ไม่ได้ระบุ';
    const recipientRole = sanitizeShortText(req.body?.recipientRole, 32) || 'supervisor';
    const requestedChatId = sanitizeShortText(req.body?.recipientTelegramChatId, 64);
    const targetChatId = requestedChatId || sanitizeShortText(process.env.TELEGRAM_DEFAULT_CHAT_ID, 64);

    const origin =
      process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL'
        ? process.env.APP_URL.replace(/\/$/, '')
        : `${req.protocol}://${req.get('host')}`;

    const actionToken = signActionToken(requestId);
    const approvalUrl = `${origin}/?approveRequestId=${encodeURIComponent(requestId)}&actionToken=${encodeURIComponent(actionToken)}`;

    const stageLabel =
      recipientRole === 'verifier'
        ? 'รอผู้ตรวจสอบรับรองสถิติการลา'
        : 'รอผู้บังคับบัญชาพิจารณาอนุมัติ';

    const summaryText =
      `[สสอ.ดอนพุด] แจ้งเตือนคำขออนุมัติการลา\n` +
      `สถานะ: ${stageLabel}\n` +
      `ผู้ขอลา: ${requesterName} (${requesterPosition})\n` +
      `สังกัด: ${department}\n` +
      `ประเภท: ${leaveTypeLabel} (${workingDays} วันทำการ)\n` +
      `วันที่: ${startDateTh} ถึง ${endDateTh}\n` +
      `ผู้ปฏิบัติงานแทน: ${substituteName}`;

    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(approvalUrl)}&text=${encodeURIComponent(summaryText)}`;

    const htmlMessage =
      `<b>สสอ.ดอนพุด · แจ้งเตือนคำขออนุมัติการลา</b>\n` +
      `<i>${escapeTelegramHtml(stageLabel)}</i>\n\n` +
      `<b>ผู้ขอลา:</b> ${escapeTelegramHtml(requesterName)}\n` +
      `<b>ตำแหน่ง/สังกัด:</b> ${escapeTelegramHtml(requesterPosition)} · ${escapeTelegramHtml(department)}\n` +
      `<b>ประเภท:</b> ${escapeTelegramHtml(leaveTypeLabel)}\n` +
      `<b>ระยะเวลา:</b> ${escapeTelegramHtml(startDateTh)} – ${escapeTelegramHtml(endDateTh)} (<b>${workingDays} วันทำการ</b>)\n` +
      `<b>ผู้รับมอบงานแทน:</b> ${escapeTelegramHtml(substituteName)}`;

    const telegramPayload = {
      chat_id: targetChatId || '<TELEGRAM_CHAT_ID>',
      text: htmlMessage,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'เปิดพิจารณาอนุมัติทันที',
              url: approvalUrl,
            },
          ],
        ],
      },
    };

    const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const validChatId = /^-?\d{5,20}$|^@[a-zA-Z0-9_]{5,32}$/.test(targetChatId);

    if (botToken && validChatId) {
      try {
        const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(telegramPayload),
        });

        if (tgRes.ok) {
          res.json({
            delivered: true,
            channelMode: 'telegram_bot_api',
            approvalUrl,
            shareUrl,
            telegramPayload,
            summaryText,
          });
          return;
        }
        const errText = await tgRes.text();
        res.status(200).json({
          delivered: false,
          channelMode: 'telegram_share',
          warning: `Telegram Bot API ส่งไม่สำเร็จ (${tgRes.status}): ${errText.slice(0, 120)}`,
          approvalUrl,
          shareUrl,
          telegramPayload,
          summaryText,
        });
        return;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Network error';
        res.status(200).json({
          delivered: false,
          channelMode: 'telegram_share',
          warning: `Telegram Bot API เชื่อมต่อไม่ได้: ${errMsg}`,
          approvalUrl,
          shareUrl,
          telegramPayload,
          summaryText,
        });
        return;
      }
    }

    res.json({
      delivered: false,
      channelMode: 'telegram_share',
      approvalUrl,
      shareUrl,
      telegramPayload,
      summaryText,
    });
  });

  app.post('/api/telegram/verify-action-token', requireFirebaseAuth, (req: AuthedRequest, res: Response) => {
    const requestId = sanitizeShortText(req.body?.requestId, 128);
    const token = sanitizeShortText(req.body?.actionToken, 256);
    if (!requestId || !token) {
      res.status(400).json({ valid: false });
      return;
    }
    const valid = verifyActionToken(token, requestId);
    res.json({ valid });
  });

  // Vite dev middleware or production static build
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Don Phut DPHO Leave System running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
