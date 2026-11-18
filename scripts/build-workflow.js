// Genera n8n/nevadaradar-bot.json a partir de core/*.js:  npm run build
// Opcional: TELEGRAM_CRED_ID y TELEGRAM_CRED_NAME (el id de tu credencial en n8n, que no es secreto)
// rellenan la credencial en todos los nodos Telegram. Se leen del entorno o de un archivo .env
// (ignorado por git). Sin ellas, la credencial se elige a mano al importar.
const fs = require('fs');
const leer = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const codigo = require('./codigo-n8n');
if (fs.existsSync(__dirname + '/../.env')) {
  for (const l of leer('.env').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const cred = process.env.TELEGRAM_CRED_ID
  ? { telegramApi: { id: process.env.TELEGRAM_CRED_ID, name: process.env.TELEGRAM_CRED_NAME || 'Telegram account' } }
  : undefined;
const conCred = (n) => (cred ? { ...n, credentials: cred } : n);

const chatId = '={{ $json.chat_id }}';
const texto = '={{ $json.texto }}';
const sinMarca = { appendAttribution: false };
const boton = (text, callback_data) => ({ text, additionalFields: { callback_data } });
const fila = (...buttons) => ({ row: { buttons } });
const mensaje = (name, position, rows) => conCred({
  parameters: {
    chatId, text: texto,
    ...(rows ? { replyMarkup: 'inlineKeyboard', inlineKeyboard: { rows } } : {}),
    additionalFields: sinMarca,
  },
  name, type: 'n8n-nodes-base.telegram', typeVersion: 1.2, position,
});
const regla = (salida) => ({
  outputKey: salida,
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
    conditions: [{ leftValue: '={{ $json.accion }}', rightValue: salida, operator: { type: 'string', operation: 'equals' } }],
    combinator: 'and',
  },
});

const wf = {
  name: 'NevadaRadar · bot de Telegram',
  nodes: [
    conCred({
      parameters: { updates: ['message', 'callback_query'], additionalFields: {} },
      name: 'Mensaje o botón', type: 'n8n-nodes-base.telegramTrigger', typeVersion: 1.2, position: [0, 200],
      webhookId: 'b7d1c6a0-5a0e-4e0a-9d33-2f6a1c0e7a11',
    }),
    { parameters: { jsCode: codigo.cerebro() }, name: 'Cerebro', type: 'n8n-nodes-base.code', typeVersion: 2, position: [240, 200] },
    {
      parameters: { rules: { values: ['bienvenida', 'pregunta', 'texto', 'resumen', 'prevision'].map(regla) }, options: {} },
      name: '¿Qué responder?', type: 'n8n-nodes-base.switch', typeVersion: 3.2, position: [480, 200],
    },
    mensaje('Enviar bienvenida', [760, -120], [
      fila(boton('⚡ Usar predeterminados', 'start:defaults')),
      fila(boton('⚙️ Personalizar', 'start:custom')),
    ]),
    mensaje('Enviar pregunta', [760, 60], [
      fila(boton('={{ $json.b_def_text }}', '={{ $json.b_def_data }}')),
      fila(boton('={{ $json.b1_text }}', '={{ $json.b1_data }}'),
           boton('={{ $json.b2_text }}', '={{ $json.b2_data }}'),
           boton('={{ $json.b3_text }}', '={{ $json.b3_data }}')),
      fila(boton('✏️ Escribir otro valor', '={{ $json.b_custom_data }}')),
    ]),
    mensaje('Enviar texto', [760, 240]),
    mensaje('Enviar resumen', [760, 420], [fila(boton('📊 Ver previsión ahora', 'prev'))]),
    {
      parameters: {
        url: 'https://api.open-meteo.com/v1/forecast', sendQuery: true,
        queryParameters: { parameters: [
          { name: 'latitude', value: '37.0955' }, { name: 'longitude', value: '-3.3966' }, { name: 'elevation', value: '2500' },
          { name: 'daily', value: 'snowfall_sum,temperature_2m_max,temperature_2m_min,wind_speed_10m_max,wind_gusts_10m_max' },
          { name: 'forecast_days', value: '16' }, { name: 'timezone', value: 'Europe/Madrid' }, { name: 'wind_speed_unit', value: 'kmh' },
        ] },
        options: {},
      },
      name: 'Open-Meteo 16 días', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [760, 600],
    },
    { parameters: { jsCode: codigo.evaluar() }, name: 'Evaluar días', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1000, 600] },
    conCred({
      parameters: {
        operation: 'sendPhoto', chatId, file: '={{ $json.chart_url }}',
        additionalFields: { caption: '={{ $json.caption }}', ...sinMarca },
      },
      name: 'Enviar gráfico', type: 'n8n-nodes-base.telegram', typeVersion: 1.2, position: [1240, 600],
    }),
    conCred({
      parameters: {
        operation: 'sendPhoto', chatId: "={{ $('Evaluar días').item.json.chat_id }}",
        file: "={{ $('Evaluar días').item.json.calendar_url }}",
        additionalFields: { caption: "={{ $('Evaluar días').item.json.calendar_caption }}", ...sinMarca },
      },
      name: 'Enviar calendario', type: 'n8n-nodes-base.telegram', typeVersion: 1.2, position: [1480, 600],
    }),
  ],
  connections: {
    'Mensaje o botón': { main: [[{ node: 'Cerebro', type: 'main', index: 0 }]] },
    'Cerebro': { main: [[{ node: '¿Qué responder?', type: 'main', index: 0 }]] },
    '¿Qué responder?': { main: [
      [{ node: 'Enviar bienvenida', type: 'main', index: 0 }],
      [{ node: 'Enviar pregunta', type: 'main', index: 0 }],
      [{ node: 'Enviar texto', type: 'main', index: 0 }],
      [{ node: 'Enviar resumen', type: 'main', index: 0 }],
      [{ node: 'Open-Meteo 16 días', type: 'main', index: 0 }],
    ] },
    'Open-Meteo 16 días': { main: [[{ node: 'Evaluar días', type: 'main', index: 0 }]] },
    'Evaluar días': { main: [[{ node: 'Enviar gráfico', type: 'main', index: 0 }]] },
    'Enviar gráfico': { main: [[{ node: 'Enviar calendario', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1' },
};

fs.writeFileSync(__dirname + '/../n8n/nevadaradar-bot.json', JSON.stringify(wf, null, 2));
console.log('✔ n8n/nevadaradar-bot.json generado (' + wf.nodes.length + ' nodos)');
