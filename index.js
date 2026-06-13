const https = require('https');

const BOT_TOKEN = '8965677289:AAHjoNscXXs64kFedF8F1KqwjpeqCIiWi_M';
const CHAT_ID   = '8959251221';
const SHEET_ID  = '1f0v6D6ue9iUp5VLMcyiFvY5EpNIpMKWLcS0M53rVeMs';
const APP_URL   = 'https://belenvllnd07-lab.github.io/mis-tareas/task-manager.html';

const state = {};

// ── HTTP HELPERS ─────────────────────────────────────────
function httpsPost(hostname, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname, path, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      }
    }, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch(e) { resolve({}); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpsGet(hostname, path, token) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname, path, method: 'GET',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    }, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch(e) { resolve({}); } });
    });
    req.on('error', reject);
    req.end();
  });
}

// ── TELEGRAM ─────────────────────────────────────────────
function tgPost(path, body) {
  return httpsPost('api.telegram.org', `/bot${BOT_TOKEN}${path}`, body);
}

function sendMessage(chatId, text, extra = {}) {
  return tgPost('/sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown', ...extra });
}

function sendKeyboard(chatId, text, buttons) {
  return sendMessage(chatId, text, {
    reply_markup: { keyboard: buttons, resize_keyboard: true, one_time_keyboard: true }
  });
}

// ── SHEETS ───────────────────────────────────────────────
async function getSheetData() {
  const token = process.env.GOOGLE_TOKEN;
  if (!token) return [];
  const res = await httpsGet(
    'sheets.googleapis.com',
    `/v4/spreadsheets/${SHEET_ID}/values/Hoja%201!A2:J1000`,
    token
  );
  if (!res.values) return [];
  return res.values.map(row => ({
    id: row[0], nombre: row[1] || '', descripcion: row[2] || '',
    fecha: row[3] || '', hora: row[4] || '09:00',
    recurrencia: row[5] || 'ninguna', categoria: row[6] || '',
    completada: row[7] === 'true',
    subtareas: row[8] ? JSON.parse(row[8]) : [],
  }));
}

