'use strict';
/* Planilhas de débito em PDF e Excel: por unidade (cobrança), por devedor, por imóvel e por cliente (condomínio) */

const TIPOS = { extrajudicial: 'Cobrança extrajudicial', judicial: 'Cobrança judicial' };

const nomeCond = cob => D.condominios[cob.condominioId]?.razao || '—';
const devedoresTexto = cob => (cob.devedores || []).filter(d => d.nome).map(d => d.nome + (d.documento ? ` (${rotuloDoc(d.documento)} ${fmtDoc(d.documento)})` : '')).join('; ') || '—';
const devedoresCurto = cob => (cob.devedores || []).filter(d => d.nome).map(d => d.nome).join('; ') || '—';
const descProcesso = cob => cob.tipo === 'judicial'
  ? 'Cobrança judicial' + (cob.processo ? ' - Processo nº ' + cob.processo : '') + (cob.juizo ? ' - ' + cob.juizo : '')
  : 'Cobrança extrajudicial';

function linhasInfo(cob) {
  const c = D.condominios[cob.condominioId] || {};
  return [
    `Credor: ${c.razao || '—'}${c.cnpj ? ' - CNPJ ' + fmtDoc(c.cnpj) : ''}`,
    ...(c.endereco ? ['Endereço do condomínio: ' + c.endereco] : []),
    `Unidade: ${cob.unidade || '—'}`,
    `Devedor${(cob.devedores || []).length > 1 ? 'es' : ''}: ${devedoresTexto(cob)}`,
    descProcesso(cob),
  ];
}

// Resumo (rótulo, valor, estilo) usado no PDF e na tela
function itensResumo(r) {
  const itens = [
    ['Cotas condominiais em aberto (valor originário)', r.tc.original],
    ['(+) Correção monetária', r.tc.correcao],
    ['(+) Juros de mora', r.tc.juros],
    ['(+) Multa', r.tc.multa],
    ['(=) Débito condominial atualizado', r.tc.total, 'b'],
  ];
  if (!r.p.embutir && r.honContr) itens.push([`(+) Honorários advocatícios contratuais (${fmtPct(r.p.honContr)}%)`, r.honContr]);
  if (r.despesas.length) itens.push(['(+) Despesas (custas, certidões, registros e outras), corrigidas', r.td.corrigido]);
  if (r.suc.tipo !== 'nenhum' && r.suc.valor) itens.push([r.suc.tipo === 'percentual' ? `(+) Honorários advocatícios sucumbenciais (${fmtPct(r.suc.pct)}%)` : '(+) Honorários advocatícios sucumbenciais', r.suc.valor]);
  itens.push(['(=) Total devido', r.total, 'f']);
  return itens;
}

function notasCalculo(r) {
  return [
    notaMetodo(r.p),
    notaFaltando(r.faltando),
    r.aVencer.length ? `Não incluída(s) ${r.aVencer.length} cota(s) com vencimento a partir de ${fmtData(r.dataCalc)}.` : '',
  ].filter(Boolean);
}

/* ================= PDF ================= */
function blocoInfoPDF(P, titulo, linhas) {
  const { doc } = P;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  const partes = linhas.flatMap(l => doc.splitTextToSize(l, P.larg - 8));
  const h = 8 + partes.length * 3.9 + 2;
  P.espaco(h + 30);
  doc.setFillColor(...COR_FUNDO); doc.rect(P.M, P.y, P.larg, h, 'F');
  doc.setFillColor(...COR_PRI); doc.rect(P.M, P.y, 1.2, h, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...COR_PRI);
  doc.text(titulo, P.M + 4, P.y + 5.5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...COR_TEXTO);
  partes.forEach((l, i) => doc.text(l, P.M + 4, P.y + 10 + i * 3.9));
  P.y += h + 4;
}

