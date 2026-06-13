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

async function updateTaskSubtareas(taskId, subtareas) {
  const token = process.env.GOOGLE_TOKEN;
  if (!token) return false;
  try {
    // Get all rows to find the row number
    const res = await httpsGet(
      'sheets.googleapis.com',
      `/v4/spreadsheets/${SHEET_ID}/values/Hoja%201!A2:J1000`,
      token
    );
    if (!res.values) return false;
    const rowIndex = res.values.findIndex(row => row[0] === taskId);
    if (rowIndex === -1) return false;
    const sheetRow = rowIndex + 2; // +2 for header and 0-index
    const range = `Hoja%201!I${sheetRow}`;
    await httpsPost(
      'sheets.googleapis.com',
      `/v4/spreadsheets/${SHEET_ID}/values/${range}?valueInputOption=RAW`,
      { values: [[JSON.stringify(subtareas)]] },
      token
    );
    return true;
  } catch(e) { console.error('updateTaskSubtareas error:', e); return false; }
}

async function markTaskDone(taskId) {
  const token = process.env.GOOGLE_TOKEN;
  if (!token) return false;
  try {
    const res = await httpsGet('sheets.googleapis.com', `/v4/spreadsheets/${SHEET_ID}/values/Hoja%201!A2:J1000`, token);
    if (!res.values) return false;
    const rowIndex = res.values.findIndex(row => row[0] === taskId);
    if (rowIndex === -1) return false;
    const sheetRow = rowIndex + 2;
    await httpsPost('sheets.googleapis.com',
      `/v4/spreadsheets/${SHEET_ID}/values/Hoja%201!H${sheetRow}?valueInputOption=RAW`,
      { values: [['true']] }, token
    );
    return true;
  } catch(e) { return false; }
}

async function updateTaskFecha(taskId, fecha, hora) {
  const token = process.env.GOOGLE_TOKEN;
  if (!token) return false;
  try {
    const res = await httpsGet('sheets.googleapis.com', `/v4/spreadsheets/${SHEET_ID}/values/Hoja%201!A2:J1000`, token);
    if (!res.values) return false;
    const rowIndex = res.values.findIndex(row => row[0] === taskId);
    if (rowIndex === -1) return false;
    const sheetRow = rowIndex + 2;
    await httpsPost('sheets.googleapis.com',
      `/v4/spreadsheets/${SHEET_ID}/values/Hoja%201!D${sheetRow}:E${sheetRow}?valueInputOption=RAW`,
      { values: [[fecha, hora]] }, token
    );
    return true;
  } catch(e) { return false; }
}

// ── DATE HELPERS ─────────────────────────────────────────
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('es-AR', { weekday:'short', day:'numeric', month:'short' });
}

function arDate(offsetDays = 0) {
  const d = new Date();
  d.setHours(d.getHours() - 3); // UTC-3 Argentina
  if (offsetDays) d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split('T')[0];
}

function todayStr() {
  return arDate(0);
}

function nowHour() {
  const d = new Date();
  d.setHours(d.getHours() - 3);
  return d.toISOString().substr(11, 5);
}

