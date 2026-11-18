// Genera el cuerpo de los nodos Code de n8n a partir de los módulos de core/.
// n8n no puede importar archivos, así que se incrusta el código de core/ (hasta el marcador
// "@n8n-fin", que deja fuera el module.exports) y se añade el pegamento que lee/escribe datos de n8n.
const fs = require('fs');
const nucleo = (f) => fs.readFileSync(__dirname + '/../core/' + f, 'utf8').split('// @n8n-fin')[0];

exports.cerebro = () =>
  nucleo('cerebro.js') +
  "\nreturn [{ json: procesar($input.first().json, $getWorkflowStaticData('global')) }];\n";

exports.evaluar = () =>
  nucleo('evaluar.js') +
  "\nconst cerebro = $('Cerebro').first().json;\n" +
  'return [{ json: evaluar($input.first().json.daily, cerebro.req, cerebro.chat_id) }];\n';