function secaoCobrancaPDF(P, cob, r) {
  blocoInfoPDF(P, `${nomeCond(cob)} - ${cob.unidade || 'Unidade'}`, linhasInfo(cob));
  paragrafoPDF(P, descCriterios(r), 8, 'normal', COR_SUAVE);
  P.y += 3;
  subtituloPDF(P, 'Cotas condominiais em aberto');
  if (r.cotas.length) {
    tabelaPDF(P, [
      { t: 'Competência', w: 18, nw: true }, { t: 'Descrição', w: 40 }, { t: 'Vencimento', w: 20, nw: true }, { t: 'Valor originário', w: 22, a: 'r' },
      { t: 'Fator de correção', w: 20, a: 'r' }, { t: 'Valor corrigido', w: 22, a: 'r' }, { t: 'Dias', w: 11, a: 'r' },
      { t: 'Juros', w: 20, a: 'r' }, { t: 'Multa', w: 20, a: 'r' }, { t: 'Total', w: 24, a: 'r' },
    ], [
      ...r.cotas.map(x => ({ c: [mesNum(x.c.competencia), x.c.descricao || 'Cota condominial', fmtData(x.c.vencimento), fmtNum(x.valor), fmtFator(x.e.fator), fmtNum(x.e.corrigido), String(x.e.dias), fmtNum(x.e.juros), fmtNum(x.e.multa), fmtNum(x.e.total)] })),
      { c: ['Totais', '', '', fmtNum(r.tc.original), '', fmtNum(r.tc.corrigido), '', fmtNum(r.tc.juros), fmtNum(r.tc.multa), fmtNum(r.tc.total)], total: true },
    ], 8);
  } else paragrafoPDF(P, 'Nenhuma cota vencida em aberto até a data do cálculo.', 8.5, 'italic', COR_SUAVE);
  if (r.despesas.length) {
    P.y += 2;
    subtituloPDF(P, 'Despesas');
    tabelaPDF(P, [
      { t: 'Data do pagamento', w: 20, nw: true }, { t: 'Rubrica', w: 40 }, { t: 'Descrição', w: 60 }, { t: 'Valor pago', w: 24, a: 'r' },
      { t: 'Fator de correção', w: 20, a: 'r' }, { t: 'Valor corrigido', w: 24, a: 'r' },
    ], [
      ...r.despesas.map(x => ({ c: [fmtData(x.d.data), x.d.rubrica || '', x.d.descricao || '', fmtNum(x.valor), x.fator === 1 && x.d.corrigir === false ? 'sem correção' : fmtFator(x.fator), fmtNum(x.corrigido)] })),
      { c: ['Totais', '', '', fmtNum(r.td.original), '', fmtNum(r.td.corrigido)], total: true },
    ], 8);
  }
  subtituloPDF(P, 'Resumo');
  resumoPDF(P, itensResumo(r), P.W > 250 ? 140 : 120);
  notasCalculo(r).forEach(n => { paragrafoPDF(P, n, 7.5, 'normal', COR_SUAVE); P.y += 1; });
}

// Tabela-resumo de várias cobranças (devedor, imóvel ou cliente)
function linhasConsolidado(itens) {
  const t = k => itens.reduce((s, x) => s + cent(x.r[k] ?? 0), 0) / 100;
  const tHon = itens.reduce((s, x) => s + cent(x.r.honContr), 0) / 100;
  const tDesp = itens.reduce((s, x) => s + cent(x.r.td.corrigido), 0) / 100;
  const tSuc = itens.reduce((s, x) => s + cent(x.r.suc.valor), 0) / 100;
  const tDeb = itens.reduce((s, x) => s + cent(x.r.tc.total), 0) / 100;
  return {
    linhas: itens.map(({ cob, r }) => [nomeCond(cob), cob.unidade || '', devedoresCurto(cob), cob.tipo === 'judicial' ? 'Judicial' + (cob.processo ? ' ' + cob.processo : '') : 'Extrajudicial',
      r.tc.original, r.tc.total, r.honContr, r.td.corrigido, r.suc.valor, r.total]),
    totais: { original: itens.reduce((s, x) => s + cent(x.r.tc.original), 0) / 100, debito: tDeb, hon: tHon, desp: tDesp, suc: tSuc, total: t('total') },
  };
}

