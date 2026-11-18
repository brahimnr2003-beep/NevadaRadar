'use strict';
// ====== EVALUAR DÍAS: previsión de Open-Meteo + requisitos de un usuario -> imágenes y texto ======
// evaluar(daily, req, chat_id) devuelve { chat_id, chart_url, calendar_url, caption, calendar_caption }.
// Lo usan n8n (el build incrusta este archivo en el nodo Code "Evaluar días") y el Worker de Cloudflare.

const DIAS_FIABLES = 7; // pasado este día, la previsión es orientativa
const DIA_CORTO = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const DIA_LARGO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const RGB = { verde: '46,204,113', amarillo: '241,196,15', rojo: '231,76,60' };

function evaluar(d, REQ, chat_id) {
  const dias = d.time.map((fecha, i) => {
    const fallos = [];
    if (d.snowfall_sum[i] < REQ.minNieveNueva) fallos.push(`nieve ${d.snowfall_sum[i]} cm`);
    if (d.wind_speed_10m_max[i] > REQ.maxViento) fallos.push(`viento ${Math.round(d.wind_speed_10m_max[i])} km/h`);
    if (d.wind_gusts_10m_max[i] > REQ.maxRachas) fallos.push(`rachas ${Math.round(d.wind_gusts_10m_max[i])} km/h`);
    if (d.temperature_2m_min[i] < REQ.tempMin) fallos.push(`mín ${Math.round(d.temperature_2m_min[i])}°C`);
    if (d.temperature_2m_max[i] > REQ.tempMax) fallos.push(`máx ${Math.round(d.temperature_2m_max[i])}°C`);
    const color = fallos.length === 0 ? 'verde' : fallos.length === 1 ? 'amarillo' : 'rojo';
    const dt = new Date(fecha + 'T12:00:00');
    return {
      i, fallos, color, orientativo: i >= DIAS_FIABLES,
      etiqueta: `${DIA_CORTO[dt.getDay()]} ${dt.getDate()}`,
      nombre: `${DIA_LARGO[dt.getDay()]} ${dt.getDate()}/${dt.getMonth() + 1}`,
      nieve: d.snowfall_sum[i], viento: Math.round(d.wind_speed_10m_max[i]),
      tmin: Math.round(d.temperature_2m_min[i]), tmax: Math.round(d.temperature_2m_max[i]),
    };
  });

  // ---- Gráfico (QuickChart): barras de nieve por día, coloreadas según los requisitos ----
  const colores = dias.map(x => `rgba(${RGB[x.color]},${x.orientativo ? 0.4 : 1})`);
  const config = {
    type: 'bar',
    data: {
      labels: dias.map(x => x.etiqueta),
      datasets: [
        { label: 'Nieve nueva (cm)', data: dias.map(x => x.nieve), backgroundColor: colores },
        { type: 'line', label: `Tu mínimo (${REQ.minNieveNueva} cm)`, data: dias.map(() => REQ.minNieveNueva),
          borderColor: '#34495e', borderWidth: 2, borderDash: [6, 4], fill: false, pointRadius: 0 },
      ],
    },
    options: {
      title: { display: true, text: `Nieve nueva por día (cm) · línea discontinua: tu mínimo, ${REQ.minNieveNueva} cm` },
      legend: { display: false },
      scales: { yAxes: [{ ticks: { beginAtZero: true } }] },
    },
  };
  const chart_url = 'https://quickchart.io/chart?v=2&w=800&h=450&backgroundColor=white&c=' +
    encodeURIComponent(JSON.stringify(config));

  // ---- Calendario (QuickChart): cuadrícula L-D con los días aptos y no aptos ----
  const primero = new Date(d.time[0] + 'T12:00:00');
  const ultimo = new Date(d.time[d.time.length - 1] + 'T12:00:00');
  const mesTitulo = primero.getMonth() === ultimo.getMonth()
    ? `${MESES[primero.getMonth()]} ${primero.getFullYear()}`
    : `${MESES[primero.getMonth()]}–${MESES[ultimo.getMonth()]} ${ultimo.getFullYear()}`;
  const offset = (primero.getDay() + 6) % 7; // lunes = 0
  const celdas = dias.map(x => {
    const pos = offset + x.i;
    return { x: pos % 7, y: Math.floor(pos / 7), d: Number(d.time[x.i].slice(8)),
             t: x.color === 'amarillo' || x.orientativo ? '#2c3e50' : '#ffffff' };
  });
  const filas = Math.floor((offset + dias.length - 1) / 7) + 1;
  const calConfig = {
    type: 'scatter',
    data: { datasets: [{
      data: celdas, pointStyle: 'rectRounded', pointRadius: 34, pointHoverRadius: 34,
      backgroundColor: colores,
      borderColor: dias.map(x => (x.i === 0 ? '#2c3e50' : 'rgba(0,0,0,0)')), borderWidth: 3, // hoy: borde oscuro
    }] },
    options: {
      legend: { display: false },
      title: { display: true, text: `Calendario · ${mesTitulo}`, fontSize: 18 },
      layout: { padding: 10 },
      scales: {
        xAxes: [{ position: 'top', gridLines: { display: false, drawBorder: false },
                  ticks: { min: -0.6, max: 6.6, stepSize: 1, fontSize: 15, fontStyle: 'bold', callback: '__F_DIAS__' } }],
        yAxes: [{ gridLines: { display: false, drawBorder: false },
                  ticks: { reverse: true, min: -0.6, max: filas - 0.4, display: false } }],
      },
      plugins: { datalabels: { color: '__F_COLOR__', font: { size: 17, weight: 'bold' }, formatter: '__F_NUM__' } },
    },
  };
  const calendar_url = `https://quickchart.io/chart?v=2&w=720&h=${filas * 88 + 110}&backgroundColor=white&c=` +
    encodeURIComponent(JSON.stringify(calConfig)
      .replace('"__F_DIAS__"', "function(v){return ['L','M','X','J','V','S','D'][v]||''}")
      .replace('"__F_COLOR__"', 'function(c){return c.dataset.data[c.dataIndex].t}')
      .replace('"__F_NUM__"', 'function(v){return v.d}'));

  // ---- Texto bajo las imágenes ----
  const aptos = dias.filter(x => x.color === 'verde');
  const mejor = [...dias].sort((a, b) => a.fallos.length - b.fallos.length || b.nieve - a.nieve || a.i - b.i)[0];
  const orient = (x) => (x.orientativo ? ' (orientativo)' : '');

  let caption = '❄️ Sierra Nevada · próximos 16 días\n\n';
  if (aptos.length) {
    caption += `🏆 Tu mejor día: ${mejor.nombre}${orient(mejor)}\n   ${mejor.nieve} cm de nieve · viento ${mejor.viento} km/h · ${mejor.tmin}/${mejor.tmax}°C\n\n`;
    caption += `✅ Días aptos (${aptos.length}): ${aptos.map(x => x.etiqueta + (x.orientativo ? '*' : '')).join(', ')}\n`;
  } else {
    caption += `Ningún día cumple todos tus requisitos.\nLo más cerca: ${mejor.nombre}${orient(mejor)} — falla ${mejor.fallos.join(' y ')}.\n`;
  }
  caption += '\n🟢 cumple todo · 🟡 falla 1 · 🔴 falla 2 o más\n';
  caption += 'Colores claros / *: más allá del día 7, previsión orientativa.\n';
  caption += `\nTus requisitos: ≥${REQ.minNieveNueva} cm · viento ≤${REQ.maxViento} · rachas ≤${REQ.maxRachas} · ${REQ.tempMin}/${REQ.tempMax}°C\nCámbialos con /requisitos`;

  const calendar_caption = '📅 Días aptos y no aptos\n🟢 apto · 🟡 falla 1 requisito · 🔴 no apto (falla 2 o más)\nColores claros: previsión orientativa. Borde oscuro: hoy.';

  return { chat_id, chart_url, calendar_url, caption, calendar_caption };
}

// @n8n-fin  (lo de abajo no se incrusta en n8n)
module.exports = { evaluar };
