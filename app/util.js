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
