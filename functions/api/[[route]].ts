import firebaseConfig from '../../firebase-applet-config.json';

export interface EdgeEnv {
  GEMINI_API_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_DEFAULT_CHAT_ID?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  ACTION_TOKEN_SECRET?: string;
  APP_URL?: string;
  FIREBASE_API_KEY?: string;
}

type Env = EdgeEnv;

interface PagesContext {
  request: Request;
  env: Env;
  params: {
    route?: string | string[];
  };
}

interface AuthedUser {
  uid: string;
  email: string;
  emailVerified: boolean;
}

let ephemeralFallbackSecret: string | null = null;

function getEphemeralSecret(): string {
  if (!ephemeralFallbackSecret) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    ephemeralFallbackSecret = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return ephemeralFallbackSecret;
}

function getSigningSecret(env: Env): string {
  const configured = env.ACTION_TOKEN_SECRET?.trim() || env.TELEGRAM_WEBHOOK_SECRET?.trim();
  return configured && configured.length > 0 ? configured : getEphemeralSecret();
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBuf = enc.encode(a);
  const bBuf = enc.encode(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < aBuf.length; i++) {
    diff |= aBuf[i] ^ bBuf[i];
  }
  return diff === 0;
}

async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function signActionToken(requestId: string, secret: string): Promise<string> {
  const exp = Date.now() + 72 * 60 * 60 * 1000;
  const payload = `${requestId}.${exp}`;
  const sig = await hmacSha256Hex(secret, payload);
  return `${payload}.${sig}`;
}

async function verifyActionToken(
  token: string,
  expectedRequestId: string,
  secret: string
): Promise<boolean> {
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
  const expectedSig = await hmacSha256Hex(secret, `${reqId}.${expStr}`);
  return timingSafeEqualStr(sig, expectedSig);
}

function sanitizeShortText(val: unknown, maxLen: number): string {
  if (typeof val !== 'string') {
    return '';
  }
  return val.trim().slice(0, maxLen);
}

function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > 1_048_576) {
    return null;
  }
  const raw = await request.text();
  if (raw.length > 1_048_576) {
    return null;
  }
  if (!raw.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function verifyFirebaseIdToken(
  idToken: string,
  firebaseApiKey: string
): Promise<AuthedUser | null> {
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

async function requireFirebaseAuth(
  request: Request,
  env: Env
): Promise<{ user: AuthedUser } | { response: Response }> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      response: jsonResponse(
        { error: 'กรุณาเข้าสู่ระบบด้วยบัญชีกูเกิลที่ยืนยันแล้วก่อนใช้งาน' },
        401
      ),
    };
  }
  const token = authHeader.slice(7).trim();
  const firebaseApiKey = env.FIREBASE_API_KEY?.trim() || firebaseConfig.apiKey || '';
  const user = await verifyFirebaseIdToken(token, firebaseApiKey);
  if (!user) {
    return {
      response: jsonResponse(
        { error: 'สิทธิ์การเข้าใช้งานหมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่' },
        401
      ),
    };
  }
  return { user };
}

