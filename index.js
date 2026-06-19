const https = require('https');

const BOT_TOKEN = '8965677289:AAHjoNscXXs64kFedF8F1KqwjpeqCIiWi_M';
const CHAT_ID   = '8959251221';
const SHEET_ID  = '1f0v6D6ue9iUp5VLMcyiFvY5EpNIpMKWLcS0M53rVeMs';
const APP_URL   = 'https://belenvllnd07-lab.github.io/mis-tareas/task-manager.html';
const GAS_URL   = 'https://script.google.com/macros/s/AKfycby_LWPDxKVjYcbyFwN-aqbM7m18RzGDGhQTH7V1Uw85SBnFdjc8VcbMFz7abv0ReQRILDL4s4fY0-wusnTS0ZqyDvjyGuXtiOjE/exec';

const state = {};

// ── HTTP ─────────────────────────────────────────────────
function httpsPost(hostname, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname, path, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    }, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch(e) { resolve({}); } });
    });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

function httpsGet(hostname, path, token) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname, path, method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {}
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

function sendMessage(chatId, text, extra) {
  return tgPost('/sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown', ...extra });
}

function sendKeyboard(chatId, text, buttons) {
  return sendMessage(chatId, text, {
    reply_markup: { keyboard: buttons, resize_keyboard: true, one_time_keyboard: false }
  });
}

// ── SHEETS VIA GAS ───────────────────────────────────────
function gasRequest(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const encodedPayload = encodeURIComponent(data);

    function doRequest(urlStr, method, redirectCount) {
      redirectCount = redirectCount || 0;
      if (redirectCount > 5) { resolve({ ok: false, error: 'too many redirects' }); return; }
      const url = new URL(urlStr);
      console.log(`GAS request [${redirectCount}]: ${method} ${url.hostname}${url.pathname.substr(0,50)}`);
      const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: method,
        headers: {}
      };

      const req = https.request(options, res => {
        console.log(`GAS response: ${res.statusCode}`);
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          console.log(`Redirect to: ${res.headers.location.substr(0,80)}`);
          return doRequest(res.headers.location, 'GET', redirectCount + 1);
        }
        let raw = '';
        res.on('data', d => raw += d);
        res.on('end', () => {
          console.log(`GAS raw response: ${raw.substr(0,200)}`);
          try { resolve(JSON.parse(raw)); }
          catch(e) { resolve({ ok: false, error: 'parse error: ' + raw.substr(0,100) }); }
        });
      });
      req.on('error', (e) => { console.error('GAS request error:', e.message); reject(e); });
      req.end();
    }

    const urlWithPayload = GAS_URL + '?payload=' + encodedPayload;
    doRequest(urlWithPayload, 'GET', 0);
  });
}

async function getSheetData() {
  try {
    const res = await gasRequest({ action: 'get' });
    if (!res.ok || !res.values) return [];
    return res.values.filter(row => row[0]).map(row => ({
      id: row[0], nombre: row[1] || '', descripcion: row[2] || '',
      fecha: row[3] || '', hora: row[4] || '09:00',
      recurrencia: row[5] || 'ninguna', categoria: row[6] || '',
      completada: row[7] === 'true',
      subtareas: row[8] ? JSON.parse(row[8]) : [],
      avisoPrevio: row[10] === 'true'
    }));
  } catch(e) { console.error('getSheetData error:', e); return []; }
}

async function appendToSheet(row) {
  try {
    console.log('Calling GAS append with row:', JSON.stringify(row));
    const res = await gasRequest({ action: 'append', row });
    console.log('GAS append response:', JSON.stringify(res));
    return res.ok;
  } catch(e) {
    console.error('appendToSheet exception:', e.message);
    return false;
  }
}

async function updateTaskSubtareas(taskId, subtareas) {
  try {
    const res = await gasRequest({ action: 'update', id: taskId, updates: [{ col: 9, value: JSON.stringify(subtareas) }] });
    return res.ok;
  } catch(e) { return false; }
}

async function markTaskDone(taskId) {
  try {
    const res = await gasRequest({ action: 'update', id: taskId, updates: [{ col: 8, value: 'true' }] });
    return res.ok;
  } catch(e) { return false; }
}

