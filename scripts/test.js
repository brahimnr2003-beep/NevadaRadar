// Prueba la lógica del bot en local, sin n8n: node scripts/test.js
// Simula conversaciones (core/cerebro.js) y la evaluación con datos simulados (core/evaluar.js).
// Ejecuta el MISMO código que se incrusta en los nodos Code de n8n (scripts/codigo-n8n.js)
// y, al final, comprueba los módulos de core/ directamente, que es lo que usará el Worker.
const fs = require('fs');
const assert = require('assert');
const leer = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const codigo = require('./codigo-n8n');
const cerebroCode = codigo.cerebro();
const evaluarCode = codigo.evaluar();
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

// 5) Los módulos de core/ directamente (lo que usa el Worker): mismo resultado que en n8n y teclados desde código
const core = require('../core/cerebro');
const { evaluar: evaluarCore } = require('../core/evaluar');
const estado = {};
const dir = (update) => core.procesar(update, estado);
let c = dir(mensaje(5, '/start'));
assert.equal(c.accion, 'bienvenida'); assert.equal(c.teclado[0][0].callback_data, 'start:defaults'); assert.equal(c.callback_id, null);
c = dir(boton(5, 'start:custom'));
assert.equal(c.accion, 'pregunta'); assert.equal(c.callback_id, 'cb1');
assert.deepEqual(c.teclado.map(f => f.length), [1, 3, 1]);               // predeterminado / 3 alternativas / escribir
assert.equal(c.teclado[0][0].callback_data, c.b_def_data);                // coincide con los campos b_* que usa n8n
assert.equal(dir(boton(5, 'start:defaults')).teclado[0][0].callback_data, 'prev'); // el resumen ofrece "Ver previsión"
assert.equal(dir(boton(5, 'prev')).accion, 'prevision');
const e1 = evaluarCore(mock.daily, estado.users[5].req, 5);
const e2 = evaluarCore(mock.daily, estado.users[5].req, 5);
assert.deepEqual(e1, e2);
assert.equal(e1.caption, pB.caption);                                      // mismos requisitos predeterminados que el usuario B
assert.equal(e1.calendar_url, pB.calendar_url);
assert.equal(dir(mensaje(5, 'hola')).accion, 'texto');

console.log('\n✅ Todas las pruebas pasan');