function gerarPDFCobrancas({ titulo, linhasTitulo = [], cobs, dataCalc, nome }) {
  const itens = cobs.map(cob => ({ cob, r: calcularCobranca(cob, dataCalc) }));
  const P = novoDocumento(true);
  P.cab();
  if (itens.length === 1) {
    tituloPDF(P, titulo || 'Planilha de débito', linhasTitulo);
    secaoCobrancaPDF(P, itens[0].cob, itens[0].r);
  } else {
    tituloPDF(P, titulo, [...linhasTitulo, [`Valores atualizados até ${fmtData(dataCalc)}. ${itens.length} cobranças.`, 9, 'normal', COR_SUAVE]]);
    const { linhas, totais } = linhasConsolidado(itens);
    const temHon = totais.hon > 0;
    const cols = [{ t: 'Condomínio', w: 42 }, { t: 'Unidade', w: 24 }, { t: 'Devedor(es)', w: 44 }, { t: 'Cobrança', w: 28 },
      { t: 'Valor originário', w: 22, a: 'r' }, { t: 'Débito atualizado', w: 24, a: 'r' }, ...(temHon ? [{ t: 'Honorários contratuais', w: 22, a: 'r' }] : []),
      { t: 'Despesas', w: 20, a: 'r' }, { t: 'Honorários sucumbenciais', w: 22, a: 'r' }, { t: 'Total', w: 24, a: 'r' }];
    const fmtL = l => { const v = l.slice(4).map(fmtNum); if (!temHon) v.splice(2, 1); return [...l.slice(0, 4), ...v]; };
    tabelaPDF(P, cols, [
      ...linhas.map(l => ({ c: fmtL(l) })),
      { c: fmtL(['Totais', '', '', '', totais.original, totais.debito, totais.hon, totais.desp, totais.suc, totais.total]), total: true },
    ], 8);
    for (const { cob, r } of itens) { P.novaPagina(); secaoCobrancaPDF(P, cob, r); }
  }
  rodapePDF(P);
  return { doc: P.doc, nome: nome + '.pdf' };
}

/* ================= Excel ================= */
const LETRAS = 'ABCDEFGHIJ';

/*
  Excel com fórmulas em tudo: alterando a data do cálculo, os percentuais ou os valores, a planilha recalcula,
  inclusive os fatores de correção (a folha "Índices" traz a UFIR-RJ e os números-índice do IGP-M e do IPCA).
  Linhas em branco no fim das tabelas permitem incluir novos meses e despesas no próprio Excel.
*/
const LINHAS_EXTRAS_COTAS = 12, LINHAS_EXTRAS_DESP = 6;
const FOLHA_IDX = "'Índices'";
const COL_ACUM = { 'IGP-M': 'C', 'IPCA': 'E' };
const IDX_INI = 6; // primeira linha de dados da folha Índices

// Fórmula do fator de correção entre a data da célula "x" e a data do cálculo
function formulaFator(p, x, DATA, ultLinha) {
  if (p.indice === 'UFIR-RJ') {
    const t = `${FOLHA_IDX}!$G$${IDX_INI}:$H$${IDX_INI + 200}`;
    return `IF(${x}>=${DATA},1,IFERROR(ROUND(VLOOKUP(YEAR(${DATA}),${t},2,TRUE)/VLOOKUP(YEAR(${x}),${t},2,TRUE),6),1))`;
  }
  const col = COL_ACUM[p.indice];
  if (!col) return '1';
  const meses = `${FOLHA_IDX}!$A$${IDX_INI}:$A$${ultLinha}`, acum = `${FOLHA_IDX}!$${col}$${IDX_INI}:$${col}$${ultLinha}`;
  const num = d => `INDEX(${acum},MATCH(EOMONTH(${d},-2)+1,${meses},1))`;
  return `IF(${x}>=${DATA},1,ROUND(${num(DATA)}/${num(x)},6))`;
}

