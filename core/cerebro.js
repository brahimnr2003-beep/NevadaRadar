'use strict';
// ====== CEREBRO DEL BOT: lógica de la conversación, sin dependencias ======
// procesar(update, estado) recibe una actualización de Telegram (mensaje o botón) y el estado
// de los usuarios ({ users: { [chat_id]: { paso, req } } }), lo actualiza y devuelve UNA acción:
//   accion: bienvenida | pregunta | texto | resumen | prevision | ignorar
// Lo usan n8n (el build incrusta este archivo en el nodo Code "Cerebro") y el Worker de Cloudflare.

// ---- Requisitos: valor predeterminado, límites válidos y alternativas de los botones ----
const CAMPOS = {
  nieve:  { clave: 'minNieveNueva', def: 5,   min: 0,   max: 100, unidad: 'cm',   alt: [2, 10, 20],
            titulo: 'Nieve nueva mínima',
            pregunta: '¿Cuántos cm de nieve nueva necesitas como mínimo para que merezca la pena subir?' },
  viento: { clave: 'maxViento',     def: 40,  min: 5,   max: 150, unidad: 'km/h', alt: [25, 55, 70],
            titulo: 'Viento máximo',
            pregunta: '¿A partir de qué viento sostenido (km/h) prefieres no subir?' },
  rachas: { clave: 'maxRachas',     def: 60,  min: 10,  max: 200, unidad: 'km/h', alt: [40, 80, 100],
            titulo: 'Rachas máximas',
            pregunta: '¿Qué rachas máximas de viento (km/h) aceptas?' },
  tmin:   { clave: 'tempMin',       def: -12, min: -40, max: 10,  unidad: '°C',   alt: [-8, -15, -20],
            titulo: 'Temperatura mínima',
            pregunta: '¿Qué temperatura mínima aguantas? Si la mínima del día es más fría, no cumple.' },
  tmax:   { clave: 'tempMax',       def: 3,   min: -20, max: 25,  unidad: '°C',   alt: [0, 5, 8],
            titulo: 'Temperatura máxima',
            pregunta: '¿Qué temperatura máxima aceptas? Si hace más calor, la nieve se vuelve húmeda y pesada.' },
};
const ORDEN = ['nieve', 'viento', 'rachas', 'tmin', 'tmax'];

const defaults = () => Object.fromEntries(ORDEN.map(c => [CAMPOS[c].clave, CAMPOS[c].def]));
const fmtResumen = (r) =>
  `• Nieve nueva mínima: ${r.minNieveNueva} cm\n• Viento máximo: ${r.maxViento} km/h\n` +
  `• Rachas máximas: ${r.maxRachas} km/h\n• Temperatura mínima: ${r.tempMin} °C\n• Temperatura máxima: ${r.tempMax} °C`;

const TEXTO_AYUDA =
  '❄️ NevadaRadar te dice qué días de los próximos 16 merecen la pena en Sierra Nevada, según TUS requisitos.\n\n' +
  'Comandos:\n/prevision – previsión con tu gráfico\n/requisitos – cambiar tus requisitos\n' +
  '/borrar – eliminar tus datos\n/ayuda – este mensaje\n\n' +
  'Colores del gráfico:\n🟢 cumple todo · 🟡 falla 1 requisito · 🔴 falla 2 o más\n' +
  'Los colores claros son días más allá del 7º: previsión orientativa.';

const btn = (text, callback_data) => ({ text, callback_data });
const TECLADO_BIENVENIDA = [[btn('⚡ Usar predeterminados', 'start:defaults')], [btn('⚙️ Personalizar', 'start:custom')]];
const TECLADO_RESUMEN = [[btn('📊 Ver previsión ahora', 'prev')]];

