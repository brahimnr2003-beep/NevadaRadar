// Prueba del Worker en local, sin red: KV y fetch simulados.  node cloudflare/test.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import worker, { atender } from './src/worker.js';

const mock = JSON.parse(fs.readFileSync(new URL('../data/mock-open-meteo.json', import.meta.url), 'utf8'));

// KV simulado, con contador de escrituras
const datos = new Map(); let escrituras = 0;
const env = {
  TELEGRAM_BOT_TOKEN: 'TOKEN_DE_PRUEBA', WEBHOOK_SECRET: 'secreto-de-prueba',
  USERS: {
    get: async (k) => (datos.has(k) ? datos.get(k) : null),
    put: async (k, v) => { escrituras++; datos.set(k, v); },
    delete: async (k) => { datos.delete(k); },
  },
};

// fetch simulado: registra lo que se enviaría a Telegram y devuelve la previsión de prueba
let llamadas = [];
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://api.open-meteo.com')) return new Response(JSON.stringify(mock), { status: 200 });
  llamadas.push({ metodo: String(url).split('/').pop(), cuerpo: JSON.parse(init.body) });
  return new Response('{"ok":true}');
};

const msg = (id, text) => ({ message: { chat: { id, type: 'private' }, text } });
const btn = (id, data) => ({ callback_query: { id: 'cb9', data, message: { chat: { id, type: 'private' } } } });
const enviar = async (u) => { llamadas = []; await atender(u, env); return llamadas; };

// 1) /start: mensaje con botones en línea
let l = await enviar(msg(1, '/start'));
assert.equal(l.length, 1); assert.equal(l[0].metodo, 'sendMessage');
assert.equal(l[0].cuerpo.reply_markup.inline_keyboard[0][0].callback_data, 'start:defaults');

// 2) Botón: se responde al botón (answerCallbackQuery) y se guardan los requisitos
l = await enviar(btn(1, 'start:defaults'));
assert.deepEqual(l.map(x => x.metodo), ['answerCallbackQuery', 'sendMessage']);
assert.equal(JSON.parse(datos.get('u:1')).req.minNieveNueva, 5);

// 3) /prevision: dos fotos (gráfico y calendario)
l = await enviar(msg(1, '/prevision'));
assert.deepEqual(l.map(x => x.metodo), ['sendPhoto', 'sendPhoto']);
assert(l[0].cuerpo.photo.startsWith('https://quickchart.io/chart')); assert(l[0].cuerpo.caption.includes('Sierra Nevada'));
assert(l[1].cuerpo.caption.includes('Días aptos y no aptos'));

// 4) Solo se escribe en KV cuando cambia el estado (ahorra escrituras del plan gratuito)
const antes = escrituras;
await enviar(msg(1, '/prevision')); await enviar(msg(1, '/ayuda'));
assert.equal(escrituras, antes);

// 5) Usuarios independientes; /borrar elimina los datos del usuario
await enviar(btn(2, 'start:custom')); await enviar(msg(2, '30'));
assert.equal(JSON.parse(datos.get('u:2')).req.minNieveNueva, 30);
assert.equal(JSON.parse(datos.get('u:1')).req.minNieveNueva, 5);
await enviar(msg(2, '/borrar'));
assert.equal(datos.has('u:2'), false);

// 6) Chats de grupo: se ignoran sin enviar nada
l = await enviar({ message: { chat: { id: 9, type: 'group' }, text: 'hola' } });
assert.equal(l.length, 0); assert.equal(datos.has('u:9'), false);

// 7) Seguridad del webhook: sin el secreto de Telegram, 403
const ctx = { waitUntil: () => {} };
const peticion = (cabeceras) => new Request('https://x.workers.dev/webhook', { method: 'POST', headers: cabeceras, body: JSON.stringify(msg(1, '/ayuda')) });
assert.equal((await worker.fetch(peticion({}), env, ctx)).status, 403);
assert.equal((await worker.fetch(peticion({ 'X-Telegram-Bot-Api-Secret-Token': 'mal' }), env, ctx)).status, 403);
assert.equal((await worker.fetch(peticion({ 'X-Telegram-Bot-Api-Secret-Token': 'secreto-de-prueba' }), env, ctx)).status, 200);
assert.equal((await worker.fetch(new Request('https://x.workers.dev/otra', { method: 'POST' }), env, ctx)).status, 404);

// 8) Si falla la previsión, el usuario recibe un aviso en vez de silencio
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async (url, init) => String(url).startsWith('https://api.open-meteo.com')
  ? new Response('error', { status: 500 }) : fetchOriginal(url, init);
l = await enviar(msg(1, '/prevision'));
assert.deepEqual(l.map(x => x.metodo), ['sendMessage']); assert(l[0].cuerpo.text.includes('No he podido'));

console.log('✅ Worker: todas las pruebas pasan');
