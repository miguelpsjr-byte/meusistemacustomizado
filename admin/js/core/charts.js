// Carrega o Chart.js sob demanda e aplica o visual do Admin.
import { CDN } from '../config.js';
let chartPromise;

export async function Chart() {
  if (!chartPromise) {
    chartPromise = import(CDN.chart).then(({ Chart: C, registerables }) => {
      C.register(...registerables);
      C.defaults.font.family = "'Inter','Manrope',Arial,sans-serif";
      C.defaults.font.size = 12;
      C.defaults.color = '#6B7280';
      C.defaults.borderColor = '#EEF1F5';
      C.defaults.plugins.legend.labels.usePointStyle = true;
      C.defaults.plugins.legend.labels.boxWidth = 8;
      C.defaults.plugins.tooltip.backgroundColor = '#1F2937';
      C.defaults.plugins.tooltip.padding = 10;
      C.defaults.plugins.tooltip.cornerRadius = 8;
      C.defaults.maintainAspectRatio = false;
      return C;
    });
  }
  return chartPromise;
}

export const CORES = { laranja: '#F97316', amarelo: '#F59E0B', grafite: '#1F2937', cinza: '#CBD5E1', verde: '#16A34A', vermelho: '#DC2626' };
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
export const eixoBRL = { ticks: { callback: (v) => brl.format(v) }, grid: { color: '#EEF1F5' }, border: { display: false } };
export const tooltipBRL = { callbacks: { label: (c) => `${c.dataset.label || c.label}: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c.parsed.y ?? c.parsed.x ?? c.parsed)}` } };

// Cria (ou recria) um gráfico dentro de um canvas, destruindo o anterior.
export async function grafico(canvas, config) {
  const C = await Chart();
  const existente = C.getChart(canvas);
  existente?.destroy();
  return new C(canvas, config);
}