function procesar(item, estado) {
  // ---- Entrada: normaliza el mensaje o el botón ----
  const cb = item.callback_query;
  const msg = item.message || (cb && cb.message);
  const chat = msg && msg.chat;
  const callback_id = cb ? cb.id : null;
  if (!chat || chat.type !== 'private') return { accion: 'ignorar', callback_id }; // solo chats privados

  const chat_id = chat.id;
  const texto = ((item.message && item.message.text) || '').trim();
  const data = (cb && cb.data) || '';

  estado.users = estado.users || {};
  const u = estado.users[chat_id] = estado.users[chat_id] || { paso: 'nuevo', req: null };

  // ---- Salidas ----
  // `teclado`: botones en línea ([[{text, callback_data}]]) para quien los dibuje desde código (Worker).
  // n8n usa los campos b_* de las preguntas en nodos Telegram con botones fijos.
  const salir = (accion, extra = {}) =>
    ({ accion, chat_id, callback_id, texto: '', req: u.req, teclado: null, ...extra });

  const preguntar = (campo) => {
    u.paso = campo;
    const c = CAMPOS[campo];
    const n = ORDEN.indexOf(campo) + 1;
    const cdata = (v) => `v:${campo}:${v}`;
    const b_def_text = `Predeterminado: ${c.def} ${c.unidad}`;
    const alt = c.alt.map(v => ({ text: `${v} ${c.unidad}`, data: cdata(v) }));
    return salir('pregunta', {
      texto: `${n}/5 · ${c.titulo}\n${c.pregunta}\n\nElige una opción o escribe tu valor (en ${c.unidad}).`,
      b_def_text, b_def_data: cdata(c.def),
      b1_text: alt[0].text, b1_data: alt[0].data,
      b2_text: alt[1].text, b2_data: alt[1].data,
      b3_text: alt[2].text, b3_data: alt[2].data,
      b_custom_data: cdata('custom'),
      teclado: [
        [btn(b_def_text, cdata(c.def))],
        alt.map(a => btn(a.text, a.data)),
        [btn('✏️ Escribir otro valor', cdata('custom'))],
      ],
    });
  };

  const resumen = () => {
    u.paso = 'listo';
    return salir('resumen', {
      texto: `✅ Listo. Estos son tus requisitos:\n\n${fmtResumen(u.req)}\n\nPuedes cambiarlos cuando quieras con /requisitos.`,
      teclado: TECLADO_RESUMEN,
    });
  };

  const guardarYSeguir = (campo, valor) => {
    u.req = u.req || defaults();
    u.req[CAMPOS[campo].clave] = valor;
    const sig = ORDEN[ORDEN.indexOf(campo) + 1];
    return sig ? preguntar(sig) : resumen();
  };

  const intentarValor = (campo, bruto) => {
    const c = CAMPOS[campo];
    const v = Number(String(bruto).replace(',', '.'));
    if (!isFinite(v) || String(bruto).trim() === '' || v < c.min || v > c.max) {
      return salir('texto', { texto: `⚠️ "${bruto}" no es válido para ${c.titulo.toLowerCase()}. Escribe un número entre ${c.min} y ${c.max} ${c.unidad}.` });
    }
    return guardarYSeguir(campo, v);
  };

  const iniciarConfig = (t) => { u.paso = 'nuevo'; return salir('bienvenida', { texto: t, teclado: TECLADO_BIENVENIDA }); };
  const pedirPrevision = () => u.req
    ? salir('prevision')
    : salir('texto', { texto: 'Aún no has configurado tus requisitos. Escribe /start para empezar.' });

  // ---- Botones ----
  if (data) {
    if (data === 'start:defaults') { u.req = defaults(); return resumen(); }
    if (data === 'start:custom') { u.req = u.req || defaults(); return preguntar('nieve'); }
    if (data === 'prev') return pedirPrevision();
    const m = data.match(/^v:(\w+):(.+)$/);
    if (m && CAMPOS[m[1]]) {
      const [, campo, val] = m;
      if (val === 'custom') {
        u.paso = campo;
        return salir('texto', { texto: `✏️ Escríbeme el valor de ${CAMPOS[campo].titulo.toLowerCase()} (en ${CAMPOS[campo].unidad}).` });
      }
      return intentarValor(campo, val);
    }
    return salir('texto', { texto: 'Ese botón ya no está activo. Escribe /ayuda.' });
  }

  // ---- Comandos ----
  if (texto.startsWith('/')) {
    const cmd = texto.split(/\s|@/)[0].toLowerCase();
    if (cmd === '/start') return iniciarConfig('👋 ¡Hola! Soy NevadaRadar ❄️\nTe aviso de los días buenos para esquiar en Sierra Nevada según TUS requisitos (nieve, viento y temperatura).\n\n¿Cómo quieres configurarlos?');
    if (cmd === '/requisitos') return iniciarConfig('⚙️ Vamos a cambiar tus requisitos. ¿Cómo quieres hacerlo?');
    if (cmd === '/prevision') return pedirPrevision();
    if (cmd === '/borrar') { delete estado.users[chat_id]; return salir('texto', { texto: '🗑️ He borrado tus datos. Escribe /start si quieres volver a empezar.', req: null }); }
    if (cmd === '/ayuda') return salir('texto', { texto: TEXTO_AYUDA });
    return salir('texto', { texto: 'No conozco ese comando.\n\n' + TEXTO_AYUDA });
  }

  // ---- Texto libre: un valor escrito mientras se configura ----
  if (CAMPOS[u.paso]) return intentarValor(u.paso, texto);
  return salir('texto', { texto: TEXTO_AYUDA });
}

// @n8n-fin  (lo de abajo no se incrusta en n8n)
module.exports = { procesar, CAMPOS, ORDEN, defaults };