// Folha "Índices": meses com a variação e o número-índice acumulado (IGP-M e IPCA) e a UFIR-RJ por ano
function folhaIndicesXLSX(p) {
  const series = D.indices?.series || {};
  const todos = Object.keys(COL_ACUM).flatMap(n => Object.keys(series[n] || {})).sort();
  const ini = todos.length ? todos[0] : '1995-01';
  const fim = [todos[todos.length - 1] || mesAtual(), mesAtual()].sort()[1];
  const L = [
    [{ v: 'Índices de correção monetária', s: 'tit' }],
    ['Usados nas fórmulas das outras folhas. Novos meses podem ser acrescentados ao final (a variação na coluna do índice; o acumulado segue a fórmula da linha de cima).'],
    [p.ignorarNegativos ? 'Variações mensais negativas desconsideradas no acumulado.' : 'Fontes: Banco Central do Brasil (SGS) e SEFAZ-RJ.'],
    null,
    { c: ['Mês', 'IGP-M (% no mês)', 'IGP-M acumulado', 'IPCA (% no mês)', 'IPCA acumulado', '', 'Ano', 'UFIR-RJ'].map(v => (v ? { v, s: 'cab' } : null)), altura: 30 },
  ];
  // Linha-base (mês anterior ao primeiro) com acumulado 1
  const base = addMes(ini, -1);
  const acum = { 'IGP-M': 1, 'IPCA': 1 };
  const ufir = Object.entries(tabelaUfir()).sort((a, b) => a[0] - b[0]);
  const meses = [base];
  for (let m = ini; m <= fim; m = addMes(m, 1)) meses.push(m);
  meses.forEach((m, i) => {
    const n = IDX_INI + i;
    const linha = [{ v: m + '-01', s: 'd' }];
    for (const nome of Object.keys(COL_ACUM)) {
      const col = COL_ACUM[nome], colVar = String.fromCharCode(col.charCodeAt(0) - 1);
      const v = i === 0 ? undefined : series[nome]?.[m];
      if (v !== undefined && v !== null) acum[nome] *= 1 + (p.ignorarNegativos ? Math.max(0, v) : v) / 100;
      linha.push(v === undefined || v === null ? null : { v, s: 'f' });
      linha.push(i === 0 ? { v: 1, s: 'f' } : { f: p.ignorarNegativos ? `${col}${n - 1}*(1+MAX(0,${colVar}${n})/100)` : `${col}${n - 1}*(1+${colVar}${n}/100)`, v: Math.round(acum[nome] * 1e10) / 1e10, s: 'f' });
    }
    linha.push(null);
    if (ufir[i]) linha.push({ v: +ufir[i][0], s: 'i' }, { v: ufir[i][1], s: 'f' });
    L.push(linha);
  });
  for (let i = meses.length; i < ufir.length; i++) { const l = Array(6).fill(null); l.push({ v: +ufir[i][0], s: 'i' }, { v: ufir[i][1], s: 'f' }); L.push(l); }
  return { folha: { nome: 'Índices', linhas: L, larguras: [12, 14, 16, 14, 16, 3, 8, 12], congelar: IDX_INI - 1 }, ultLinha: IDX_INI + meses.length + 600 };
}