async function updateTaskFecha(taskId, fecha, hora) {
  try {
    const res = await gasRequest({ action: 'update', id: taskId, updates: [{ col: 4, value: fecha }, { col: 5, value: hora }] });
    return res.ok;
  } catch(e) { return false; }
}

// ── DATE HELPERS ─────────────────────────────────────────
function arDate(offsetDays) {
  const d = new Date();
  d.setHours(d.getHours() - 3);
  if (offsetDays) d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split('T')[0];
}

function todayStr() { return arDate(0); }

function nowHour() {
  const d = new Date(); d.setHours(d.getHours() - 3);
  return d.toISOString().substr(11, 5);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' });
}

// ── MENUS ────────────────────────────────────────────────
const MENU_PRINCIPAL = [['➕ Nueva tarea', '📋 Pendientes de hoy'], ['📅 Esta semana', '📅 Próxima semana'], ['🔍 Ver app']];
const MENU_POST_TAREA = [['➕ Nueva tarea', 'No, gracias']];

// ── REMINDERS ────────────────────────────────────────────
async function sendDailySummary() {
  const tasks = await getSheetData();
  const today = todayStr();
  const weekEnd = arDate(7);
  const semana = tasks.filter(t => !t.completada && t.fecha >= today && t.fecha <= weekEnd)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (semana.length === 0) {
    await sendMessage(CHAT_ID, '📋 *Resumen semanal*\n\n¡No tenés tareas pendientes esta semana! 🎉');
    return;
  }
  const porDia = {};
  semana.forEach(t => { if (!porDia[t.fecha]) porDia[t.fecha] = []; porDia[t.fecha].push(t); });
  let msg = `📋 *Resumen semanal* — ${new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}\n\n`;
  for (const [fecha, tareas] of Object.entries(porDia)) {
    msg += `*${formatDate(fecha)}*\n`;
    tareas.forEach(t => { msg += `  • ${t.categoria} ${t.nombre}${t.hora ? ` 🕐 ${t.hora}` : ''}\n`; });
    msg += '\n';
  }
  msg += `_${semana.length} tarea${semana.length !== 1 ? 's' : ''} esta semana_`;
  await sendMessage(CHAT_ID, msg);
}

async function sendDailyOnly() {
  const tasks = await getSheetData();
  const today = todayStr();
  const hoy = tasks.filter(t => !t.completada && t.fecha === today)
    .sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));
  if (hoy.length === 0) {
    await sendMessage(CHAT_ID, '📋 *Resumen de hoy*\n\n¡No tenés tareas para hoy! 🎉');
    return;
  }
  let msg = `📋 *Resumen de hoy* — ${new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}\n\n`;
  hoy.forEach(t => { msg += `• ${t.categoria} *${t.nombre}*${t.hora ? ` 🕐 ${t.hora}` : ''}
`; });
  msg += `
_${hoy.length} tarea${hoy.length !== 1 ? 's' : ''} para hoy_`;
  await sendMessage(CHAT_ID, msg);
}

function minutesBefore(hora, mins) {
  const [h, m] = hora.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  d.setMinutes(d.getMinutes() - mins);
  return d.toTimeString().substr(0, 5);
}

async function checkTaskReminders() {
  const tasks = await getSheetData();
  const today = todayStr();
  const now = nowHour();

  // Aviso 10 minutos antes
  const toRemindPrevio = tasks.filter(t => !t.completada && t.fecha === today && t.avisoPrevio && minutesBefore(t.hora, 10) === now);
  for (const task of toRemindPrevio) {
    await sendMessage(CHAT_ID,
      `⏱️ *Aviso previo* — en 10 minutos\n\n${task.categoria} *${task.nombre}*\n🕐 ${task.hora}`
    );
  }

  // Recordatorio a la hora exacta
  const toRemind = tasks.filter(t => !t.completada && t.fecha === today && t.hora === now);
  for (const task of toRemind) {
    state[CHAT_ID] = state[CHAT_ID] || {};
    state[CHAT_ID].pendingReminder = { taskId: task.id, taskNombre: task.nombre };
    await sendMessage(CHAT_ID,
      `🔔 *Recordatorio*\n\n${task.categoria} *${task.nombre}*\n📅 ${formatDate(task.fecha)} 🕐 ${task.hora}${task.recurrencia !== 'ninguna' ? `\n🔁 ${task.recurrencia}` : ''}`,
      { reply_markup: { keyboard: [['✅ Marcar como hecha', '⏰ Aplazar']], resize_keyboard: true, one_time_keyboard: true } }
    );
  }
}