function getWeekEnd() {
  return arDate(7);
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
    // Store pending reminder so user can act on it
    state[CHAT_ID] = state[CHAT_ID] || {};
    state[CHAT_ID].pendingReminder = { taskId: task.id, taskNombre: task.nombre };

    await sendMessage(CHAT_ID,
      `🔔 *Recordatorio*\n\n${task.categoria} *${task.nombre}*\n📅 ${formatDate(task.fecha)} 🕐 ${task.hora}${task.recurrencia !== 'ninguna' ? `\n🔁 ${task.recurrencia}` : ''}`,
      {
        reply_markup: {
          keyboard: [['✅ Marcar como hecha', '⏰ Aplazar']],
          resize_keyboard: true, one_time_keyboard: true
        }
      }
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

  // ── CONSULTAS DE TAREAS ─────────────────────────────────
  const textoLower = text.toLowerCase().trim();

  const esConsultaHoy = /(pendientes?|qué?\s+hay|que\s+hay|para\s+hoy|de\s+hoy|tareas?\s+hoy|hoy.*tarea|boti.*qué?|boti.*que)/.test(textoLower) && !/semana|próxima|proxima/.test(textoLower);

  const esConsultaSemana = /esta\s+semana|semana\s+(actual|esta)|para\s+la\s+semana/.test(textoLower);

  const esConsultaProxima = /próxima\s+semana|proxima\s+semana|semana\s+que\s+viene|semana\s+próxima/.test(textoLower);

  if (esConsultaProxima) {
    state[chatId] = null;
    const tasks = await getSheetData();
    const start = arDate(7);
    const end = arDate(14);
    const semana = tasks.filter(t => !t.completada && t.fecha >= start && t.fecha < end)
      .sort((a,b) => a.fecha.localeCompare(b.fecha));
    if (semana.length === 0) {
      return sendKeyboard(chatId, `📋 No tenés tareas para la próxima semana. ¡A descansar! 😊`, [['➕ Nueva tarea', '📋 Ver app']]);
    }
    const porDia = {};
    semana.forEach(t => { if (!porDia[t.fecha]) porDia[t.fecha] = []; porDia[t.fecha].push(t); });
    let msg = `📋 *Tareas de la próxima semana*\n\n`;
    for (const [fecha, tareas] of Object.entries(porDia)) {
      msg += `*${formatDate(fecha)}*\n`;
      tareas.forEach(t => { msg += `  • ${t.categoria} ${t.nombre}${t.hora ? ` 🕐 ${t.hora}` : ''}\n`; });
      msg += '\n';
    }
    msg += `_${semana.length} tarea${semana.length !== 1 ? 's' : ''} en total_`;
    return sendKeyboard(chatId, msg, [['➕ Nueva tarea', '📋 Ver app']]);
  }

  if (esConsultaSemana) {
    state[chatId] = null;
    const tasks = await getSheetData();
    const today = arDate(0);
    const end = arDate(7);
    const semana = tasks.filter(t => !t.completada && t.fecha >= today && t.fecha <= end)
      .sort((a,b) => a.fecha.localeCompare(b.fecha));
    if (semana.length === 0) {
      return sendKeyboard(chatId, `📋 No tenés tareas para esta semana. ¡Todo al día! 🎉`, [['➕ Nueva tarea', '📋 Ver app']]);
    }
    const porDia = {};
    semana.forEach(t => { if (!porDia[t.fecha]) porDia[t.fecha] = []; porDia[t.fecha].push(t); });
    let msg = `📋 *Tareas de esta semana*\n\n`;
    for (const [fecha, tareas] of Object.entries(porDia)) {
      msg += `*${formatDate(fecha)}*\n`;
      tareas.forEach(t => { msg += `  • ${t.categoria} ${t.nombre}${t.hora ? ` 🕐 ${t.hora}` : ''}\n`; });
      msg += '\n';
    }
    msg += `_${semana.length} tarea${semana.length !== 1 ? 's' : ''} en total_`;
    return sendKeyboard(chatId, msg, [['➕ Nueva tarea', '📋 Ver app']]);
  }

  if (esConsultaHoy) {
    state[chatId] = null;
    const tasks = await getSheetData();
    const today = arDate(0);
    const hoy = tasks.filter(t => !t.completada && t.fecha === today)
      .sort((a,b) => (a.hora || '').localeCompare(b.hora || ''));
    if (hoy.length === 0) {
      return sendKeyboard(chatId, `📋 ¡Todo al día Belén! No tenés nada pendiente para hoy 🎉`, [['➕ Nueva tarea', '📋 Ver app']]);
    }
    let msg = `📋 *Tareas de hoy*\n\n`;
    hoy.forEach(t => { msg += `• ${t.categoria} *${t.nombre}*${t.hora ? ` 🕐 ${t.hora}` : ''}
`; });
    msg += `
_${hoy.length} tarea${hoy.length !== 1 ? 's' : ''} pendiente${hoy.length !== 1 ? 's' : ''}_`;
    return sendKeyboard(chatId, msg, [['➕ Nueva tarea', '📋 Ver app']]);
  }

  // Handle reminder actions
  if (text === '✅ Marcar como hecha' && state[chatId] && state[chatId].pendingReminder) {
    const { taskId, taskNombre } = state[chatId].pendingReminder;
    delete state[chatId].pendingReminder;
    await markTaskDone(taskId);
    return sendKeyboard(chatId,
      `✅ *¡Bien hecho Belén!* "${taskNombre}" marcada como completada. 🎉`,
      [['➕ Nueva tarea', '📋 Ver app']]
    );
  }

  if (text === '⏰ Aplazar' && state[chatId] && state[chatId].pendingReminder) {
    state[chatId].step = 'aplazar_reminder';
    return sendKeyboard(chatId,
      `⏰ ¿Cuánto tiempo querés aplazarla?`,
      [['30 minutos', '1 hora'], ['2 horas', '4 horas'], ['Mañana', 'Otra fecha']]
    );
  }

  if (state[chatId] && state[chatId].step === 'aplazar_reminder' && state[chatId].pendingReminder) {
    const { taskId, taskNombre } = state[chatId].pendingReminder;
    let nuevaFecha, nuevaHora;
    const now = new Date(); now.setHours(now.getHours() - 3);

    if (text === '30 minutos') { now.setMinutes(now.getMinutes() + 30); }
    else if (text === '1 hora') { now.setHours(now.getHours() + 1); }
    else if (text === '2 horas') { now.setHours(now.getHours() + 2); }
    else if (text === '4 horas') { now.setHours(now.getHours() + 4); }
    else if (text === 'Mañana') { now.setDate(now.getDate() + 1); }
    else if (text === 'Otra fecha') {
      state[chatId].step = 'aplazar_fecha_manual';
      return sendMessage(chatId, `📅 Escribí la nueva fecha en formato *DD/MM/AAAA*:`);
    } else {
      // manual date input
      const p = text.split('/');
      if (p.length === 3) {
        nuevaFecha = `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
        nuevaHora = '09:00';
      } else {
        return sendMessage(chatId, `❌ Formato incorrecto. Usá DD/MM/AAAA`);
      }
    }

    if (!nuevaFecha) {
      nuevaFecha = now.toISOString().split('T')[0];
      nuevaHora = now.toISOString().substr(11, 5);
    }

    await updateTaskFecha(taskId, nuevaFecha, nuevaHora);
    delete state[chatId].pendingReminder;
    state[chatId].step = null;

    return sendKeyboard(chatId,
      `⏰ *"${taskNombre}"* aplazada para el ${formatDate(nuevaFecha)} a las ${nuevaHora} hs.`,
      [['➕ Nueva tarea', '📋 Ver app']]
    );
  }

  if (state[chatId] && state[chatId].step === 'aplazar_fecha_manual' && state[chatId].pendingReminder) {
    const { taskId, taskNombre } = state[chatId].pendingReminder;
    const p = text.split('/');
    if (p.length !== 3) return sendMessage(chatId, `❌ Formato incorrecto. Usá DD/MM/AAAA`);
    const nuevaFecha = `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
    await updateTaskFecha(taskId, nuevaFecha, '09:00');
    delete state[chatId].pendingReminder;
    state[chatId].step = null;
    return sendKeyboard(chatId,
      `⏰ *"${taskNombre}"* aplazada para el ${formatDate(nuevaFecha)} a las 09:00 hs.`,
      [['➕ Nueva tarea', '📋 Ver app']]
    );
  }

  const esSaludo = /^(hola|holi|holanda|boti|buenas|hey|buen[oa]s\s+d[ií]as?)$/i.test(text) || text === '/start';

  if (esSaludo) {
    state[chatId] = null;
    return sendKeyboard(chatId,
      `👋 ¡Hola Belén! ¿Qué querés hacer?`,
      [['➕ Nueva tarea', '📋 Pendientes de hoy'], ['📅 Esta semana', '📅 Próxima semana'], ['🔍 Ver app']]
    );
  }

  if (text === 'No, gracias') {
    state[chatId] = null;
    return sendMessage(chatId, `¡Hasta luego Belén! 😊 Cualquier cosa que necesites, acá estoy.`);
  }

  if (text === '❓ Ayuda' || text === '/ayuda') {
    return sendMessage(chatId,
      `*Comandos:*\n\n➕ *Nueva tarea* — Crear tarea\n📋 *Ver app* — Abrir la app\n\nRecibís automáticamente:\n🌅 Resumen semanal todos los días a las 9am\n🔔 Recordatorio a la hora de cada tarea`
    );
  }

  if (text === '🔍 Ver app' || text === '📋 Ver app' || text === '/app') {
    return sendMessage(chatId, `📱 Abrí tu app:\n${APP_URL}`);
  }

  if (text === '➕ Nueva tarea' || text === '➕ Sí, nueva tarea' || text === '/nueva' || text === '➕ Sí, agregar subtarea' && !state[chatId]) {
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
      if (text === 'Hoy') { fecha = arDate(0); }
      else if (text === 'Mañana') { fecha = arDate(1); }
      else if (text === 'En 3 días') { fecha = arDate(3); }
      else if (text === 'En 1 semana') { fecha = arDate(7); }
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
        [['No', 'Diaria'], ['Semanal', 'Quincenal'], ['Mensual', 'Anual']]
      );
    }

    if (s.step === 'recurrencia') {
      const recMap = { 'No':'ninguna','Una vez':'ninguna','Diaria':'diaria','Semanal':'semanal','Quincenal':'quincenal','Mensual':'mensual','Anual':'anual' };
      s.recurrencia = recMap[text] || 'ninguna'; s.step = 'categoria';
      return sendKeyboard(chatId, `📂 ¿Categoría?`,
        [['💰 Pagos', '🏥 Salud'], ['🏠 Hogar', '💼 Trabajo'], ['📞 Llamadas', '📋 General']]
      );
    }

    if (s.step === 'subtarea_ask') {
      if (text === '➕ Sí, agregar subtarea') {
        s.step = 'subtarea_nombre';
        return sendMessage(chatId, `📎 ¿Cuál es el nombre de la subtarea?`);
      } else {
        state[chatId] = null;
        return sendKeyboard(chatId, `¿Querés agregar otra tarea?`,
          [['➕ Nueva tarea', 'No, gracias']]
        );
      }
    }

    if (s.step === 'subtarea_nombre') {
      s.subtareaNombre = text;
      s.step = 'subtarea_fecha';
      return sendKeyboard(chatId, `📅 ¿Para cuándo es la subtarea *"${text}"*?`,
        [['Mismo día', 'Mañana'], ['En 3 días', 'En 1 semana']]
      );
    }

    if (s.step === 'subtarea_fecha') {
      let fecha;
      if (text === 'Mismo día') { fecha = s.fecha; }
      else if (text === 'Mañana') { fecha = arDate(1); }
      else if (text === 'En 3 días') { fecha = arDate(3); }
      else if (text === 'En 1 semana') { fecha = arDate(7); }
      else { fecha = s.fecha; }

      // Load task, add subtask, save back
      const tasks = await getSheetData();
      const task = tasks.find(t => t.id === s.tareaId);
      if (task) {
        if (!task.subtareas) task.subtareas = [];
        task.subtareas.push({
          id: Date.now().toString(),
          nombre: s.subtareaNombre,
          fecha, hora: '09:00', completada: false
        });
        // Update the sheet row
        await updateTaskSubtareas(s.tareaId, task.subtareas);
      }

      s.step = 'subtarea_ask';
      return sendKeyboard(chatId,
        `✅ Subtarea *"${s.subtareaNombre}"* agregada para ${formatDate(fecha)}.

¿Querés agregar otra subtarea?`,
        [['➕ Sí, agregar subtarea', 'Listo, sin más subtareas']]
      );
    }

    if (s.step === 'categoria') {
      s.categoria = text;
      const id = Date.now().toString();
      const row = [id, s.nombre, '', s.fecha, s.hora, s.recurrencia, s.categoria, 'false', '[]', new Date().toISOString()];
      const saved = await appendToSheet(row);
      const resumen = `✅ *Tarea guardada!*\n\n📋 *${s.nombre}*\n📅 ${formatDate(s.fecha)} 🕐 ${s.hora}\n🔁 ${s.recurrencia}\n${s.categoria}\n\n${saved ? '✓ Sincronizada en Google Sheets\n🔔 Te voy a avisar el día y hora indicados' : '⚠️ No se pudo sincronizar con Sheets'}`;
      state[chatId] = { step: 'subtarea_ask', tareaId: id, tareaNombre: s.nombre };
      return sendKeyboard(chatId,
        `${resumen}\n\n¿Querés agregar subtareas a esta tarea?`,
        [['➕ Sí, agregar subtarea', 'No, gracias']]
      );
    }
  }

  // Subtask flow outside state (buttons)
  if (text === '➕ Sí, agregar subtarea' && state[chatId] && state[chatId].step === 'subtarea_ask') {
    state[chatId].step = 'subtarea_nombre';
    return sendMessage(chatId, `📎 ¿Cuál es el nombre de la subtarea?`);
  }

  if (text === 'Listo, sin más subtareas' && state[chatId] && state[chatId].step === 'subtarea_ask') {
    state[chatId] = null;
    return sendKeyboard(chatId, `¡Perfecto! ¿Querés agregar otra tarea?`,
      [['➕ Nueva tarea', 'No, gracias']]
    );
  }

  return sendKeyboard(chatId, `👋 ¡Hola Belén! ¿Qué querés hacer?`,
    [['➕ Nueva tarea', '📋 Pendientes de hoy'], ['📅 Esta semana', '📅 Próxima semana'], ['🔍 Ver app']]
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
