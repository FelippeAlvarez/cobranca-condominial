'use strict';
/*
  Importação de planilhas Excel (.xlsx) ou CSV já existentes.
  O usuário escolhe a folha, a linha de títulos e a coluna de cada informação.
  - Destino "cobrança": cotas ou despesas de uma cobrança.
  - Destino "condomínio": cria (ou completa) uma cobrança por unidade, a partir de uma coluna "Unidade".
*/

const CAMPOS_COTA = [
  ['competencia', 'Competência (mês de referência)'], ['vencimento', 'Vencimento'], ['valor', 'Valor *'], ['descricao', 'Descrição'],
];
const CAMPOS_LOTE = [['unidade', 'Unidade *'], ['devedor', 'Devedor (nome)'], ['documento', 'CPF/CNPJ do devedor']];
const CAMPOS_DESPESA = [['data', 'Data do pagamento *'], ['valor', 'Valor *'], ['rubrica', 'Rubrica'], ['descricao', 'Descrição']];

// Palavras usadas para sugerir a coluna de cada campo a partir dos títulos
const PISTAS = {
  competencia: /compet|refer|m[eê]s|per[ií]odo/, vencimento: /venc/, valor: /valor|quantia|cota|r\$/, descricao: /descri|hist[oó]rico|tipo|natureza/,
  unidade: /unid|apto|apart|sala|loja|im[oó]vel/, devedor: /devedor|cond[oô]mino|propriet|nome|morador/, documento: /cpf|cnpj|documento/,
  data: /data|pagamento|pago em/, rubrica: /rubrica|despesa|natureza|tipo/,
};

const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function anoCompleto(a) { a = +a; return a < 100 ? (a < 70 ? 2000 + a : 1900 + a) : a; }

// Data: 'AAAA-MM-DD' (já convertida da planilha), dd/mm/aaaa, dd-mm-aa…
function lerData(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return v > 20000 && v < 80000 ? isoDeSerial(v) : '';
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return ehData(`${m[1]}-${m[2]}-${m[3]}`) ? `${m[1]}-${m[2]}-${m[3]}` : '';
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (m) { const d = `${anoCompleto(m[3])}-${p2(m[2])}-${p2(m[1])}`; return ehData(d) ? d : ''; }
  return '';
}