async function callGeminiStructured(
  apiKey: string,
  systemInstruction: string,
  userPrompt: string,
  responseSchema: Record<string, unknown>
): Promise<unknown> {
  const resp = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
        'User-Agent': 'aistudio-build',
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemInstruction }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema,
        },
      }),
    }
  );

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini API (${resp.status}): ${errText.slice(0, 200)}`);
  }

  const data = (await resp.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  return JSON.parse(text.trim());
}

export async function onRequest(context: PagesContext): Promise<Response> {
  return handleApiRequest(context.request, context.env);
}

export async function handleApiRequest(request: Request, env: EdgeEnv): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (method === 'GET' && path === '/api/health') {
    return jsonResponse({
      ok: true,
      runtime: 'cloudflare-edge',
      telegramBotConfigured: Boolean(env.TELEGRAM_BOT_TOKEN),
      geminiConfigured: Boolean(env.GEMINI_API_KEY),
    });
  }

  if (method === 'POST' && path === '/api/telegram/webhook') {
    const secret = env.TELEGRAM_WEBHOOK_SECRET?.trim();
    if (!secret) {
      return jsonResponse(
        { error: 'TELEGRAM_WEBHOOK_SECRET is not configured on the server.' },
        503
      );
    }
    const headerToken = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
    if (!timingSafeEqualStr(headerToken, secret)) {
      return jsonResponse({ error: 'Invalid Telegram secret token' }, 403);
    }
    return jsonResponse({ ok: true });
  }

  if (method === 'POST' && path === '/api/ai/leave-assistant') {
    const authResult = await requireFirebaseAuth(request, env);
    if ('response' in authResult) {
      return authResult.response;
    }

    const geminiKey = env.GEMINI_API_KEY?.trim();
    if (!geminiKey) {
      return jsonResponse(
        { error: 'ยังไม่ได้ตั้งค่า GEMINI_API_KEY ใน Environment Variables ของ Cloudflare Pages' },
        503
      );
    }

    const body = await readJsonBody(request);
    if (!body) {
      return jsonResponse({ error: 'รูปแบบข้อมูลไม่ถูกต้องหรือขนาดเกินกำหนด' }, 400);
    }

    const prompt = sanitizeShortText(body.prompt, 1200);
    const staffContext =
      body.staffContext && typeof body.staffContext === 'object' && !Array.isArray(body.staffContext)
        ? (body.staffContext as Record<string, unknown>)
        : {};
    const todayIso = new Date().toISOString().slice(0, 10);

    if (!prompt) {
      return jsonResponse(
        { error: 'กรุณาระบุข้อความที่ต้องการให้ AI ช่วยวิเคราะห์หรือกรอกใบลา' },
        400
      );
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

      const parsed = await callGeminiStructured(
        geminiKey,
        'คุณคือ AI ผู้ช่วยอัจฉริยะด้านงานสารบรรณและระเบียบการลาของสำนักงานสาธารณสุขอำเภอดอนพุด จังหวัดสระบุรี (อ้างอิงระเบียบสำนักนายกรัฐมนตรีว่าด้วยการลาของข้าราชการ พ.ศ. 2555) จงตอบเป็นภาษาไทยที่สุภาพ กระชับ และแม่นยำ หากผู้ใช้ระบุความต้องการลาหรือเดินทาง ให้สกัดข้อมูลลงฟิลด์ JSON เพื่อกรอกแบบฟอร์มอัตโนมัติ (แปลง พ.ศ. เป็น ค.ศ. รูปแบบ YYYY-MM-DD หากผู้ใช้อ้างอิง พ.ศ. เช่น 2569 -> 2026, 2570 -> 2027) หากเป็นคำถามระเบียบการลา ให้ตอบใน assistantReply และ policyNotes โดยไม่ต้องเปลี่ยนวันที่หากไม่ได้ขอลา',
        `วันที่ปัจจุบัน: ${todayIso}\nข้อมูลบุคลากร: ${staffSummary}\nคำขอของผู้ใช้งาน: "${prompt}"`,
        {
          type: 'OBJECT',
          properties: {
            shouldFillForm: { type: 'BOOLEAN' },
            leaveType: {
              type: 'STRING',
              description:
                'One of: vacation, sick, personal, maternity, ordination, overseas, other, or empty string',
            },
            startDate: { type: 'STRING', description: 'YYYY-MM-DD or empty string' },
            endDate: { type: 'STRING', description: 'YYYY-MM-DD or empty string' },
            reason: { type: 'STRING' },
            contactAddress: { type: 'STRING' },
            contactPhone: { type: 'STRING' },
            substituteName: { type: 'STRING' },
            overseasCountry: { type: 'STRING' },
            overseasPurpose: { type: 'STRING' },
            assistantReply: { type: 'STRING' },
            policyNotes: {
              type: 'ARRAY',
              items: { type: 'STRING' },
            },
          },
          required: ['shouldFillForm', 'assistantReply', 'policyNotes'],
        }
      );

      return jsonResponse(parsed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'ไม่สามารถเชื่อมต่อ AI ได้ในขณะนี้';
      return jsonResponse({ error: `AI ขัดข้องชั่วคราว: ${msg}` }, 502);
    }
  }

  if (method === 'POST' && path === '/api/ai/executive-insights') {
    const authResult = await requireFirebaseAuth(request, env);
    if ('response' in authResult) {
      return authResult.response;
    }

    const geminiKey = env.GEMINI_API_KEY?.trim();
    if (!geminiKey) {
      return jsonResponse(
        { error: 'ยังไม่ได้ตั้งค่า GEMINI_API_KEY ใน Environment Variables ของ Cloudflare Pages' },
        503
      );
    }

    const body = await readJsonBody(request);
    const summaryStats = body?.summaryStats;
    if (!summaryStats || typeof summaryStats !== 'object' || Array.isArray(summaryStats)) {
      return jsonResponse({ error: 'ข้อมูลสถิติไม่ครบถ้วน' }, 400);
    }

    try {
      const serialized = JSON.stringify(summaryStats).slice(0, 6000);
      const parsed = await callGeminiStructured(
        geminiKey,
        'คุณคือผู้ช่วยวิเคราะห์ข้อมูลสำหรับผู้บริหาร (สาธารณสุขอำเภอดอนพุด จังหวัดสระบุรี) สรุปภาพรวมสถิติการลา ความเสี่ยงด้านอัตรากำลังแทนกัน และข้อเสนอแนะเชิงบริหารเป็นภาษาไทยระดับผู้บริหารราชการ กระชับ ชัดเจน เป็นรูปธรรม',
        `ข้อมูลสถิติการลาแบบไม่ระบุตัวตนเชิงลึก (Aggregated Statistics) ของสำนักงานสาธารณสุขอำเภอดอนพุดและ รพ.สต. ในสังกัด:\n${serialized}`,
        {
          type: 'OBJECT',
          properties: {
            headline: { type: 'STRING' },
            executiveSummary: { type: 'STRING' },
            highlights: {
              type: 'ARRAY',
              items: { type: 'STRING' },
            },
            recommendations: {
              type: 'ARRAY',
              items: { type: 'STRING' },
            },
          },
          required: ['headline', 'executiveSummary', 'highlights', 'recommendations'],
        }
      );

      return jsonResponse(parsed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'ไม่สามารถวิเคราะห์สถิติได้ในขณะนี้';
      return jsonResponse({ error: `การวิเคราะห์ AI ขัดข้อง: ${msg}` }, 502);
    }
  }

  if (method === 'POST' && path === '/api/telegram/notify-approval') {
    const authResult = await requireFirebaseAuth(request, env);
    if ('response' in authResult) {
      return authResult.response;
    }

    const body = await readJsonBody(request);
    if (!body) {
      return jsonResponse({ error: 'รูปแบบข้อมูลไม่ถูกต้อง' }, 400);
    }

    const requestId = sanitizeShortText(body.requestId, 128);
    if (!requestId || !/^[a-zA-Z0-9_\-]+$/.test(requestId)) {
      return jsonResponse({ error: 'รหัสใบลาไม่ถูกต้อง' }, 400);
    }

    const requesterName = sanitizeShortText(body.requesterName, 120);
    const requesterPosition = sanitizeShortText(body.requesterPosition, 120);
    const department = sanitizeShortText(body.department, 120);
    const leaveTypeLabel = sanitizeShortText(body.leaveTypeLabel, 80);
    const startDateTh = sanitizeShortText(body.startDateTh, 60);
    const endDateTh = sanitizeShortText(body.endDateTh, 60);
    const rawWorkingDays = Number(body.workingDays ?? 0);
    const workingDays = Number.isFinite(rawWorkingDays) && rawWorkingDays >= 0 ? rawWorkingDays : 0;
    const substituteName = sanitizeShortText(body.substituteName, 120) || 'ไม่ได้ระบุ';
    const recipientRole = sanitizeShortText(body.recipientRole, 32) || 'supervisor';
    const requestedChatId = sanitizeShortText(body.recipientTelegramChatId, 64);
    const targetChatId =
      requestedChatId || sanitizeShortText(env.TELEGRAM_DEFAULT_CHAT_ID, 64);

    const origin =
      env.APP_URL && env.APP_URL !== 'MY_APP_URL'
        ? env.APP_URL.replace(/\/$/, '')
        : url.origin;

    const actionToken = await signActionToken(requestId, getSigningSecret(env));
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

    const botToken = env.TELEGRAM_BOT_TOKEN?.trim();
    const validChatId = /^-?\d{5,20}$|^@[a-zA-Z0-9_]{5,32}$/.test(targetChatId);

    if (botToken && validChatId) {
      try {
        const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(telegramPayload),
        });

        if (tgRes.ok) {
          return jsonResponse({
            delivered: true,
            channelMode: 'telegram_bot_api',
            approvalUrl,
            shareUrl,
            telegramPayload,
            summaryText,
          });
        }
        const errText = await tgRes.text();
        return jsonResponse({
          delivered: false,
          channelMode: 'telegram_share',
          warning: `Telegram Bot API ส่งไม่สำเร็จ (${tgRes.status}): ${errText.slice(0, 120)}`,
          approvalUrl,
          shareUrl,
          telegramPayload,
          summaryText,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Network error';
        return jsonResponse({
          delivered: false,
          channelMode: 'telegram_share',
          warning: `Telegram Bot API เชื่อมต่อไม่ได้: ${errMsg}`,
          approvalUrl,
          shareUrl,
          telegramPayload,
          summaryText,
        });
      }
    }

    return jsonResponse({
      delivered: false,
      channelMode: 'telegram_share',
      approvalUrl,
      shareUrl,
      telegramPayload,
      summaryText,
    });
  }

  if (method === 'POST' && path === '/api/telegram/verify-action-token') {
    const authResult = await requireFirebaseAuth(request, env);
    if ('response' in authResult) {
      return authResult.response;
    }

    const body = await readJsonBody(request);
    if (!body) {
      return jsonResponse({ valid: false }, 400);
    }

    const requestId = sanitizeShortText(body.requestId, 128);
    const token = sanitizeShortText(body.actionToken, 256);
    if (!requestId || !token) {
      return jsonResponse({ valid: false }, 400);
    }

    const valid = await verifyActionToken(token, requestId, getSigningSecret(env));
    return jsonResponse({ valid });
  }

  return jsonResponse({ error: 'API route not found' }, 404);
}