function folhaCobrancaXLSX(cob, r, nomeFolha, ultIdx) {
  const p = r.p;
  const mesclar = [];
  const LARG = [13, 30, 12, 15, 12, 15, 9, 13, 13, 15], cab = cabecalhoXLSX(LARG);
  const L = [...cab.linhas, [{ v: 'Planilha de débito', s: 'tit' }], ...linhasInfo(cob).map(t => [t]), null];
  const param = (rotulo, valor) => { L.push([{ v: rotulo, s: 'b' }, null, null, valor]); return '$D$' + L.length; };
  const DATA = param('Data do cálculo', { v: r.dataCalc, s: 'd' });
  param('Correção monetária', descIndice(p));
  const MULTA = param('Multa', { v: p.multa / 100, s: 'p' });
  const JUROS = param('Juros de mora ao mês (pro rata die)', { v: p.juros / 100, s: 'p' });
  const HON = !p.embutir && p.honContr ? param('Honorários advocatícios contratuais', { v: p.honContr / 100, s: 'p' }) : null;
  const SUC = r.suc.tipo === 'percentual' ? param('Honorários advocatícios sucumbenciais', { v: r.suc.pct / 100, s: 'p' }) : null;
  const fator = x => formulaFator(p, x, DATA, ultIdx);
  const vz = { v: '', s: 'bt' };

  // Cotas: as linhas preenchidas e as em branco têm as mesmas fórmulas (calculam quando o valor é informado)
  L.push(null, [{ v: 'Cotas condominiais em aberto', s: 'b' }]);
  L.push({ c: ['Competência', 'Descrição', 'Vencimento', 'Valor originário', 'Fator de correção', 'Valor corrigido', 'Dias de atraso', 'Juros', 'Multa', 'Total'].map(v => ({ v, s: 'cab' })), altura: 30 });
  const ini = L.length + 1;
  const linhaCota = (x) => {
    const n = L.length + 1, se = (f, v, s) => ({ f: `IF(D${n}="","",${f})`, v, s });
    L.push([x ? mesNum(x.c.competencia) : null, x ? x.c.descricao || 'Cota condominial' : null, { v: x ? x.c.vencimento : '', s: 'd' }, { v: x ? x.valor : '', s: 'm' },
      se(fator('C' + n), x?.e.fator, 'f'), se(`ROUND(D${n}*E${n},2)`, x?.e.corrigido, 'm'), se(`MAX(0,${DATA}-C${n})`, x?.e.dias, 'i'),
      se(`ROUND(F${n}*${JUROS}/30*G${n},2)`, x?.e.juros, 'm'), se(`IF(G${n}>0,ROUND(F${n}*${MULTA},2),0)`, x?.e.multa, 'm'), se(`F${n}+H${n}+I${n}`, x?.e.total, 'm')]);
  };
  r.cotas.forEach(linhaCota);
  for (let i = 0; i < LINHAS_EXTRAS_COTAS; i++) linhaCota(null);
  const fim = L.length, nt = L.length + 1;
  const soma = (col, v, de, ate) => ({ f: `SUM(${col}${de}:${col}${ate})`, v, s: 'mt' });
  L.push([{ v: 'Totais', s: 'bt' }, vz, vz, soma('D', r.tc.original, ini, fim), vz, soma('F', r.tc.corrigido, ini, fim), vz, soma('H', r.tc.juros, ini, fim), soma('I', r.tc.multa, ini, fim), soma('J', r.tc.total, ini, fim)]);

  // Despesas
  L.push(null, [{ v: 'Despesas', s: 'b' }]);
  L.push({ c: ['Data do pagamento', 'Rubrica', 'Descrição', 'Valor pago', 'Fator de correção', 'Valor corrigido'].map(v => ({ v, s: 'cab' })), altura: 30 });
  const di = L.length + 1;
  const linhaDesp = (x) => {
    const n = L.length + 1;
    const fat = x && x.d.corrigir === false ? { v: 1, s: 'f' } : { f: `IF(D${n}="","",${fator('A' + n)})`, v: x?.fator, s: 'f' };
    L.push([{ v: x ? x.d.data : '', s: 'd' }, x ? x.d.rubrica || '' : null, x ? x.d.descricao || '' : null, { v: x ? x.valor : '', s: 'm' }, fat, { f: `IF(D${n}="","",ROUND(D${n}*E${n},2))`, v: x?.corrigido, s: 'm' }]);
  };
  r.despesas.forEach(linhaDesp);
  for (let i = 0; i < LINHAS_EXTRAS_DESP; i++) linhaDesp(null);
  const df = L.length;
  L.push([{ v: 'Totais', s: 'bt' }, vz, vz, soma('D', r.td.original, di, df), vz, soma('F', r.td.corrigido, di, df)]);
  const refDesp = 'F' + L.length;

  L.push(null, [{ v: 'Resumo', s: 'b' }]);
  const linhaRes = (rotulo, cel, total) => { L.push([{ v: rotulo, s: total ? 'bt' : 'b' }, ...(total ? Array(8).fill(vz) : Array(8).fill(null)), { ...cel, s: total ? 'mt' : 'm' }]); return 'J' + L.length; };
  const refDeb = linhaRes('Débito condominial atualizado (valor corrigido + juros + multa)', { f: `J${nt}`, v: r.tc.total });
  const partes = [refDeb];
  let refHon = null;
  if (HON) { refHon = linhaRes('Honorários advocatícios contratuais', { f: `ROUND(${refDeb}*${HON},2)`, v: r.honContr }); partes.push(refHon); }
  const refDespRes = linhaRes('Despesas corrigidas', { f: refDesp, v: r.td.corrigido });
  partes.push(refDespRes);
  if (r.suc.tipo === 'percentual') {
    const base = [refDeb, refHon, cob.sucumbencia?.baseDespesas ? refDespRes : null].filter(Boolean).join('+');
    partes.push(linhaRes('Honorários advocatícios sucumbenciais', { f: `ROUND((${base})*${SUC},2)`, v: r.suc.valor }));
  } else if (r.suc.tipo === 'fixo' && r.suc.valor) partes.push(linhaRes('Honorários advocatícios sucumbenciais' + (r.suc.fator !== 1 ? ` (${fmtMoeda(r.suc.original)} corrigidos, fator ${fmtFator(r.suc.fator)})` : ''), { v: r.suc.valor }));
  const refTotal = linhaRes('Total devido', { f: partes.join('+'), v: r.total }, true);
  L.push(null);
  [descCriterios(r), ...notasCalculo(r),
    'Para incluir meses ou despesas, preencha as linhas em branco das tabelas (para as cotas: competência, descrição, vencimento e valor originário). A correção, os juros e a multa são calculados e somados aos totais. Para mais linhas, insira-as antes da última linha em branco e copie as fórmulas da linha de cima.',
    'Alterando a data do cálculo ou os percentuais, todos os valores são recalculados, inclusive os fatores de correção (índices na folha "Índices").']
    .forEach(n => { L.push({ c: [{ v: n, s: 'tq' }], altura: Math.ceil(n.length / 150) * 13 + 2 }); mesclar.push(`A${L.length}:J${L.length}`); });
  return { nome: nomeFolha, linhas: L, larguras: LARG, imagem: cab.imagem, mesclar, refs: { original: 'D' + nt, debito: refDeb, hon: refHon, desp: refDesp, total: refTotal } };
}

