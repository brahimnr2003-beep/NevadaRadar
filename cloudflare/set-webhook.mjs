// Registra el webhook de Telegram hacia tu Worker y define el menú de comandos.
// Uso (PowerShell), con el token y el secreto en variables de entorno, NUNCA escritos en el código:
//   $env:TELEGRAM_BOT_TOKEN = "..."; $env:WEBHOOK_SECRET = "..."
//   node set-webhook.mjs https://nevadaradar.<tu-subdominio>.workers.dev
// Para volver a usar n8n con este bot:  node set-webhook.mjs --borrar
const { TELEGRAM_BOT_TOKEN: token, WEBHOOK_SECRET: secret } = process.env;
const arg = process.argv[2];
if (!token) { console.error('Falta la variable TELEGRAM_BOT_TOKEN'); process.exit(1); }
if (!arg) { console.error('Uso: node set-webhook.mjs <URL del Worker> | --borrar'); process.exit(1); }

const tg = async (metodo, cuerpo = {}) => {
  const r = await fetch(`https://api.telegram.org/bot${token}/${metodo}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo),
  });
  const j = await r.json();
  console.log(metodo, '->', j.ok ? 'ok' : j);
  return j;
};

if (arg === '--borrar') {
  await tg('deleteWebhook');
} else {
  if (!secret) { console.error('Falta la variable WEBHOOK_SECRET'); process.exit(1); }
  await tg('setWebhook', {
    url: arg.replace(/\/$/, '') + '/webhook',
    secret_token: secret,
    allowed_updates: ['message', 'callback_query'],
  });
  await tg('setMyCommands', { commands: [
    { command: 'start', description: 'Configurar tus requisitos' },
    { command: 'prevision', description: 'Gráfico y calendario de los próximos 16 días' },
    { command: 'requisitos', description: 'Cambiar tus requisitos' },
    { command: 'borrar', description: 'Eliminar tus datos' },
    { command: 'ayuda', description: 'Qué hace el bot' },
  ] });
  const info = await (await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`)).json();
  console.log('Webhook activo:', info.result && info.result.url, '| errores pendientes:', info.result && info.result.last_error_message || 'ninguno');
}