async function appendToSheet(row) {
  const token = process.env.GOOGLE_TOKEN;
  if (!token) return false;
  try {
    const r = await httpsPost(
      'sheets.googleapis.com',
      `/v4/spreadsheets/${SHEET_ID}/values/Hoja%201:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { values: [row] }, token
    );
    return !r.error;
  } catch(e) { return false; }
}

// ── DATE HELPERS ─────────────────────────────────────────
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('es-AR', { weekday:'short', day:'numeric', month:'short' });
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function nowHour() {
  return new Date().toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit', hour12: false });
}

function getWeekEnd() {
  const d = new Date(); d.setDate(d.getDate() + 7);
  return d.toISOString().split('T')[0];
}

// ── REMINDERS ────────────────────────────────────────────

// 1. Resumen diario a las 9am
async function sendDailySummary() {
  const tasks = await getSheetData();
  const today = todayStr();
  const weekEnd = getWeekEnd();

  const semana = tasks.filter(t => {
    if (t.completada) return false;
    return t.fecha >= today && t.fecha <= weekEnd;
  }).sort((a,b) => a.fecha.localeCompare(b.fecha));

  if (semana.length === 0) {
    await sendMessage(CHAT_ID, `📋 *Resumen semanal*\n\n¡No tenés tareas pendientes esta semana! 🎉`);
    return;
  }

  const porDia = {};
  semana.forEach(t => {
    if (!porDia[t.fecha]) porDia[t.fecha] = [];
    porDia[t.fecha].push(t);
  });

  let msg = `📋 *Resumen semanal* — ${new Date().toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long' })}\n\n`;
  for (const [fecha, tareas] of Object.entries(porDia)) {
    msg += `*${formatDate(fecha)}*\n`;
    tareas.forEach(t => { msg += `  • ${t.categoria} ${t.nombre}${t.hora ? ` 🕐 ${t.hora}` : ''}\n`; });
    msg += '\n';
  }
  msg += `_${semana.length} tarea${semana.length !== 1 ? 's' : ''} esta semana_`;
  await sendMessage(CHAT_ID, msg);
}

// 2. Recordatorios del día a la hora exacta
async function checkTaskReminders() {
  const tasks = await getSheetData();
  const today = todayStr();
  const now = nowHour();

  const toRemind = tasks.filter(t => {
    if (t.completada) return false;
    if (t.fecha !== today) return false;
    if (!t.hora) return false;
    return t.hora === now;
  });

  for (const task of toRemind) {
    await sendMessage(CHAT_ID,
      `🔔 *Recordatorio*\n\n${task.categoria} *${task.nombre}*\n📅 ${formatDate(task.fecha)} 🕐 ${task.hora}${task.recurrencia !== 'ninguna' ? `\n🔁 ${task.recurrencia}` : ''}\n\n_Abrí la app para marcarla como hecha o aplazarla._`
    );
  }
}

// ── SCHEDULER ────────────────────────────────────────────
let lastDailyDate = '';
let lastMinuteCheck = '';

function startScheduler() {
  setInterval(async () => {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit', hour12: false });

    // Resumen diario a las 09:00
    if (timeStr === '09:00' && lastDailyDate !== dateStr) {
      lastDailyDate = dateStr;
      console.log('Enviando resumen diario...');
      await sendDailySummary().catch(e => console.error('Daily error:', e));
    }

    // Recordatorios por hora cada minuto
    if (timeStr !== lastMinuteCheck) {
      lastMinuteCheck = timeStr;
      await checkTaskReminders().catch(e => console.error('Reminder error:', e));
    }

  }, 60 * 1000); // cada 60 segundos
  console.log('⏰ Scheduler iniciado');
}

// ── BOT HANDLER ──────────────────────────────────────────
async function handleMessage(msg) {
  const chatId = msg.chat.id.toString();
  const text = (msg.text || '').trim();

  if (text === '/start') {
    state[chatId] = null;
    return sendKeyboard(chatId,
      `👋 Hola! Soy tu asistente de tareas.\n\n¿Qué querés hacer?`,
      [['➕ Nueva tarea', '📋 Ver app'], ['❓ Ayuda']]
    );
  }

  if (text === '❓ Ayuda' || text === '/ayuda') {
    return sendMessage(chatId,
      `*Comandos:*\n\n➕ *Nueva tarea* — Crear tarea\n📋 *Ver app* — Abrir la app\n\nRecibís automáticamente:\n🌅 Resumen semanal todos los días a las 9am\n🔔 Recordatorio a la hora de cada tarea`
    );
  }

  if (text === '📋 Ver app' || text === '/app') {
    return sendMessage(chatId, `📱 Abrí tu app:\n${APP_URL}`);
  }

  if (text === '➕ Nueva tarea' || text === '/nueva') {
    state[chatId] = { step: 'nombre' };
    return sendMessage(chatId, `📝 *Nueva tarea*\n\n¿Cuál es el nombre?`);
  }

  if (state[chatId]) {
    const s = state[chatId];

    if (s.step === 'nombre') {
      s.nombre = text; s.step = 'fecha';
      return sendKeyboard(chatId, `📅 ¿Para cuándo es *"${text}"*?`,
        [['Hoy', 'Mañana'], ['En 3 días', 'En 1 semana'], ['Otra fecha']]
      );
    }

    if (s.step === 'fecha' || s.step === 'fecha_manual') {
      const today = new Date();
      let fecha;
      if (text === 'Hoy') { fecha = today.toISOString().split('T')[0]; }
      else if (text === 'Mañana') { today.setDate(today.getDate()+1); fecha = today.toISOString().split('T')[0]; }
      else if (text === 'En 3 días') { today.setDate(today.getDate()+3); fecha = today.toISOString().split('T')[0]; }
      else if (text === 'En 1 semana') { today.setDate(today.getDate()+7); fecha = today.toISOString().split('T')[0]; }
      else if (text === 'Otra fecha') { s.step = 'fecha_manual'; return sendMessage(chatId, `📅 Escribí la fecha en formato *DD/MM/AAAA*:`); }
      else {
        const p = text.split('/');
        if (p.length === 3) { fecha = `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`; }
        else return sendMessage(chatId, `❌ Formato incorrecto. Usá DD/MM/AAAA`);
      }
      s.fecha = fecha; s.step = 'hora';
      return sendKeyboard(chatId, `🕐 ¿A qué hora querés el recordatorio?`,
        [['08:00', '09:00'], ['10:00', '12:00'], ['15:00', '18:00'], ['20:00', 'Otra hora']]
      );
    }

    if (s.step === 'hora' || s.step === 'hora_manual') {
      let hora;
      if (text === 'Otra hora') { s.step = 'hora_manual'; return sendMessage(chatId, `🕐 Escribí la hora en formato *HH:MM*:`); }
      else if (/^\d{2}:\d{2}$/.test(text)) { hora = text; }
      else { return sendMessage(chatId, `❌ Formato incorrecto. Usá HH:MM (ej: 09:30)`); }
      s.hora = hora; s.step = 'recurrencia';
      return sendKeyboard(chatId, `🔁 ¿Se repite?`,
        [['Una vez', 'Diaria'], ['Semanal', 'Quincenal'], ['Mensual', 'Anual']]
      );
    }

    if (s.step === 'recurrencia') {
      const recMap = { 'Una vez':'ninguna','Diaria':'diaria','Semanal':'semanal','Quincenal':'quincenal','Mensual':'mensual','Anual':'anual' };
      s.recurrencia = recMap[text] || 'ninguna'; s.step = 'categoria';
      return sendKeyboard(chatId, `📂 ¿Categoría?`,
        [['💰 Pagos', '🏥 Salud'], ['🏠 Hogar', '💼 Trabajo'], ['📞 Llamadas', '📋 General']]
      );
    }

    if (s.step === 'categoria') {
      s.categoria = text;
      const id = Date.now().toString();
      const row = [id, s.nombre, '', s.fecha, s.hora, s.recurrencia, s.categoria, 'false', '[]', new Date().toISOString()];
      const saved = await appendToSheet(row);
      state[chatId] = null;
      return sendKeyboard(chatId,
        `✅ *Tarea guardada!*\n\n📋 *${s.nombre}*\n📅 ${formatDate(s.fecha)} 🕐 ${s.hora}\n🔁 ${s.recurrencia}\n${s.categoria}\n\n${saved ? '✓ Sincronizada en Google Sheets\n🔔 Te voy a avisar el día y hora indicados' : '⚠️ No se pudo sincronizar con Sheets'}`,
        [['➕ Nueva tarea', '📋 Ver app']]
      );
    }
  }

  return sendKeyboard(chatId, `No entendí. ¿Qué querés hacer?`,
    [['➕ Nueva tarea', '📋 Ver app'], ['❓ Ayuda']]
  );
}

// ── POLLING ──────────────────────────────────────────────
let offset = 0;
async function poll() {
  try {
    const res = await tgPost('/getUpdates', { offset, timeout: 30 });
    if (res.result && res.result.length > 0) {
      for (const update of res.result) {
        offset = update.update_id + 1;
        if (update.message) await handleMessage(update.message).catch(e => console.error(e));
      }
    }
  } catch(e) {
    console.error('Poll error:', e.message);
    await new Promise(r => setTimeout(r, 5000));
  }
  poll();
}

console.log('🤖 Bot iniciado con recordatorios automáticos...');
startScheduler();
poll();