function nomeFolhaUnico(base, usados) {
  let n = base.replace(/[\[\]:*?/\\']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 28) || 'Unidade';
  let k = n, i = 2;
  while (usados.has(k.toLowerCase())) k = n.slice(0, 26) + ' ' + i++;
  usados.add(k.toLowerCase());
  return k;
}

function gerarXLSXCobrancas({ titulo, linhasTitulo = [], cobs, dataCalc }) {
  const itens = cobs.map(cob => ({ cob, r: calcularCobranca(cob, dataCalc) }));
  const usados = new Set(['resumo', 'índices']);
  const idx = itens.some(x => x.r.p.indice !== 'Nenhum') ? folhaIndicesXLSX(itens[0].r.p) : null;
  const folhas = itens.map(({ cob, r }) => folhaCobrancaXLSX(cob, r, nomeFolhaUnico(cob.unidade || 'Unidade', usados), idx?.ultLinha));
  const fimIdx = idx ? [idx.folha] : [];
  if (itens.length === 1) return gerarXLSX([...folhas, ...fimIdx]);
  const LARG = [30, 18, 34, 22, 15, 15, 15, 13, 15, 15], cab = cabecalhoXLSX(LARG);
  const L = [...cab.linhas, [{ v: titulo, s: 'tit' }], ...linhasTitulo.map(t => [Array.isArray(t) ? t[0] : t]), [`Valores atualizados até ${fmtData(dataCalc)}.`], null];
  L.push({ c: ['Condomínio', 'Unidade', 'Devedor(es)', 'Cobrança', 'Valor originário', 'Débito atualizado', 'Honorários contratuais', 'Despesas', 'Honorários sucumbenciais', 'Total'].map(v => ({ v, s: 'cab' })), altura: 30 });
  const ini = L.length + 1;
  const ref = (f, cel) => cel ? `'${f.nome.replace(/'/g, "''")}'!${cel}` : null;
  itens.forEach(({ cob, r }, i) => {
    const f = folhas[i], rf = f.refs;
    const cel = (c, v) => c ? { f: ref(f, c), v, s: 'm' } : { v: 0, s: 'm' };
    const suc = r.total - r.tc.total - r.honContr - r.td.corrigido;
    const sucCel = { f: `${ref(f, rf.total)}-${[rf.debito, rf.hon, rf.desp].filter(Boolean).map(c => ref(f, c)).join('-')}`, v: r2(suc), s: 'm' };
    L.push([nomeCond(cob), cob.unidade || '', devedoresCurto(cob), cob.tipo === 'judicial' ? 'Judicial' + (cob.processo ? ' ' + cob.processo : '') : 'Extrajudicial',
      cel(rf.original, r.tc.original), cel(rf.debito, r.tc.total), cel(rf.hon, r.honContr), cel(rf.desp, r.td.corrigido), sucCel, cel(rf.total, r.total)]);
  });
  const fim = L.length;
  const { totais } = linhasConsolidado(itens);
  const vz = { v: '', s: 'bt' };
  L.push([{ v: 'Totais', s: 'bt' }, vz, vz, vz, ...[totais.original, totais.debito, totais.hon, totais.desp, totais.suc, totais.total].map((v, j) => ({ f: `SUM(${LETRAS[4 + j]}${ini}:${LETRAS[4 + j]}${fim})`, v, s: 'mt' }))]);
  L.push(null, ['O detalhamento de cada cobrança está nas folhas seguintes.']);
  return gerarXLSX([{ nome: 'Resumo', linhas: L, larguras: LARG, imagem: cab.imagem, congelar: ini - 1 }, ...folhas, ...fimIdx]);
}

// Logotipo no canto esquerdo das planilhas: tamanho em pixels e coluna onde começa o texto do cabeçalho
function logoXLSX(larguras) {
  const a = D.config.escritorio || {};
  if (!a.logo || !a.logoL || !a.logoA) return null;
  let h = 64, w = Math.round(h * a.logoL / a.logoA);
  if (w > 190) { w = 190; h = Math.round(w * a.logoA / a.logoL); }
  let col = 0, x = 0;
  while (x < w + 12 && col < larguras.length) x += Math.round((larguras[col++] || 9) * 7 + 5);
  return { imagem: { dados: a.logo, w, h }, col, linhas: Math.ceil((h + 8) / 17) };
}

// Dados do escritório no topo das planilhas (à direita do logotipo, se houver)
function cabecalhoXLSX(larguras = []) {
  const a = D.config.escritorio || {};
  const logo = logoXLSX(larguras);
  const textos = a.nome ? [{ v: a.nome, s: 'b' }, ...[[a.documento, a.oab].filter(Boolean).join('  ·  '), a.endereco, [a.telefone, a.email, a.site].filter(Boolean).join('  ·  ')].filter(Boolean)] : [];
  if (!textos.length && !logo) return { linhas: [], imagem: null };
  const pre = Array(logo ? logo.col : 0).fill(null);
  const linhas = textos.map(t => [...pre, t]);
  while (logo && linhas.length < logo.linhas) linhas.push([]);
  linhas.push(null);
  return { linhas, imagem: logo?.imagem || null };
}

/* ================= Agrupamentos ================= */
// Chave do devedor: CPF/CNPJ quando houver; senão o nome
const chaveDevedor = d => soDigitos(d.documento).length >= 11 ? 'doc:' + soDigitos(d.documento) : 'nome:' + normalizar(d.nome);
const chaveImovel = cob => cob.condominioId + '|' + normalizar(cob.unidade);

function listaDevedores(cobs = Object.values(D.cobrancas)) {
  const mapa = {};
  for (const cob of cobs) for (const d of cob.devedores || []) {
    if (!d.nome) continue;
    const k = chaveDevedor(d);
    (mapa[k] = mapa[k] || { chave: k, nome: d.nome, documento: d.documento, cobs: [] }).cobs.push(cob);
  }
  return Object.values(mapa).sort((a, b) => comparar(a.nome, b.nome));
}

function listaImoveis(cobs = Object.values(D.cobrancas)) {
  const mapa = {};
  for (const cob of cobs) {
    const k = chaveImovel(cob);
    (mapa[k] = mapa[k] || { chave: k, condominioId: cob.condominioId, unidade: cob.unidade, cobs: [] }).cobs.push(cob);
  }
  return Object.values(mapa).sort((a, b) => comparar(nomeCond(a.cobs[0]), nomeCond(b.cobs[0])) || comparar(a.unidade, b.unidade));
}

const ordemCobranca = (a, b) => comparar(nomeCond(a), nomeCond(b)) || comparar(a.unidade, b.unidade) || comparar(a.tipo, b.tipo);

// Monta título, cobranças e nome de arquivo para cada tipo de planilha
function definicaoRelatorio(tipo, chave, filtros = {}) {
  let cobs = Object.values(D.cobrancas);
  if (filtros.situacao !== 'todas') cobs = cobs.filter(c => (c.situacao || 'ativa') === 'ativa');
  if (filtros.tipo && filtros.tipo !== 'todas') cobs = cobs.filter(c => c.tipo === filtros.tipo);
  if (tipo === 'cobranca') {
    const cob = D.cobrancas[chave];
    return { titulo: 'Planilha de débito', cobs: [cob], nome: nomeArquivo('Planilha', nomeCond(cob).slice(0, 40), cob.unidade) };
  }
  if (tipo === 'devedor') {
    const dv = listaDevedores(cobs).find(d => d.chave === chave);
    if (!dv) throw new Error('Devedor sem cobranças com os filtros escolhidos.');
    return {
      titulo: 'Planilha de débitos por devedor', cobs: dv.cobs.sort(ordemCobranca), nome: nomeArquivo('Planilha-devedor', dv.nome),
      linhasTitulo: [[`Devedor: ${dv.nome}${dv.documento ? ` (${rotuloDoc(dv.documento)} ${fmtDoc(dv.documento)})` : ''}`, 10, 'bold']],
    };
  }
  if (tipo === 'imovel') {
    const im = listaImoveis(cobs).find(i => i.chave === chave);
    if (!im) throw new Error('Imóvel sem cobranças com os filtros escolhidos.');
    const c = D.condominios[im.condominioId] || {};
    return {
      titulo: 'Planilha de débitos por imóvel', cobs: im.cobs.sort(ordemCobranca), nome: nomeArquivo('Planilha-imovel', (c.razao || '').slice(0, 40), im.unidade),
      linhasTitulo: [[`${c.razao || ''} - ${im.unidade || ''}`, 10, 'bold']],
    };
  }
  if (tipo === 'cliente') {
    const c = D.condominios[chave];
    const lista = cobs.filter(x => x.condominioId === chave).sort(ordemCobranca);
    if (!lista.length) throw new Error('Este cliente não tem cobranças com os filtros escolhidos.');
    return {
      titulo: 'Planilha de débitos por cliente', cobs: lista, nome: nomeArquivo('Planilha-cliente', (c?.razao || '').slice(0, 50)),
      linhasTitulo: [[`Credor: ${c?.razao || ''}${c?.cnpj ? ' - CNPJ ' + fmtDoc(c.cnpj) : ''}`, 10, 'bold'], ...(c?.endereco ? [[c.endereco, 9]] : [])],
    };
  }
  throw new Error('Tipo de planilha desconhecido.');
}

async function exportarRelatorio(formato, tipo, chave, dataCalc, filtros) {
  await garantirIndices();
  const def = definicaoRelatorio(tipo, chave, filtros);
  if (formato === 'xlsx') return salvarPlanilha(gerarXLSXCobrancas({ ...def, dataCalc }), def.nome + '.xlsx');
  const pdf = gerarPDFCobrancas({ ...def, dataCalc });
  return formato === 'ver' ? visualizarPDF(pdf) : salvarPDF(pdf);
}
