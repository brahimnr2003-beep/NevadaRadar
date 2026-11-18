// Prueba la lógica del bot en local, sin n8n: node scripts/test.js
// Simula una conversación (cerebro.js) y la evaluación con datos simulados (evaluar-dias.js).
const fs = require('fs');
const assert = require('assert');
const leer = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const cerebroCode = leer('src/cerebro.js');
const evaluarCode = leer('src/evaluar-dias.js');
const mock = JSON.parse(leer('data/mock-open-meteo.json'));

// --- Simulación del entorno de n8n para el nodo Cerebro ---
const memoria = {}; // hace de $getWorkflowStaticData('global')
const mensaje = (chat_id, text, type = 'private') => ({ message: { chat: { id: chat_id, type }, text } });
const boton = (chat_id, data) => ({ callback_query: { id: 'cb1', data, message: { chat: { id: chat_id, type: 'private' } } } });
const cerebro = (update) => {
  const $input = { first: () => ({ json: update }) };
  return new Function('$input', '$getWorkflowStaticData', cerebroCode)($input, () => memoria)[0].json;
};
const mostrar = (titulo, r) => console.log(`\n▶ ${titulo}\n  accion=${r.accion}\n  ${String(r.texto).replace(/\n/g, '\n  ')}`);

// 1) Usuario A: configuración personalizada completa, con valor escrito a mano
let r = cerebro(mensaje(1, '/start'));          mostrar('A: /start', r);            assert.equal(r.accion, 'bienvenida');
r = cerebro(boton(1, 'start:custom'));          mostrar('A: Personalizar', r);      assert.equal(r.accion, 'pregunta'); assert.equal(r.b_def_data, 'v:nieve:5');
r = cerebro(boton(1, 'v:nieve:custom'));        mostrar('A: Escribir otro valor', r); assert.equal(r.accion, 'texto');
r = cerebro(mensaje(1, 'abc'));                 mostrar('A: escribe "abc"', r);     assert.match(r.texto, /no es válido/);
r = cerebro(mensaje(1, '999'));                 mostrar('A: escribe "999"', r);     assert.match(r.texto, /no es válido/);
r = cerebro(mensaje(1, '30'));                  mostrar('A: escribe "30"', r);      assert.equal(r.accion, 'pregunta'); assert.match(r.texto, /^2\/5/);
r = cerebro(boton(1, 'v:viento:25'));           assert.equal(r.accion, 'pregunta');
r = cerebro(boton(1, 'v:rachas:60'));           assert.equal(r.accion, 'pregunta');
r = cerebro(mensaje(1, '-9,5'));                assert.equal(r.accion, 'pregunta'); // coma decimal y valor negativo
r = cerebro(boton(1, 'v:tmax:3'));              mostrar('A: último valor', r);      assert.equal(r.accion, 'resumen');
assert.deepEqual(memoria.users[1].req, { minNieveNueva: 30, maxViento: 25, maxRachas: 60, tempMin: -9.5, tempMax: 3 });

// 2) Usuario B: todo predeterminado, es independiente de A
r = cerebro(mensaje(2, '/prevision'));          mostrar('B: /prevision sin configurar', r); assert.equal(r.accion, 'texto');
r = cerebro(boton(2, 'start:defaults'));        mostrar('B: predeterminados', r);   assert.equal(r.accion, 'resumen');
assert.equal(memoria.users[2].req.minNieveNueva, 5);
assert.equal(memoria.users[1].req.minNieveNueva, 30);

// 3) Previsión de A y de B con los mismos datos: distinto resultado según requisitos
const evaluar = (resultadoCerebro) => {
  const $input = { first: () => ({ json: mock }) };
  const $ = () => ({ first: () => ({ json: resultadoCerebro }) });
  return new Function('$input', '$', evaluarCode)($input, $)[0].json;
};
const rA = cerebro(mensaje(1, '/prevision')); assert.equal(rA.accion, 'prevision');
const rB = cerebro(mensaje(2, '/prevision')); assert.equal(rB.accion, 'prevision');
const pA = evaluar(rA), pB = evaluar(rB);
console.log('\n▶ Previsión usuario A (exigente: 30 cm)\n' + pA.caption);
console.log('\n▶ Previsión usuario B (predeterminados)\n' + pB.caption);
console.log(`\nLongitud URL gráfico: ${pB.chart_url.length} caracteres`);
assert.notEqual(pA.caption, pB.caption);
assert(pB.chart_url.length < 3000, 'URL del gráfico demasiado larga');
assert(pB.caption.length <= 1024, 'El texto supera el límite de Telegram (1024)');
assert.equal(pB.chat_id, 2);
assert(pB.calendar_url.startsWith('https://quickchart.io/chart'), 'falta la URL del calendario');
console.log('Longitud URL calendario: ' + pB.calendar_url.length + ' caracteres');

// 4) Comandos varios y chats que no son privados
r = cerebro(mensaje(1, '/ayuda@PowderBot'));    assert.equal(r.accion, 'texto');
r = cerebro(mensaje(1, '/requisitos'));         assert.equal(r.accion, 'bienvenida');
r = cerebro(mensaje(9, 'hola', 'group'));       assert.equal(r.accion, 'ignorar');
r = cerebro(mensaje(1, '/borrar'));             assert.equal(memoria.users[1], undefined);
r = cerebro(mensaje(1, '/prevision'));          assert.match(r.texto, /\/start/);

console.log('\n✅ Todas las pruebas pasan');
