'use strict';
/* Índices de correção monetária: IGP-M e IPCA (Banco Central, SGS) e UFIR-RJ (valor anual, SEFAZ-RJ) */

const SERIES_BCB = { 'IGP-M': 189, 'IPCA': 433 };
const INDICES = ['UFIR-RJ', 'IGP-M', 'IPCA', 'Nenhum'];

// Valores anuais da UFIR-RJ (fonte: SEFAZ-RJ). Novos anos podem ser incluídos em Configurações.
const UFIR_RJ_PADRAO = {
  2000: 1.0641, 2001: 1.1283, 2002: 1.2130, 2003: 1.3584, 2004: 1.4924, 2005: 1.6049, 2006: 1.6992,
  2007: 1.7495, 2008: 1.8258, 2009: 1.9372, 2010: 2.0183, 2011: 2.1352, 2012: 2.2752, 2013: 2.4066,
  2014: 2.5473, 2015: 2.7119, 2016: 3.0023, 2017: 3.1999, 2018: 3.2939, 2019: 3.4211, 2020: 3.5550,
  2021: 3.7053, 2022: 4.0915, 2023: 4.3329, 2024: 4.5373, 2025: 4.7508, 2026: 4.9604,
};
const tabelaUfir = () => ({ ...UFIR_RJ_PADRAO, ...(D.indices?.ufirRJ || {}) });

/*
  Fator de correção entre a data inicial (vencimento ou pagamento) e a data do cálculo.
  - IGP-M / IPCA: acumula a variação mensal do mês da data inicial até o mês anterior ao do cálculo.
  - UFIR-RJ: UFIR-RJ do ano do cálculo ÷ UFIR-RJ do ano da data inicial.
  Devolve { fator, faltando: ['AAAA-MM' ou 'AAAA'] }.
*/
function fatorCorrecao(indice, dataIni, dataCalc, ignorarNegativos) {
  const faltando = [];
  if (!indice || indice === 'Nenhum' || !dataIni || dataIni >= dataCalc) return { fator: 1, faltando };
  if (indice === 'UFIR-RJ') {
    const t = tabelaUfir(), a0 = +dataIni.slice(0, 4);
    let a1 = +dataCalc.slice(0, 4);
    if (!t[a0]) { faltando.push(String(a0)); return { fator: 1, faltando }; }
    if (!t[a1]) {
      faltando.push(String(a1));
      while (a1 > a0 && !t[a1]) a1--;
    }
    return { fator: Math.round(t[a1] / t[a0] * 1e6) / 1e6, faltando };
  }
  const serie = D.indices?.series?.[indice] || {};
  const mesIni = dataIni.slice(0, 7), mesCalc = dataCalc.slice(0, 7);
  let f = 1;
  for (let m = mesIni; m < mesCalc; m = addMes(m, 1)) {
    const v = serie[m];
    if (v === undefined || v === null) { faltando.push(m); continue; }
    if (ignorarNegativos && v < 0) continue;
    f *= 1 + v / 100;
  }
  return { fator: Math.round(f * 1e6) / 1e6, faltando };
}

const descFaltando = lista => lista.map(m => m.length === 4 ? m : mesNum(m)).join(', ');