// ── SCHEDULER ────────────────────────────────────────────
let lastDailyDate = '';
let lastMinuteCheck = '';

function startScheduler() {
  setInterval(async () => {
    const timeStr = nowHour();
    const dateStr = todayStr();
    if (timeStr === '09:00' && lastDailyDate !== dateStr) {
      lastDailyDate = dateStr;
      const diaSemana = new Date().getDay(); // 0=dom, 1=lun, 2=mar... 5=vie, 6=sab
      const diaAR = diaSemana; // Railway usa UTC pero ya compensamos con arDate
      if (diaAR === 1) {
        // Lunes: resumen semanal
        await sendDailySummary().catch(e => console.error('Weekly error:', e));
      } else if (diaAR >= 2 && diaAR <= 5) {
        // Martes a viernes: resumen del día
        await sendDailyOnly().catch(e => console.error('Daily error:', e));
      }
      // Sábado (6) y domingo (0): nada
    }
    if (timeStr !== lastMinuteCheck) {
      lastMinuteCheck = timeStr;
      await checkTaskReminders().catch(e => console.error('Reminder error:', e));
    }
  }, 60000);
  console.log('⏰ Scheduler iniciado');
}

// ── BOT HANDLER ──────────────────────────────────────────
async function handleMessage(msg) {
  const chatId = msg.chat.id.toString();
  const text = (msg.text || '').trim();

  // ── SALUDOS → menú principal ──────────────────────────
  if (/^(hola|holi|holanda|boti|buenas|hey)$/i.test(text) || text === '/start') {
    state[chatId] = null;
    return sendKeyboard(chatId, '👋 ¡Hola Belén! ¿Qué querés hacer?', MENU_PRINCIPAL);
  }

  // ── CONSULTAS ─────────────────────────────────────────
  if (text === '📋 Pendientes de hoy') {
    state[chatId] = null;
    const tasks = await getSheetData();
    const hoy = tasks.filter(t => !t.completada && t.fecha === todayStr())
      .sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));
    if (hoy.length === 0) return sendKeyboard(chatId, '¡Todo al día Belén! No tenés nada pendiente para hoy 🎉', MENU_PRINCIPAL);
    let msg = '📋 *Pendientes de hoy*\n\n';
    hoy.forEach(t => { msg += `• ${t.categoria} *${t.nombre}*${t.hora ? ` 🕐 ${t.hora}` : ''}\n`; });
    msg += `\n_${hoy.length} tarea${hoy.length !== 1 ? 's' : ''} pendiente${hoy.length !== 1 ? 's' : ''}_`;
    return sendKeyboard(chatId, msg, MENU_PRINCIPAL);
  }

  if (text === '📅 Esta semana') {
    state[chatId] = null;
    const tasks = await getSheetData();
    const semana = tasks.filter(t => !t.completada && t.fecha >= todayStr() && t.fecha <= arDate(7))
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
    if (semana.length === 0) return sendKeyboard(chatId, '📋 No tenés tareas para esta semana. ¡Todo al día! 🎉', MENU_PRINCIPAL);
    const porDia = {};
    semana.forEach(t => { if (!porDia[t.fecha]) porDia[t.fecha] = []; porDia[t.fecha].push(t); });
    let msg = '📅 *Esta semana*\n\n';
    for (const [fecha, tareas] of Object.entries(porDia)) {
      msg += `*${formatDate(fecha)}*\n`;
      tareas.forEach(t => { msg += `  • ${t.categoria} ${t.nombre}${t.hora ? ` 🕐 ${t.hora}` : ''}\n`; });
      msg += '\n';
    }
    msg += `_${semana.length} tarea${semana.length !== 1 ? 's' : ''} en total_`;
    return sendKeyboard(chatId, msg, MENU_PRINCIPAL);
  }

  if (text === '📅 Próxima semana') {
    state[chatId] = null;
    const tasks = await getSheetData();
    const semana = tasks.filter(t => !t.completada && t.fecha >= arDate(7) && t.fecha < arDate(14))
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
    if (semana.length === 0) return sendKeyboard(chatId, '📋 No tenés tareas para la próxima semana. ¡A descansar! 😊', MENU_PRINCIPAL);
    const porDia = {};
    semana.forEach(t => { if (!porDia[t.fecha]) porDia[t.fecha] = []; porDia[t.fecha].push(t); });
    let msg = '📅 *Próxima semana*\n\n';
    for (const [fecha, tareas] of Object.entries(porDia)) {
      msg += `*${formatDate(fecha)}*\n`;
      tareas.forEach(t => { msg += `  • ${t.categoria} ${t.nombre}${t.hora ? ` 🕐 ${t.hora}` : ''}\n`; });
      msg += '\n';
    }
    msg += `_${semana.length} tarea${semana.length !== 1 ? 's' : ''} en total_`;
    return sendKeyboard(chatId, msg, MENU_PRINCIPAL);
  }

  // ── VER APP ───────────────────────────────────────────
  if (text === '🔍 Ver app' || text === '/app') {
    return sendMessage(chatId, `📱 Abrí tu app:\n${APP_URL}`);
  }

  // ── AYUDA ─────────────────────────────────────────────
  if (text === '❓ Ayuda' || text === '/ayuda') {
    return sendKeyboard(chatId,
      '*Menú de opciones:*\n\n➕ *Nueva tarea* — Crear tarea\n📋 *Pendientes de hoy* — Ver tareas de hoy\n📅 *Esta semana* — Ver semana actual\n📅 *Próxima semana* — Ver próxima semana\n🔍 *Ver app* — Abrir la app completa\n\n🌅 Recibís resumen todos los días a las 9am\n🔔 Recordatorio a la hora de cada tarea',
      MENU_PRINCIPAL);
  }

  // ── DESPEDIDA ─────────────────────────────────────────
  if (text === 'No, gracias') {
    state[chatId] = null;
    return sendKeyboard(chatId, '¡Hasta luego Belén! 😊 Cualquier cosa que necesites, acá estoy.', MENU_PRINCIPAL);
  }

  // ── RECORDATORIO: acciones ────────────────────────────
  if (text === '✅ Marcar como hecha' && state[chatId] && state[chatId].pendingReminder) {
    const { taskId, taskNombre } = state[chatId].pendingReminder;
    delete state[chatId].pendingReminder;
    await markTaskDone(taskId);
    return sendKeyboard(chatId, `✅ *¡Bien hecho Belén!* "${taskNombre}" marcada como completada. 🎉`, MENU_PRINCIPAL);
  }

  if (text === '⏰ Aplazar' && state[chatId] && state[chatId].pendingReminder) {
    state[chatId].step = 'aplazar_reminder';
    return sendKeyboard(chatId, '⏰ ¿Cuánto tiempo querés aplazarla?',
      [['30 minutos', '1 hora'], ['2 horas', '4 horas'], ['Mañana', 'Otra fecha']]);
  }

  if (state[chatId] && state[chatId].step === 'aplazar_reminder') {
    const { taskId, taskNombre } = state[chatId].pendingReminder || {};
    if (!taskId) { state[chatId] = null; return sendKeyboard(chatId, '👋 ¡Hola Belén! ¿Qué querés hacer?', MENU_PRINCIPAL); }
    const now = new Date(); now.setHours(now.getHours() - 3);
    let nuevaFecha, nuevaHora;
    if (text === '30 minutos') { now.setMinutes(now.getMinutes() + 30); }
    else if (text === '1 hora') { now.setHours(now.getHours() + 1); }
    else if (text === '2 horas') { now.setHours(now.getHours() + 2); }
    else if (text === '4 horas') { now.setHours(now.getHours() + 4); }
    else if (text === 'Mañana') { now.setDate(now.getDate() + 1); }
    else if (text === 'Otra fecha') {
      state[chatId].step = 'aplazar_fecha_manual';
      return sendMessage(chatId, '📅 Escribí la nueva fecha en formato *DD/MM/AAAA*:');
    } else {
      return sendMessage(chatId, '❌ Opción no válida.');
    }
    nuevaFecha = now.toISOString().split('T')[0];
    nuevaHora = now.toISOString().substr(11, 5);
    await updateTaskFecha(taskId, nuevaFecha, nuevaHora);
    delete state[chatId].pendingReminder;
    state[chatId].step = null;
    return sendKeyboard(chatId, `⏰ *"${taskNombre}"* aplazada para el ${formatDate(nuevaFecha)} a las ${nuevaHora} hs.`, MENU_PRINCIPAL);
  }

  if (state[chatId] && state[chatId].step === 'aplazar_fecha_manual') {
    const { taskId, taskNombre } = state[chatId].pendingReminder || {};
    const p = text.split('/');
    if (p.length !== 3) return sendMessage(chatId, '❌ Formato incorrecto. Usá DD/MM/AAAA');
    const nuevaFecha = `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
    await updateTaskFecha(taskId, nuevaFecha, '09:00');
    delete state[chatId].pendingReminder;
    state[chatId].step = null;
    return sendKeyboard(chatId, `⏰ *"${taskNombre}"* aplazada para el ${formatDate(nuevaFecha)}.`, MENU_PRINCIPAL);
  }

  // ── NUEVA TAREA ───────────────────────────────────────
  if (text === '➕ Nueva tarea' || text === '/nueva') {
    state[chatId] = { step: 'nombre' };
    return sendMessage(chatId, '📝 *Nueva tarea*\n\n¿Cuál es el nombre?');
  }

  // ── FLUJO NUEVA TAREA ─────────────────────────────────
  if (state[chatId] && state[chatId].step) {
    const s = state[chatId];

    if (s.step === 'nombre') {
      s.nombre = text; s.step = 'fecha';
      return sendKeyboard(chatId, `📅 ¿Para cuándo es *"${text}"*?`,
        [['Hoy', 'Mañana'], ['En 3 días', 'En 1 semana'], ['Otra fecha']]);
    }

    if (s.step === 'fecha' || s.step === 'fecha_manual') {
      let fecha;
      if (text === 'Hoy') { fecha = arDate(0); }
      else if (text === 'Mañana') { fecha = arDate(1); }
      else if (text === 'En 3 días') { fecha = arDate(3); }
      else if (text === 'En 1 semana') { fecha = arDate(7); }
      else if (text === 'Otra fecha') { s.step = 'fecha_manual'; return sendMessage(chatId, '📅 Escribí la fecha en formato *DD/MM/AAAA*:'); }
      else {
        const p = text.split('/');
        if (p.length === 3) { fecha = `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`; }
        else return sendMessage(chatId, '❌ Formato incorrecto. Usá DD/MM/AAAA');
      }
      s.fecha = fecha; s.step = 'hora';
      return sendKeyboard(chatId, '🕐 ¿A qué hora querés el recordatorio?',
        [['08:00', '09:00'], ['10:00', '12:00'], ['15:00', '18:00'], ['20:00', 'Otra hora']]);
    }

    if (s.step === 'hora' || s.step === 'hora_manual') {
      if (text === 'Otra hora') { s.step = 'hora_manual'; return sendMessage(chatId, '🕐 Escribí la hora en formato *HH:MM*:'); }
      if (!/^\d{2}:\d{2}$/.test(text)) return sendMessage(chatId, '❌ Formato incorrecto. Usá HH:MM (ej: 09:30)');
      s.hora = text; s.step = 'recurrencia';
      return sendKeyboard(chatId, '🔁 ¿Se repite?',
        [['No', 'Diaria'], ['Semanal', 'Quincenal'], ['Mensual', 'Anual']]);
    }

    if (s.step === 'recurrencia') {
      const recMap = { 'No':'ninguna','Diaria':'diaria','Semanal':'semanal','Quincenal':'quincenal','Mensual':'mensual','Anual':'anual' };
      s.recurrencia = recMap[text] || 'ninguna'; s.step = 'aviso_previo';
      return sendKeyboard(chatId, '⏱️ ¿Avisar 10 minutos antes también?',
        [['Sí', 'No']]);
    }

    if (s.step === 'aviso_previo') {
      s.avisoPrevio = (text === 'Sí');
      s.step = 'categoria';
      return sendKeyboard(chatId, '📂 ¿Categoría?',
        [['💰 Pagos', '🏥 Salud'], ['🏠 Hogar', '💼 Trabajo'], ['📞 Llamadas', '📋 General']]);
    }

    if (s.step === 'categoria') {
      s.categoria = text;
      const id = Date.now().toString();
      const row = [id, s.nombre, '', s.fecha, s.hora, s.recurrencia, s.categoria, 'false', '[]', new Date().toISOString(), s.avisoPrevio ? 'true' : 'false'];
      const saved = await appendToSheet(row);
      const resumen = `✅ *Tarea guardada!*\n\n📋 *${s.nombre}*\n📅 ${formatDate(s.fecha)} 🕐 ${s.hora}\n🔁 ${s.recurrencia}\n${s.categoria}${s.avisoPrevio ? '\n⏱️ Aviso 10 min antes activado' : ''}\n\n${saved ? '✓ Sincronizada en Google Sheets\n🔔 Te voy a avisar el día y hora indicados' : '⚠️ No se pudo sincronizar con Sheets'}`;
      state[chatId] = { step: 'subtarea_ask', tareaId: id, tareaNombre: s.nombre };
      return sendKeyboard(chatId, `${resumen}\n\n¿Querés agregar subtareas?`,
        [['➕ Sí, agregar subtarea', 'No, gracias']]);
    }

    if (s.step === 'subtarea_ask') {
      if (text === '➕ Sí, agregar subtarea') {
        s.step = 'subtarea_nombre';
        return sendMessage(chatId, '📎 ¿Cuál es el nombre de la subtarea?');
      } else {
        state[chatId] = null;
        return sendKeyboard(chatId, '¿Querés agregar otra tarea?', MENU_POST_TAREA);
      }
    }

    if (s.step === 'subtarea_nombre') {
      s.subtareaNombre = text; s.step = 'subtarea_fecha';
      return sendKeyboard(chatId, `📅 ¿Para cuándo es *"${text}"*?`,
        [['Mismo día', 'Mañana'], ['En 3 días', 'En 1 semana']]);
    }

    if (s.step === 'subtarea_fecha') {
      let fecha;
      if (text === 'Mismo día') { fecha = s.fecha; }
      else if (text === 'Mañana') { fecha = arDate(1); }
      else if (text === 'En 3 días') { fecha = arDate(3); }
      else if (text === 'En 1 semana') { fecha = arDate(7); }
      else { fecha = s.fecha; }
      const tasks = await getSheetData();
      const task = tasks.find(t => t.id === s.tareaId);
      if (task) {
        if (!task.subtareas) task.subtareas = [];
        task.subtareas.push({ id: Date.now().toString(), nombre: s.subtareaNombre, fecha, hora: '09:00', completada: false });
        await updateTaskSubtareas(s.tareaId, task.subtareas);
      }
      s.step = 'subtarea_ask';
      return sendKeyboard(chatId,
        `✅ Subtarea *"${s.subtareaNombre}"* agregada para ${formatDate(fecha)}.\n\n¿Querés agregar otra subtarea?`,
        [['➕ Sí, agregar subtarea', 'No, gracias']]);
    }
  }

  // ── FALLBACK ──────────────────────────────────────────
  return sendKeyboard(chatId, '👋 ¡Hola Belén! ¿Qué querés hacer?', MENU_PRINCIPAL);
}

// ── POLLING ───────────────────────────────────────────────
let offset = 0;
async function poll() {
  try {
    const res = await tgPost('/getUpdates', { offset, timeout: 30 });
    if (res.result && res.result.length > 0) {
      for (const update of res.result) {
        offset = update.update_id + 1;
        if (update.message) await handleMessage(update.message).catch(e => console.error('Handler error:', e));
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