// Competência: mm/aaaa, mm/aa, jan/24, janeiro/2024, aaaa-mm, data completa
function lerCompetencia(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return v > 20000 && v < 80000 ? isoDeSerial(v).slice(0, 7) : '';
  const s = normalizar(v);
  let m = s.match(/^(\d{4})-(\d{2})/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${m[2]}`;
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (m) return `${anoCompleto(m[3])}-${p2(m[2])}`;
  m = s.match(/^(\d{1,2})[\/.-](\d{2,4})$/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${anoCompleto(m[2])}-${p2(m[1])}`;
  m = s.match(/^([a-zç]{3,})\.?\s*[\/.\- ]?\s*(?:de\s+)?(\d{2,4})$/);
  if (m) { const i = MESES_ABREV.indexOf(m[1].slice(0, 3)); if (i >= 0) return `${anoCompleto(m[2])}-${p2(i + 1)}`; }
  return '';
}

const textoCel = v => v === null || v === undefined ? '' : typeof v === 'number' ? String(v) : String(v).trim();
const mostrarCel = v => typeof v === 'number' ? fmtNum(v).replace(/,00$/, '') : /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? fmtData(v) : textoCel(v);

// Linha de títulos provável: a primeira, entre as 30 primeiras, com 2+ textos que lembram os campos
function sugerirCabecalho(linhas) {
  for (let i = 0; i < Math.min(30, linhas.length); i++) {
    const textos = (linhas[i] || []).filter(v => typeof v === 'string' && v.trim());
    const acertos = textos.filter(t => Object.values(PISTAS).some(re => re.test(normalizar(t)))).length;
    if (acertos >= 2) return i;
  }
  return 0;
}

// Títulos de contagem ("Meses vencidos", "Dias de atraso") não são datas
const NAO_DATA = /meses|dias|qtd|quant|\bn[ºo°]?\b|numero/;
const ehValorCel = v => typeof v === 'number' ? v > 0 : /^-?\(?R?\$?\s*\d{1,3}(\.?\d{3})*,\d{2}\)?$/.test(String(v ?? '').trim());
// Confere se a coluna tem, nas linhas de dados, o tipo de informação esperado
const TESTES = {
  competencia: v => !!lerCompetencia(v),
  vencimento: v => !!lerData(v),
  data: v => !!lerData(v),
  valor: ehValorCel,
};

function sugerirColunas(linhas, cab, campos) {
  const titulos = (linhas[cab] || []).map(textoCel);
  const amostra = linhas.slice(cab + 1, cab + 16);
  const usados = new Set(), mapa = {};
  const temDados = (k, j) => !TESTES[k] || amostra.some(l => TESTES[k](l[j]));
  for (const [k] of campos) {
    const re = PISTAS[k];
    const j = titulos.findIndex((t, j) => {
      if (usados.has(j) || !re || !re.test(normalizar(t))) return false;
      if ((k === 'vencimento' || k === 'data') && NAO_DATA.test(normalizar(t))) return false;
      return temDados(k, j);
    });
    if (j >= 0) { mapa[k] = j; usados.add(j); }
  }
  return mapa;
}

// Dados do cabeçalho da planilha (acima dos títulos): "Unidade: 302", "BL / APTO" com o valor embaixo etc.
function valorDoRotulo(linhas, ate, re) {
  for (let i = 0; i < ate; i++) {
    const l = linhas[i] || [];
    for (let j = 0; j < l.length; j++) {
      const t = textoCel(l[j]);
      if (!t || !re.test(normalizar(t))) continue;
      const depois = t.split(/[:\-–]\s*/).slice(1).join(' ').trim();
      if (depois) return depois;
      const abaixo = textoCel((linhas[i + 1] || [])[j]);
      if (abaixo) return abaixo;
      const dir = l.slice(j + 1).map(textoCel).find(Boolean);
      if (dir) return dir;
    }
  }
  return '';
}

/*
  abrirImportacao({ destino: 'cotas' | 'despesas' | 'lote', aoConcluir, condominioId })
*/
function abrirImportacao(opcoes) {
  const st = { ...opcoes, planilha: null, folha: 0, cab: 0, mapa: {}, dia: 10, fixo: { unidade: '', devedor: '', documento: '' } };
  const campos = () => st.destino === 'despesas' ? CAMPOS_DESPESA : st.destino === 'lote' ? [...CAMPOS_LOTE, ...CAMPOS_COTA] : CAMPOS_COTA;
  const titulo = st.destino === 'despesas' ? 'Importar despesas' : st.destino === 'lote' ? 'Importar cobranças do condomínio' : 'Importar cotas em aberto';
  abrirModal(`<div class="modal-cab"><h2>${titulo}</h2><button class="bt-x" data-fechar>&times;</button></div>
    <p class="dica">${st.destino === 'lote'
      ? 'Cria uma cobrança para cada unidade (ou acrescenta as cotas à cobrança ativa da unidade, se já existir). A unidade pode vir de uma coluna ou ser digitada, quando a planilha for de uma unidade só.'
      : 'Escolha a planilha.'} Aceita Excel (.xlsx), CSV e PDF com texto (PDF escaneado, que é só imagem, não pode ser lido). Depois confira a linha dos títulos e a coluna de cada informação. Linhas sem valor ou de totais são ignoradas.</p>
    <div class="campo-arquivo"><input type="file" id="impArq" accept=".xlsx,.xlsm,.csv,.txt,.xls,.pdf"></div>
    <div id="impCorpo"></div>`, 'modal-grande');
  $('#impArq').addEventListener('change', e => executar(async () => {
    const f = e.target.files[0];
    if (!f) return;
    $('#impCorpo').innerHTML = '<p class="carregando">Lendo o arquivo…</p>';
    try { st.planilha = await lerPlanilha(f); } catch (err) { $('#impCorpo').innerHTML = ''; throw err; }
    st.folha = Math.max(0, st.planilha.folhas.findIndex(x => x.linhas.some(l => l.length)));
    prepararFolha();
  }));

  function prepararFolha() {
    const linhas = st.planilha.folhas[st.folha].linhas;
    st.cab = sugerirCabecalho(linhas);
    st.mapa = sugerirColunas(linhas, st.cab, campos());
    if (st.destino === 'lote') {
      st.fixo.unidade = st.fixo.unidade || valorDoRotulo(linhas, st.cab, /unidade|\bapto\b|apartamento|\bbl\b|bloco|\bsala\b|\bloja\b|\bunid\b/);
      st.fixo.devedor = st.fixo.devedor || valorDoRotulo(linhas, st.cab, /devedor|cond[oô]mino|propriet[aá]rio|morador/);
    }
    desenhar();
  }

  function linhasConvertidas() {
    const linhas = st.planilha.folhas[st.folha].linhas.slice(st.cab + 1);
    const pegar = (l, k) => st.mapa[k] === undefined || st.mapa[k] === '' ? null : l[st.mapa[k]];
    const saida = [], ign = { valor: [], data: [], unidade: [], total: [] };
    linhas.forEach((l, i) => {
      if (!l.some(v => textoCel(v))) return;
      const nLinha = st.cab + i + 2;
      if (l.some(v => typeof v === 'string' && /^\s*(sub[\s-]?)?tota(l|is)\b/i.test(v))) { ign.total.push(nLinha); return; }
      const valor = r2(parseValor(pegar(l, 'valor')));
      if (!(valor > 0)) { ign.valor.push(nLinha); return; }
      if (st.destino === 'despesas') {
        const data = lerData(pegar(l, 'data'));
        if (!data) { ign.data.push(nLinha); return; }
        saida.push({ id: novoId(), data, valor, rubrica: textoCel(pegar(l, 'rubrica')), descricao: textoCel(pegar(l, 'descricao')), corrigir: true });
        return;
      }
      let venc = lerData(pegar(l, 'vencimento'));
      let comp = lerCompetencia(pegar(l, 'competencia'));
      if (!comp && venc) comp = venc.slice(0, 7);
      if (!venc && comp) venc = diaDoMes(comp, st.dia);
      if (!venc) { ign.data.push(nLinha); return; }
      const cota = { id: novoId(), competencia: comp, vencimento: venc, valor, descricao: textoCel(pegar(l, 'descricao')) || 'Cota condominial' };
      if (st.destino === 'lote') {
        const unidade = textoCel(pegar(l, 'unidade')) || st.fixo.unidade.trim();
        if (!unidade) { ign.unidade.push(nLinha); return; }
        saida.push({ unidade, devedor: textoCel(pegar(l, 'devedor')) || st.fixo.devedor.trim(), documento: textoCel(pegar(l, 'documento')) || st.fixo.documento.trim(), cota });
      } else saida.push(cota);
    });
    return { saida, ign };
  }

  function descIgnoradas(ign) {
    const lista = (n, rot) => n.length ? `${n.length} ${rot} (linha${n.length > 1 ? 's' : ''} ${n.slice(0, 10).join(', ')}${n.length > 10 ? '…' : ''})` : '';
    return [lista(ign.valor, 'sem valor'), lista(ign.data, 'sem competência ou vencimento reconhecível'), lista(ign.unidade, 'sem unidade'), lista(ign.total, 'de totais')].filter(Boolean).join('; ');
  }

  function desenhar() {
    const pl = st.planilha, linhas = pl.folhas[st.folha].linhas;
    const ncol = Math.max(1, ...linhas.slice(0, 300).map(l => l.length));
    const titulos = Array.from({ length: ncol }, (_, j) => textoCel((linhas[st.cab] || [])[j]));
    const opcoesCol = sel => `<option value="">— não usar —</option>` + titulos.map((t, j) => `<option value="${j}" ${String(sel) === String(j) ? 'selected' : ''}>${colunaXLSX(j)}${t ? ': ' + esc(t.slice(0, 40)) : ''}</option>`).join('');
    const prev = linhas.slice(0, 60).map((l, i) => `<tr class="${i === st.cab ? 'grupo' : i < st.cab ? 'excluido-imp' : ''}"><td class="dica">${i + 1}</td>${Array.from({ length: ncol }, (_, j) => `<td>${esc(mostrarCel(l[j]))}</td>`).join('')}</tr>`).join('');
    const { saida, ign } = linhasConvertidas();
    const total = saida.reduce((s, x) => s + cent(x.cota ? x.cota.valor : x.valor), 0) / 100;
    const unidades = st.destino === 'lote' ? new Set(saida.map(x => normalizar(x.unidade))).size : 0;
    const ignTxt = descIgnoradas(ign);
    const semUnidade = st.destino === 'lote' && ign.unidade.length && !saida.length;
    $('#impCorpo').innerHTML = `
      <div class="grade-form">
        ${pl.folhas.length > 1 ? `<div class="campo"><label>Folha</label><select id="impFolha">${pl.folhas.map((f, i) => `<option value="${i}" ${i === st.folha ? 'selected' : ''}>${esc(f.nome)}</option>`).join('')}</select></div>` : ''}
        <div class="campo"><label>Linha dos títulos</label><input type="number" id="impCab" min="1" value="${st.cab + 1}"></div>
        ${campos().map(([k, r]) => `<div class="campo"><label>${r}</label><select data-mapa="${k}">${opcoesCol(st.mapa[k])}</select></div>`).join('')}
        ${st.destino !== 'despesas' ? `<div class="campo"><label>Dia do vencimento (se não houver coluna)</label><input type="number" id="impDia" min="1" max="31" value="${st.dia}"></div>` : ''}
      </div>
      ${st.destino === 'lote' ? `<div class="grade-form" style="margin-top:12px">
        <div class="campo"><label>Unidade (se não houver coluna)</label><input data-fixo="unidade" value="${esc(st.fixo.unidade)}" placeholder="Ex.: Bloco 3, apto 406"></div>
        <div class="campo"><label>Devedor (se não houver coluna)</label><input data-fixo="devedor" value="${esc(st.fixo.devedor)}"></div>
        <div class="campo"><label>CPF/CNPJ (se não houver coluna)</label><input data-fixo="documento" value="${esc(st.fixo.documento)}"></div>
        <p class="dica" style="grid-column:1/-1;margin:0">Quando possível, estes campos são preenchidos com o que foi encontrado no cabeçalho da planilha. Confira.</p></div>` : ''}
      <p class="${saida.length ? 'dica' : 'alerta'}" style="margin-top:12px"><b>${saida.length}</b> linha(s) serão importadas, total de <b>${fmtMoeda(total)}</b>${unidades ? `, em <b>${unidades}</b> unidade(s)` : ''}.
        ${ignTxt ? 'Ignoradas: ' + esc(ignTxt) + '.' : ''}
        ${semUnidade ? '<br><b>Indique a coluna da unidade ou digite a unidade no campo acima.</b>' : ''}
        ${!saida.length && (st.mapa.valor === undefined || st.mapa.valor === '') ? '<br><b>Escolha a coluna do valor.</b>' : ''}</p>
      <div class="acoes-linha"><button class="bt primario" id="impOk" ${saida.length ? '' : 'disabled'}>Importar</button><button class="bt" data-fechar>Cancelar</button></div>
      <h3 style="margin:14px 0 6px;font-size:13px">Prévia (${Math.min(60, linhas.length)} primeiras linhas)</h3>
      <div class="rolagem previa-imp"><table class="tabela tabela-imp"><thead><tr><th></th>${titulos.map((_, j) => `<th>${colunaXLSX(j)}</th>`).join('')}</tr></thead><tbody>${prev}</tbody></table></div>`;
    $('#impFolha')?.addEventListener('change', e => { st.folha = +e.target.value; prepararFolha(); });
    $('#impCab').addEventListener('change', e => { st.cab = Math.max(0, (+e.target.value || 1) - 1); st.mapa = sugerirColunas(linhas, st.cab, campos()); desenhar(); });
    $('#impDia')?.addEventListener('change', e => { st.dia = +e.target.value || 10; desenhar(); });
    $$('[data-mapa]').forEach(s => s.addEventListener('change', () => { st.mapa[s.dataset.mapa] = s.value === '' ? '' : +s.value; desenhar(); }));
    $$('[data-fixo]').forEach(i => i.addEventListener('change', () => { st.fixo[i.dataset.fixo] = i.value; desenhar(); }));
    $('#impOk').addEventListener('click', () => executar(() => concluir(linhasConvertidas().saida)));
  }

  async function concluir(saida) {
    if (st.destino === 'cotas') { st.aoConcluir(saida); fecharModal(); aviso(`${saida.length} cota(s) incluída(s). Confira e clique em Salvar.`); return; }
    if (st.destino === 'despesas') { st.aoConcluir(saida); fecharModal(); aviso(`${saida.length} despesa(s) incluída(s). Confira e clique em Salvar.`); return; }
    // Lote: agrupa por unidade
    const grupos = {};
    for (const x of saida) (grupos[normalizar(x.unidade)] = grupos[normalizar(x.unidade)] || []).push(x);
    let novas = 0, completadas = 0, ultima = null;
    for (const lista of Object.values(grupos)) {
      const unidade = lista[0].unidade;
      const existente = Object.values(D.cobrancas).find(c => c.condominioId === st.condominioId && normalizar(c.unidade) === normalizar(unidade) && (c.situacao || 'ativa') === 'ativa');
      const cob = existente ? structuredClone(existente) : novaCobranca(st.condominioId);
      cob.unidade = cob.unidade || unidade;
      cob.devedores = (cob.devedores || []).filter(d => d.nome);
      for (const x of lista) {
        if (x.devedor && !cob.devedores.some(d => normalizar(d.nome) === normalizar(x.devedor))) cob.devedores.push({ nome: x.devedor, documento: x.documento, endereco: '' });
      }
      cob.cotas = [...(cob.cotas || []), ...lista.map(x => x.cota)];
      ultima = await salvarRegistro('cobrancas', cob);
      existente ? completadas++ : novas++;
    }
    fecharModal();
    aviso(`Importação concluída: ${novas} cobrança(s) criada(s)${completadas ? `, ${completadas} completada(s)` : ''}.`);
    // Uma unidade só: abre a cobrança para completar os dados
    if (novas + completadas === 1) location.hash = '#/cobranca/' + ultima.id; else rotear();
  }
}
