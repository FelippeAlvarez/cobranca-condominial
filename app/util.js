'use strict';
/* Utilidades: formatação, datas, interface */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const p2 = n => String(n).padStart(2, '0');
const cent = v => Math.round((Number(v) || 0) * 100);
const r2 = v => cent(v) / 100;
const fmtNum = v => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtMoeda = v => 'R$ ' + fmtNum(v);
const fmtPct = v => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
const fmtFator = v => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 6, maximumFractionDigits: 6 });
const comparar = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'pt-BR', { numeric: true, sensitivity: 'base' });
const semAcento = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const normalizar = s => semAcento(s).toLowerCase().replace(/\s+/g, ' ').trim();
const soDigitos = s => String(s ?? '').replace(/\D/g, '');

// Aceita "1.234,56", "1234.56", "R$ 1.234,56", números
function parseValor(s) {
  if (typeof s === 'number') return s;
  s = String(s ?? '').replace(/R\$|\s/g, '');
  if (!s) return 0;
  let neg = false;
  if (s.startsWith('-') || /^\(.*\)$/.test(s)) { neg = true; s = s.replace(/^-|[()]/g, ''); }
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (!/^\d+\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : (neg ? -n : n);
}

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const nomeMes = ym => { if (!ym) return ''; const [a, m] = ym.split('-'); return MESES[+m - 1] + '/' + a; };
const mesNum = ym => ym ? ym.slice(5, 7) + '/' + ym.slice(0, 4) : '';
function addMes(ym, n) {
  let [a, m] = ym.split('-').map(Number);
  m += n;
  while (m > 12) { m -= 12; a++; }
  while (m < 1) { m += 12; a--; }
  return a + '-' + p2(m);
}
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const mesAtual = () => hoje().slice(0, 7);
const fmtData = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '';
const ehMes = s => /^\d{4}-(0[1-9]|1[0-2])$/.test(s || '');
const ehData = s => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s || '');
const ultimoDia = ym => { const [a, m] = ym.split('-').map(Number); return new Date(Date.UTC(a, m, 0)).getUTCDate(); };
// Dia "d" do mês "ym", limitado ao último dia do mês (ex.: dia 31 em fevereiro)
const diaDoMes = (ym, d) => `${ym}-${p2(Math.min(Math.max(1, +d || 1), ultimoDia(ym)))}`;
function diasEntre(de, ate) {
  const d = s => { const [a, m, dd] = s.split('-').map(Number); return Date.UTC(a, m - 1, dd); };
  return Math.round((d(ate) - d(de)) / 864e5);
}

// CPF/CNPJ formatado (se tiver a quantidade certa de dígitos)
function fmtDoc(s) {
  const d = soDigitos(s);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return String(s ?? '').trim();
}
const rotuloDoc = s => soDigitos(s).length === 14 ? 'CNPJ' : 'CPF';

/* ---------- Interface ---------- */
function aviso(msg, tipo = 'ok') {
  const a = $('#aviso');
  a.textContent = msg;
  a.className = 'aviso mostrar ' + tipo;
  clearTimeout(a._t);
  a._t = setTimeout(() => { a.className = 'aviso'; }, tipo === 'erro' ? 9000 : 3500);
}

class ErroConflito extends Error {
  constructor(m) {
    super(m || 'Este registro foi alterado em outro computador enquanto você editava. Os dados foram recarregados: confira e refaça a alteração.');
    this.conflito = true;
  }
}

async function executar(fn) {
  try { return await fn(); }
  catch (e) {
    console.error(e);
    if (e.name === 'AbortError') return;
    aviso(e.message || String(e), 'erro');
    if (e.conflito) { sujo = false; await recarregarTudo(); rotear(); }
  }
}

function baixar(blob, nome) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

function abrirModal(html, classe = '') {
  $('#modalCaixa').className = 'modal-caixa ' + classe;
  $('#modalCaixa').innerHTML = html;
  $('#modal').hidden = false;
}
function fecharModal() { $('#modal').hidden = true; $('#modalCaixa').innerHTML = ''; }

// Pergunta com botões; devolve a escolha (ou null se fechar)
function perguntar(titulo, html, botoes) {
  return new Promise(ok => {
    abrirModal(`<div class="modal-cab"><h2>${esc(titulo)}</h2><button class="bt-x" data-resp="">&times;</button></div>
      <div>${html}</div><div class="acoes-linha">${botoes.map(([v, r, cls]) => `<button class="bt ${cls || ''}" data-resp="${esc(v)}">${esc(r)}</button>`).join('')}</div>`, 'modal-medio');
    $$('[data-resp]', $('#modalCaixa')).forEach(b => b.addEventListener('click', () => { fecharModal(); ok(b.dataset.resp || null); }));
  });
}

const nomeArquivo = (...partes) => partes.filter(Boolean).join('-').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 100);

/* ---------- Ícones (traço, 24×24) e tema ---------- */
const ICONES = {
  inicio: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  mais: 'M12 5v14M5 12h14',
  predio: 'M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h3a1 1 0 0 1 1 1v11M2 21h20M8 7h4M8 11h4M8 15h4',
  pessoas: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  porta: 'M3 21h18M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M14 12h.01',
  tabela: 'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM3 9h18M3 15h18M9 3v18',
  acordo: 'M8 12l3 3 5-6M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  escudo: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  config: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  livro: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14zM20 17v4H6.5',
  pessoa: 'M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  busca: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  baixar: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  arquivo: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h4',
  olho: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  alta: 'M23 6l-9.5 9.5-5-5L1 18M17 6h6v6',
  alerta: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  calendario: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  balanca: 'M12 3v18M7 21h10M4 7h16M7 7l-3 7a3 3 0 0 0 6 0zM17 7l-3 7a3 3 0 0 0 6 0z',
  dinheiro: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  recibo: 'M4 2v20l3-2 3 2 3-2 3 2 3-2 3 2V2l-3 2-3-2-3 2-3-2-3 2zM8 8h8M8 12h8M8 16h5',
  pct: 'M19 5 5 19M6.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM17.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  lua: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
  sol: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42',
  menu: 'M3 6h18M3 12h18M3 18h18',
  seta: 'M9 18l6-6-6-6',
  voltar: 'M15 18l-6-6 6-6',
  instalar: 'M12 3v12M7 10l5 5 5-5M5 21h14',
};
const ic = (nome, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONES[nome] || ''}"/></svg>`;

// Tema: 'claro', 'escuro' ou automático (vazio: segue o aparelho)
const temaEscuro = () => document.documentElement.dataset.tema ? document.documentElement.dataset.tema === 'escuro' : matchMedia('(prefers-color-scheme: dark)').matches;
function aplicarTema(t) {
  document.documentElement.dataset.tema = t || '';
  const escuro = temaEscuro();
  $$('.bt-tema').forEach(b => { b.innerHTML = ic(escuro ? 'sol' : 'lua'); b.title = escuro ? 'Usar o tema claro' : 'Usar o tema escuro'; });
  $('meta[name=theme-color]')?.setAttribute('content', escuro ? '#0b1420' : '#1f4e79');
}
function alternarTema() {
  const t = temaEscuro() ? 'claro' : 'escuro';
  localStorage.setItem('cc-tema', t);
  aplicarTema(t);
}
