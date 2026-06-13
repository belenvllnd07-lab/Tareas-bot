const https = require('https');

const BOT_TOKEN  = '8965677289:AAHjoNscXXs64kFedF8F1KqwjpeqCIiWi_M';
const CHAT_ID    = '8959251221';
const SHEET_ID   = '1f0v6D6ue9iUp5VLMcyiFvY5EpNIpMKWLcS0M53rVeMs';
const APP_URL    = 'https://belenvllnd07-lab.github.io/mis-tareas/task-manager.html';
const GOOGLE_TOKEN = process.env.GOOGLE_TOKEN || '';

const state = {};

function apiRequest(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}${path}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => resolve(JSON.parse(raw)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function sendMessage(chatId, text, extra = {}) {
  return apiRequest('/sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown', ...extra });
}

function sendKeyboard(chatId, text, buttons) {
  return sendMessage(chatId, text, {
    reply_markup: { keyboard: buttons, resize_keyboard: true, one_time_keyboard: true }
  });
}

async function appendToSheet(row) {
  const token = process.env.GOOGLE_TOKEN;
  if (!token) { console.log('No GOOGLE_TOKEN set'); return false; }
  return new Promise((resolve) => {
    const body = JSON.stringify({ values: [row] });
    const path = `/v4/spreadsheets/${SHEET_ID}/values/Hoja%201:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    const opts = {
      hostname: 'sheets.googleapis.com',
      path, method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try {
          const r = JSON.parse(raw);
          resolve(!r.error);
        } catch(e) { resolve(false); }
      });
    });
    req.on('error', () => resolve(false));
    req.write(body);
    req.end();
  });
}

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

  if (text === '/ayuda' || text === '❓ Ayuda') {
    return sendMessage(chatId,
      `*Comandos:*\n\n➕ *Nueva tarea* — Crear tarea\n📋 *Ver app* — Abrir la app`
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
      s.nombre = text;
      s.step = 'fecha';
      return sendKeyboard(chatId,
        `📅 ¿Para cuándo es *"${text}"*?`,
        [['Hoy', 'Mañana'], ['En 3 días', 'En 1 semana'], ['Otra fecha']]
      );
    }

    if (s.step === 'fecha' || s.step === 'fecha_manual') {
      const today = new Date();
      let fecha;
      if (text === 'Hoy') {
        fecha = today.toISOString().split('T')[0];
      } else if (text === 'Mañana') {
        today.setDate(today.getDate() + 1); fecha = today.toISOString().split('T')[0];
      } else if (text === 'En 3 días') {
        today.setDate(today.getDate() + 3); fecha = today.toISOString().split('T')[0];
      } else if (text === 'En 1 semana') {
        today.setDate(today.getDate() + 7); fecha = today.toISOString().split('T')[0];
      } else if (text === 'Otra fecha') {
        s.step = 'fecha_manual';
        return sendMessage(chatId, `📅 Escribí la fecha en formato *DD/MM/AAAA*:`);
      } else {
        const parts = text.split('/');
        if (parts.length === 3) {
          fecha = `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
        } else {
          return sendMessage(chatId, `❌ Formato incorrecto. Usá DD/MM/AAAA`);
        }
      }
      s.fecha = fecha;
      s.step = 'recurrencia';
      return sendKeyboard(chatId, `🔁 ¿Se repite?`,
        [['Una vez', 'Diaria'], ['Semanal', 'Quincenal'], ['Mensual', 'Anual']]
      );
    }

    if (s.step === 'recurrencia') {
      const recMap = { 'Una vez':'ninguna','Diaria':'diaria','Semanal':'semanal','Quincenal':'quincenal','Mensual':'mensual','Anual':'anual' };
      s.recurrencia = recMap[text] || 'ninguna';
      s.step = 'categoria';
      return sendKeyboard(chatId, `📂 ¿Categoría?`,
        [['💰 Pagos', '🏥 Salud'], ['🏠 Hogar', '💼 Trabajo'], ['📞 Llamadas', '📋 General']]
      );
    }

    if (s.step === 'categoria') {
      s.categoria = text;
      const id = Date.now().toString();
      const row = [id, s.nombre, '', s.fecha, '09:00', s.recurrencia, s.categoria, 'false', '[]', new Date().toISOString()];
      const saved = await appendToSheet(row);
      state[chatId] = null;
      const fechaDisplay = new Date(s.fecha + 'T00:00:00').toLocaleDateString('es-AR', { weekday:'short', day:'numeric', month:'short' });
      return sendKeyboard(chatId,
        `✅ *Tarea guardada!*\n\n📋 *${s.nombre}*\n📅 ${fechaDisplay}\n🔁 ${s.recurrencia}\n${s.categoria}\n\n${saved ? '✓ Sincronizada en Google Sheets ✓' : '⚠️ No se pudo sincronizar con Sheets'}`,
        [['➕ Nueva tarea', '📋 Ver app']]
      );
    }
  }

  return sendKeyboard(chatId,
    `No entendí. ¿Qué querés hacer?`,
    [['➕ Nueva tarea', '📋 Ver app'], ['❓ Ayuda']]
  );
}

let offset = 0;
async function poll() {
  try {
    const res = await apiRequest('/getUpdates', { offset, timeout: 30 });
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

console.log('🤖 Bot iniciado...');
poll();
