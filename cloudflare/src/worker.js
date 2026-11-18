// NevadaRadar · versión pública en Cloudflare Workers (24/7, plan gratuito).
// Telegram llama por webhook a POST /webhook. La conversación y la evaluación son las mismas que en n8n (core/).
// Usuarios y requisitos: Workers KV, una clave por chat de Telegram (u:<chat_id>).
// Secretos (wrangler secret put): TELEGRAM_BOT_TOKEN y WEBHOOK_SECRET.
import { procesar } from '../../core/cerebro.js';
import { evaluar } from '../../core/evaluar.js';

const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
  latitude: '37.0955', longitude: '-3.3966', elevation: '2500',
  daily: 'snowfall_sum,temperature_2m_max,temperature_2m_min,wind_speed_10m_max,wind_gusts_10m_max',
  forecast_days: '16', timezone: 'Europe/Madrid', wind_speed_unit: 'kmh',
});

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/') return new Response('NevadaRadar OK');
    if (request.method !== 'POST' || url.pathname !== '/webhook') return new Response('No encontrado', { status: 404 });
    // Solo Telegram conoce el secreto que se registró con setWebhook
    if (!env.WEBHOOK_SECRET || request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
      return new Response('Prohibido', { status: 403 });
    }
    let update;
    try { update = await request.json(); } catch { return new Response('Petición no válida', { status: 400 }); }
    // Se responde 200 enseguida y se trabaja en segundo plano: así Telegram no reintenta el envío
    ctx.waitUntil(atender(update, env).catch((e) => console.error('Error atendiendo update:', e && e.message)));
    return new Response('ok');
  },
};

export async function atender(update, env) {
  const tg = (metodo, cuerpo) =>
    fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${metodo}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo),
    });

  const msg = update.message || (update.callback_query && update.callback_query.message);
  const chat_id = msg && msg.chat && msg.chat.id;
  if (chat_id === undefined) return;

  // Estado del usuario: se carga de KV, se procesa con core/ y se guarda solo si cambió
  // (el plan gratuito de KV permite pocas escrituras al día)
  const clave = `u:${chat_id}`;
  const antes = await env.USERS.get(clave);
  const estado = { users: antes ? { [chat_id]: JSON.parse(antes) } : {} };
  const r = procesar(update, estado);
  const despues = estado.users[chat_id];
  if (despues === undefined) { if (antes !== null) await env.USERS.delete(clave); }
  else if (JSON.stringify(despues) !== antes) await env.USERS.put(clave, JSON.stringify(despues));

  if (r.callback_id) await tg('answerCallbackQuery', { callback_query_id: r.callback_id }); // quita el "cargando" del botón
  if (r.accion === 'ignorar') return;

  if (r.accion === 'prevision') {
    try {
      const resp = await fetch(OPEN_METEO);
      if (!resp.ok) throw new Error('Open-Meteo ' + resp.status);
      const { daily } = await resp.json();
      const e = evaluar(daily, r.req, chat_id);
      await tg('sendPhoto', { chat_id, photo: e.chart_url, caption: e.caption });
      await tg('sendPhoto', { chat_id, photo: e.calendar_url, caption: e.calendar_caption });
    } catch (err) {
      console.error('Error en la previsión:', err && err.message);
      await tg('sendMessage', { chat_id, text: '⚠️ No he podido consultar la previsión ahora mismo. Inténtalo de nuevo en unos minutos.' });
    }
    return;
  }

  // bienvenida | pregunta | resumen | texto
  await tg('sendMessage', {
    chat_id, text: r.texto,
    ...(r.teclado ? { reply_markup: { inline_keyboard: r.teclado } } : {}),
  });
}
