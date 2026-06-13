const https = require('https');

const BOT_TOKEN = '8965677289:AAHjoNscXXs64kFedF8F1KqwjpeqCIiWi_M';
const SHEET_ID  = '1f0v6D6ue9iUp5VLMcyiFvY5EpNIpMKWLcS0M53rVeMs';
const APP_URL   = 'https://belenvllnd07-lab.github.io/mis-tareas/task-manager.html';

// Estado por chat para conversación multi-paso
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
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_EMAIL;
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  
  if (!serviceAccountEmail || !privateKey) {
    console.log('No Google credentials, skipping sheet append');
    return false;
  }

  try {
    const { GoogleAuth } = require('google-auth-library');
    const auth = new GoogleAuth({
      credentials: { client_email: serviceAccountEmail, private_key: privateKey },
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();

    const body = JSON.stringify({ values: [row] });
    await new Promise((resolve, reject) => {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Hoja%201:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
      const opts = {
        hostname: 'sheets.googleapis.com',
        path: `/v4/spreadsheets/${SHEET_ID}/values/Hoja%201:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token.token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      };
      const req = https.request(opts, res => { res.on('data', () => {}); res.on('end', resolve); });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    return true;
  } catch(e) {
    console.error('Sheet error:', e.message);
    return false;
  }
}

async function handleMessage(msg) {
  const chatId = msg.chat.id.toString();
  const text = (msg.text || '').trim();

  // Inicio
  if (text === '/start') {
    state[chatId] = null;
    return sendKeyboard(chatId,
      `👋 Hola! Soy tu asistente de tareas.\n\n¿Qué querés hacer?`,
      [['➕ Nueva tarea', '📋 Ver app'], ['❓ Ayuda']]
    );
  }

  // Ayuda
  if (text === '/ayuda' || text === '❓ Ayuda') {
    return sendMessage(chatId,
      `*Comandos disponibles:*\n\n➕ *Nueva tarea* — Crear una tarea nueva\n📋 *Ver app* — Abrir la app completa\n\nPodés escribir directamente el nombre de la tarea cuando te lo pida.`
    );
  }

  // Ver app
  if (text === '📋 Ver app' || text === '/app') {
    return sendMessage(chatId, `📱 Abrí tu app aquí:\n${APP_URL}`);
  }

  // Nueva tarea - inicio
  if (text === '➕ Nueva tarea' || text === '/nueva') {
    state[chatId] = { step: 'nombre' };
    return sendMessage(chatId, `📝 *Nueva tarea*\n\n¿Cuál es el nombre de la tarea?`);
  }

  // Flujo de nueva tarea
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

    if (s.step === 'fecha') {
      const today = new Date();
      let fecha;
      if (text === 'Hoy') {
        fecha = today.toISOString().split('T')[0];
      } else if (text === 'Mañana') {
        today.setDate(today.getDate() + 1);
        fecha = today.toISOString().split('T')[0];
      } else if (text === 'En 3 días') {
        today.setDate(today.getDate() + 3);
        fecha = today.toISOString().split('T')[0];
      } else if (text === 'En 1 semana') {
        today.setDate(today.getDate() + 7);
        fecha = today.toISOString().split('T')[0];
      } else if (text === 'Otra fecha') {
        s.step = 'fecha_manual';
        return sendMessage(chatId, `📅 Escribí la fecha en formato *DD/MM/AAAA*:`);
      } else {
        // intentar parsear fecha manual
        const parts = text.split('/');
        if (parts.length === 3) {
          fecha = `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
        } else {
          return sendMessage(chatId, `❌ No entendí la fecha. Escribila como DD/MM/AAAA o elegí una opción.`);
        }
      }
      s.fecha = fecha;
      s.step = 'recurrencia';
      return sendKeyboard(chatId,
        `🔁 ¿Se repite?`,
        [['Una vez', 'Diaria'], ['Semanal', 'Quincenal'], ['Mensual', 'Anual']]
      );
    }

    if (s.step === 'fecha_manual') {
      const parts = text.split('/');
      if (parts.length !== 3) return sendMessage(chatId, `❌ Formato incorrecto. Usá DD/MM/AAAA`);
      s.fecha = `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
      s.step = 'recurrencia';
      return sendKeyboard(chatId,
        `🔁 ¿Se repite?`,
        [['Una vez', 'Diaria'], ['Semanal', 'Quincenal'], ['Mensual', 'Anual']]
      );
    }

    if (s.step === 'recurrencia') {
      const recMap = { 'Una vez':'ninguna', 'Diaria':'diaria', 'Semanal':'semanal', 'Quincenal':'quincenal', 'Mensual':'mensual', 'Anual':'anual' };
      s.recurrencia = recMap[text] || 'ninguna';
      s.step = 'categoria';
      return sendKeyboard(chatId,
        `📂 ¿Categoría?`,
        [['💰 Pagos', '🏥 Salud'], ['🏠 Hogar', '💼 Trabajo'], ['📞 Llamadas', '📋 General']]
      );
    }

    if (s.step === 'categoria') {
      s.categoria = text;
      // Guardar tarea
      const id = Date.now().toString();
      const row = [id, s.nombre, '', s.fecha, '09:00', s.recurrencia, s.categoria, 'false', '[]', new Date().toISOString()];
      const saved = await appendToSheet(row);
      state[chatId] = null;

      const fechaDisplay = new Date(s.fecha + 'T00:00:00').toLocaleDateString('es-AR', { weekday:'short', day:'numeric', month:'short' });

      return sendKeyboard(chatId,
        `✅ *Tarea guardada!*\n\n📋 *${s.nombre}*\n📅 ${fechaDisplay}\n🔁 ${s.recurrencia}\n${s.categoria}\n\n${saved ? '✓ Sincronizada en Google Sheets' : '⚠️ Guardada localmente (configurá credenciales para sincronizar)'}`,
        [['➕ Nueva tarea', '📋 Ver app']]
      );
    }
  }

  // Mensaje no reconocido
  return sendKeyboard(chatId,
    `No entendí ese mensaje. ¿Qué querés hacer?`,
    [['➕ Nueva tarea', '📋 Ver app'], ['❓ Ayuda']]
  );
}

// Polling
let offset = 0;
async function poll() {
  try {
    const res = await apiRequest('/getUpdates', { offset, timeout: 30 });
    if (res.result && res.result.length > 0) {
      for (const update of res.result) {
        offset = update.update_id + 1;
        if (update.message) {
          await handleMessage(update.message).catch(e => console.error('Handler error:', e));
        }
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