/* ---------- Banco Central ---------- */
async function buscarSerieBCB(codigo, desdeAno) {
  const ultimo = new Date().getFullYear(), blocos = [];
  for (let a = desdeAno; a <= ultimo; a += 10) blocos.push([a, Math.min(a + 9, ultimo)]);
  const partes = await Promise.all(blocos.map(async ([de, ate]) => {
    let r;
    try { r = await fetch(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${codigo}/dados?formato=json&dataInicial=01/01/${de}&dataFinal=31/12/${ate}`); }
    catch { throw new Error('Não foi possível acessar o Banco Central. Verifique a conexão com a internet.'); }
    if (r.status === 404) return [];
    if (!r.ok) throw new Error(`Banco Central: erro ${r.status}.`);
    return r.json();
  }));
  const valores = {};
  for (const { data, valor } of partes.flat()) {
    const [, m, y] = data.split('/');
    valores[`${y}-${m}`] = Number(valor);
  }
  return valores;
}

async function salvarIndices(mudar) {
  const atual = JSON.parse(await Armaz.ler('indices.json') || '{"series":{}}');
  atual.series = atual.series || {};
  mudar(atual);
  atual.atualizadoEm = new Date().toISOString();
  await Armaz.gravar('indices.json', JSON.stringify(atual));
  D.indices = atual;
}

async function atualizarIndicesBCB(nomes = Object.keys(SERIES_BCB)) {
  const res = await Promise.all(nomes.map(async nome => {
    const meses = Object.keys(D.indices?.series?.[nome] || {}).sort();
    const desde = meses.length ? +meses[meses.length - 1].slice(0, 4) - 1 : 1995;
    return [nome, await buscarSerieBCB(SERIES_BCB[nome], desde)];
  }));
  const recebidos = res.filter(([, v]) => Object.keys(v).length);
  if (!recebidos.length) throw new Error('O Banco Central não retornou dados.');
  await salvarIndices(a => { for (const [n, v] of recebidos) a.series[n] = { ...(a.series[n] || {}), ...v }; });
  return Object.fromEntries(res.map(([n, v]) => [n, Object.keys(v).length]));
}

// Atualiza em silêncio quando falta o mês anterior ao atual (no máximo a cada 6 horas neste computador)
let atualizandoIndices = null;
function garantirIndices() {
  if (atualizandoIndices) return atualizandoIndices;
  const precisa = addMes(mesAtual(), -1);
  const nomes = Object.keys(SERIES_BCB).filter(n => (D.indices?.series?.[n] || {})[precisa] === undefined
    && Date.now() - +(localStorage.getItem('cc-idx-' + n) || 0) > 6 * 3600e3);
  if (!nomes.length) return Promise.resolve();
  nomes.forEach(n => localStorage.setItem('cc-idx-' + n, String(Date.now())));
  atualizandoIndices = atualizarIndicesBCB(nomes).catch(e => console.warn('Índices', e)).finally(() => { atualizandoIndices = null; });
  return atualizandoIndices;
}

/* ---------- Tela (em Configurações) ---------- */
function secaoIndicesHTML() {
  const linhas = Object.keys(SERIES_BCB).map(nome => {
    const s = D.indices?.series?.[nome] || {};
    const meses = Object.keys(s).sort(), u = meses[meses.length - 1];
    return `<tr><td><b>${nome}</b></td><td>${meses.length ? nomeMes(meses[0]) + ' a ' + nomeMes(u) : '—'}</td>
      <td class="num">${u ? fmtPct(s[u]) + '%' : ''}</td><td><button class="bt pequeno" data-idx="${nome}">Atualizar</button></td></tr>`;
  }).join('');
  const t = tabelaUfir(), anos = Object.keys(t).sort().reverse();
  return `<section class="cartao" id="secIndices">
    <h2>Índices de correção monetária</h2>
    <p class="dica">IGP-M e IPCA: variações mensais do Banco Central, atualizadas automaticamente. O fator acumula as variações do mês do vencimento até o mês anterior ao do cálculo.
      UFIR-RJ: valor anual publicado pela SEFAZ-RJ. O fator é a UFIR-RJ do ano do cálculo dividida pela UFIR-RJ do ano do vencimento.</p>
    <div class="rolagem"><table class="tabela"><thead><tr><th>Índice</th><th>Período disponível</th><th class="num">Último mês</th><th></th></tr></thead><tbody>${linhas}
      <tr><td><b>UFIR-RJ</b></td><td>${anos[anos.length - 1]} a ${anos[0]}</td><td class="num">${String(t[anos[0]]).replace('.', ',')}</td><td></td></tr></tbody></table></div>
    <div class="acoes-linha"><button class="bt" id="btIdxTodos">Atualizar IGP-M e IPCA pelo Banco Central</button></div>
    <details class="detalhes"><summary>UFIR-RJ: valores por ano</summary>
      <p class="dica">Inclua o valor de cada novo ano quando a SEFAZ-RJ divulgar (normalmente em dezembro). Uma linha por ano, no formato <b>AAAA;valor</b> (ex.: <code>2027;5,1234</code>).</p>
      <div class="ufir-grade">${anos.map(a => `<span><b>${a}</b> ${String(t[a]).replace('.', ',')}</span>`).join('')}</div>
      <textarea id="ufirManual" rows="3" placeholder="2027;5,1234"></textarea>
      <div class="acoes-linha"><button class="bt" id="btUfir">Gravar valores da UFIR-RJ</button></div>
    </details>
    <details class="detalhes"><summary>Informar IGP-M ou IPCA manualmente</summary>
      <p class="dica">Uma linha por mês, no formato <b>MM/AAAA;variação %</b> (ex.: <code>09/2026;0,45</code>). Também é possível colar duas colunas copiadas de uma planilha.</p>
      <select id="idxManualNome" style="max-width:200px">${Object.keys(SERIES_BCB).map(n => `<option>${n}</option>`).join('')}</select>
      <textarea id="idxManual" rows="4" placeholder="09/2026;0,45"></textarea>
      <div class="acoes-linha"><button class="bt" id="btIdxManual">Incluir valores</button></div>
    </details>
  </section>`;
}

function ligarIndices() {
  const redesenhar = () => { $('#secIndices').outerHTML = secaoIndicesHTML(); ligarIndices(); };
  const atualizar = async (bt, nomes) => {
    bt.disabled = true; bt.textContent = 'Buscando…';
    try {
      const qtd = await atualizarIndicesBCB(nomes);
      aviso('Recebido do Banco Central: ' + Object.entries(qtd).map(([n, q]) => `${n} (${q} meses)`).join(', ') + '.');
    } finally { redesenhar(); }
  };
  $$('[data-idx]').forEach(b => b.addEventListener('click', () => executar(() => atualizar(b, [b.dataset.idx]))));
  $('#btIdxTodos').addEventListener('click', e => executar(() => atualizar(e.target)));
  $('#btUfir').addEventListener('click', () => executar(async () => {
    const v = {};
    for (const l of $('#ufirManual').value.split(/\r?\n/)) {
      const m = l.match(/(\d{4})\D+(\d+(?:[.,]\d+)?)/);
      if (m) v[m[1]] = Number(m[2].replace(',', '.'));
    }
    if (!Object.keys(v).length) throw new Error('Nenhuma linha no formato AAAA;valor.');
    await salvarIndices(a => { a.ufirRJ = { ...(a.ufirRJ || {}), ...v }; });
    aviso(`UFIR-RJ: ${Object.keys(v).length} ano(s) gravado(s).`);
    redesenhar();
  }));
  $('#btIdxManual').addEventListener('click', () => executar(async () => {
    const v = {};
    for (const l of $('#idxManual').value.split(/\r?\n/)) {
      const m = l.match(/(\d{1,2})[\/.-](\d{4})\D+?(-?\d+(?:[.,]\d+)?)/) || l.match(/(\d{4})-(\d{2})\D+?(-?\d+(?:[.,]\d+)?)/);
      if (!m) continue;
      const [mes, ano] = m[1].length === 4 ? [m[2], m[1]] : [m[1], m[2]];
      v[`${ano}-${p2(+mes)}`] = Number(m[3].replace(',', '.'));
    }
    if (!Object.keys(v).length) throw new Error('Nenhuma linha no formato MM/AAAA;variação.');
    const nome = $('#idxManualNome').value;
    await salvarIndices(a => { a.series[nome] = { ...(a.series[nome] || {}), ...v }; });
    aviso(`${nome}: ${Object.keys(v).length} mês(es) incluído(s).`);
    redesenhar();
  }));
}
