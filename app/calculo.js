'use strict';
/*
  Cálculo da cobrança de uma unidade.

  Cada cota em aberto e cada despesa vira uma "parcela" com saldos em unidades da data-base (valor ÷ fator de
  correção): principal (Pb), juros (Jb) e multa (Mb). Na data do cálculo, saldo = (Pb + Jb + Mb) × fator.
  - Correção monetária desde o vencimento (cotas) ou o pagamento (despesas), pelo índice do regime em vigor em cada
    período (com a opção "Lei 14.905", a partir de 30/08/2024 passam a valer o IPCA e a taxa legal);
  - juros de mora desde o vencimento: percentual ao mês pro rata die (padrão de 1%, art. 1.336, § 1º, do CC), taxa legal
    (art. 406 do CC), SELIC (engloba correção e juros) ou sem juros; sempre simples, sobre o valor corrigido;
  - multa sobre o valor corrigido;
  - honorários contratuais: percentual sobre o débito atualizado, em linha própria ou embutidos no valor originário de
    cada cota (o valor originário passa a ser cota × (1 + %), sem menção na planilha);
  - pagamentos (amortizações): o débito é atualizado até a data de cada pagamento e o valor é imputado (juros e multa
    primeiro, art. 354 do CC, ou o principal primeiro) nas cotas e despesas escolhidas;
  - honorários sucumbenciais: percentual (sobre o débito, com ou sem as despesas) ou valor fixo corrigido;
  - art. 523, § 1º, do CPC (cobrança judicial): multa e honorários sobre o débito atualizado até a data do cálculo.
    A base é uma "sombra" das cotas (e, se escolhido, das despesas), que só os pagamentos feitos no prazo reduzem (§ 2º).
*/

const PADROES = { indice: 'UFIR-RJ', multa: 2, juros: 1, tipoJuros: 'mensal', lei14905: false, honContr: 10, embutir: false, ignorarNegativos: false };
const TIPOS_JUROS = {
  mensal: 'Percentual ao mês (pro rata die)',
  legal: 'Taxa legal (art. 406 do CC)',
  selic: 'SELIC (engloba correção e juros)',
  nenhum: 'Sem juros',
};
const DATA_LEI_14905 = '2024-08-30';
const ART523_PADRAO = { aplicar: false, multa: 10, honorarios: 10, incluirMulta: true, incluirHonorarios: true, baseHonContr: true, baseDespesas: false, baseSuc: false };

const vazio = x => x === null || x === undefined || x === '';
const simNao = v => v === true || v === 'sim';

// Parâmetros efetivos: Configurações → condomínio → cobrança (campos em branco herdam)
function paramsCobranca(cob) {
  const cfg = { ...PADROES, ...(D.config?.padroes || {}) };
  const cond = D.condominios[cob?.condominioId]?.padroes || {};
  const own = cob?.params || {};
  const pegar = (k, num) => {
    for (const fonte of [own, cond]) if (!vazio(fonte[k])) return num ? Number(fonte[k]) : fonte[k];
    return num ? Number(cfg[k]) : cfg[k];
  };
  return {
    indice: pegar('indice'), multa: pegar('multa', true), juros: pegar('juros', true), tipoJuros: pegar('tipoJuros') || 'mensal',
    lei14905: simNao(pegar('lei14905')), honContr: pegar('honContr', true), embutir: simNao(pegar('embutir')), ignorarNegativos: !!cfg.ignorarNegativos,
  };
}

// Regimes por período a partir dos parâmetros (o segundo, se houver, é o da Lei 14.905)
function regimesDe(p, semJuros) {
  const juros = semJuros ? 'nenhum' : p.tipoJuros || 'mensal';
  const r = [{ desde: '', indice: juros === 'selic' ? 'Nenhum' : p.indice || 'Nenhum', juros, taxa: Number(p.juros) || 0 }];
  if (p.lei14905) r.push({ desde: DATA_LEI_14905, indice: 'IPCA', juros: juros === 'nenhum' ? 'nenhum' : 'legal' });
  return r;
}

/* ---------- Correção monetária ---------- */
// Mês a partir do qual vale um regime que começa em "data": se não começar no dia 1º, o próprio mês fica no regime anterior
const mesLimite = data => data.slice(8) === '01' ? data.slice(0, 7) : addMes(data.slice(0, 7), 1);

function fatorTrecho(indice, a, b, mesA, mesB, faltando, ign) {
  if (!indice || indice === 'Nenhum') return 1;
  if (indice === 'UFIR-RJ') {
    const t = tabelaUfir(), a0 = +a.slice(0, 4);
    let a1 = +b.slice(0, 4);
    if (a1 <= a0) return 1;
    if (!t[a0]) { faltando.add('UFIR-RJ ' + a0); return 1; }
    if (!t[a1]) { faltando.add('UFIR-RJ ' + a1); while (a1 > a0 && !t[a1]) a1--; }
    return t[a1] / t[a0];
  }
  const serie = D.indices?.series?.[indice] || {};
  let f = 1;
  for (let m = mesA; m < mesB; m = addMes(m, 1)) {
    const v = serie[m];
    if (v === undefined || v === null) { faltando.add(indice + ' ' + mesNum(m)); continue; }
    if (ign && v < 0) continue;
    f *= 1 + v / 100;
  }
  return f;
}

// Fator de correção da parcela entre o termo inicial e a data t (arredondado a 6 casas, como na planilha)
function fatorParcela(u, t, faltando) {
  if (!u.corrDesde || !t || t <= u.corrDesde) return 1;
  const regs = u.regimes, ign = !!D.config?.padroes?.ignorarNegativos;
  let f = 1;
  for (let k = 0; k < regs.length; k++) {
    const r = regs[k], prox = regs[k + 1]?.desde;
    const a = r.desde && r.desde > u.corrDesde ? r.desde : u.corrDesde;
    const b = prox && prox < t ? prox : t;
    if (a >= b || r.juros === 'selic') continue;
    const mesA = a === u.corrDesde ? a.slice(0, 7) : mesLimite(a);
    const mesB = b === t ? t.slice(0, 7) : mesLimite(b);
    f *= fatorTrecho(r.indice, a, b, mesA, mesB, faltando, ign);
  }
  return Math.round(f * 1e6) / 1e6;
}

/* ---------- Juros ---------- */
const SERIE_JUROS = { legal: 'Taxa legal', selic: 'SELIC' };

// Taxa mensal (%) de uma série de juros; meses ainda não divulgados usam a última taxa conhecida (com aviso)
function taxaMes(nome, ym, faltando, estimados) {
  const s = D.indices?.series?.[nome] || {};
  if (s[ym] !== undefined && s[ym] !== null) return nome === 'Taxa legal' ? Math.max(0, s[ym]) : s[ym];
  const meses = Object.keys(s).sort(), ult = meses[meses.length - 1];
  if (ult && ym > ult) { estimados.add(`${nome} ${mesNum(ym)} (usada a de ${mesNum(ult)})`); return nome === 'Taxa legal' ? Math.max(0, s[ult]) : s[ult]; }
  faltando.add(nome + ' ' + mesNum(ym));
  return 0;
}

// Taxa de juros simples (fração) entre as datas a e b, pelos regimes de cada período
function taxaJuros(u, a, b, faltando, estimados) {
  const ini = a > u.jurosDesde ? a : u.jurosDesde;
  if (!u.jurosDesde || ini >= b) return 0;
  let taxa = 0;
  const regs = u.regimes;
  for (let k = 0; k < regs.length; k++) {
    const r = regs[k], prox = regs[k + 1]?.desde;
    const x = r.desde && r.desde > ini ? r.desde : ini;
    const y = prox && prox < b ? prox : b;
    if (x >= y || !r.juros || r.juros === 'nenhum') continue;
    if (r.juros === 'mensal') { taxa += (Number(r.taxa) || 0) / 100 / 30 * diasEntre(x, y); continue; }
    // Taxa legal e SELIC: taxa do mês ÷ dias corridos do mês × dias do trecho (Res. CMN 5.171/2024, art. 6º)
    for (let m = x.slice(0, 7); m <= y.slice(0, 7); m = addMes(m, 1)) {
      const p = m === x.slice(0, 7) ? x : m + '-01';
      const q = m === y.slice(0, 7) ? y : addMes(m, 1) + '-01';
      const d = diasEntre(p, q);
      if (d > 0) taxa += taxaMes(SERIE_JUROS[r.juros], m, faltando, estimados) / 100 / ultimoDia(m) * d;
    }
  }
  return taxa;
}

/* ---------- Parcelas ---------- */
function novaParcela(base) {
  const u = { Pb: 0, Jb: 0, Mb: 0, pago: 0, ult: '', ...base };
  u.Pb = Number(u.P0) || 0;
  u.Mb = u.Pb * (Number(u.multaPct) || 0) / 100;
  return u;
}

// Juros até a data d (simples: sobre o principal em aberto, em unidades da data-base)
function acumular(u, d, ctx) {
  const de = u.ult || u.jurosDesde;
  if (!de || d <= de) { if (d > (u.ult || '')) u.ult = d; return; }
  u.Jb += u.Pb * taxaJuros(u, de, d, ctx.faltando, ctx.estimados);
  u.ult = d;
}

const saldoBase = u => u.Pb + u.Jb + u.Mb;
const saldoEm = (u, d, ctx) => saldoBase(u) * fatorParcela(u, d, ctx.faltando);

/* ---------- Pagamentos ---------- */
function imputar(u, X, d, imputacao, ctx, reg) {
  const f = fatorParcela(u, d, ctx.faltando);
  let xb = X / f;
  const ordem = imputacao === 'principal' ? ['Pb', 'Jb', 'Mb'] : ['Jb', 'Mb', 'Pb'];
  const nomes = { Pb: 'principal', Jb: 'juros', Mb: 'multa' };
  const linha = { id: u.id, rotulo: u.rotulo, principal: 0, juros: 0, multa: 0 };
  for (const k of ordem) {
    const v = Math.min(u[k], xb);
    if (v <= 0) continue;
    u[k] -= v; xb -= v;
    linha[nomes[k]] += v * f;
  }
  const usado = X - xb * f;
  u.pago += usado;
  if (usado > 1e-9) reg.push(linha);
  return Math.max(0, xb * f);
}

// Proporcional ao saldo atualizado de cada parcela na data do pagamento
function distribuir(lista, X, d, imputacao, ctx, reg) {
  const saldos = lista.map(u => saldoEm(u, d, ctx));
  const total = saldos.reduce((s, v) => s + v, 0);
  if (total <= 0) return X;
  const parte = Math.min(X, total);
  let sobra = 0;
  lista.forEach((u, i) => { sobra += imputar(u, parte * saldos[i] / total, d, imputacao, ctx, reg); });
  return X - parte + sobra;
}

function emOrdem(lista, X, d, imputacao, ctx, reg) {
  const ord = [...lista].sort((a, b) => comparar(a.data, b.data) || (a.grupo === b.grupo ? 0 : a.grupo === 'cota' ? -1 : 1));
  for (const u of ord) { if (X <= 1e-9) break; X = imputar(u, X, d, imputacao, ctx, reg); }
  return X;
}

const DESTINOS_PAGAMENTO = {
  proporcional: 'Todas as cotas e despesas, proporcionalmente',
  antigas: 'As mais antigas primeiro',
  despesasPrimeiro: 'Despesas primeiro, depois as cotas',
  'grupo:cota': 'Só as cotas',
  'grupo:despesa': 'Só as despesas',
};

/* ---------- Cálculo ---------- */
const somar = (lista, f) => lista.reduce((s, x) => s + cent(f(x)), 0) / 100;

function calcularCobranca(cob, dataCalc, pIn) {
  const p = pIn || paramsCobranca(cob);
  const ctx = { faltando: new Set(), estimados: new Set() };
  const fatorEmbutir = p.embutir ? 1 + p.honContr / 100 : 1;
  const regsCota = regimesDe(p), regsDesp = regimesDe({ ...p, tipoJuros: 'nenhum', juros: 0 }, true);

  const todas = (cob.cotas || []).filter(c => !c.pago && Number(c.valor) > 0 && c.vencimento)
    .sort((a, b) => comparar(a.vencimento, b.vencimento) || comparar(a.competencia, b.competencia));
  const aVencer = todas.filter(c => c.vencimento >= dataCalc);
  const parcCotas = todas.filter(c => c.vencimento < dataCalc).map(c => novaParcela({
    id: c.id, grupo: 'cota', c, rotulo: `${mesNum(c.competencia)} ${c.descricao || 'Cota condominial'}`.trim(), data: c.vencimento,
    P0: r2(Number(c.valor) * fatorEmbutir), corrDesde: c.vencimento, jurosDesde: c.vencimento, regimes: regsCota, multaPct: p.multa,
  }));
  const parcDesp = (cob.despesas || []).filter(d => Number(d.valor) > 0 && d.data && d.data <= dataCalc)
    .sort((a, b) => comparar(a.data, b.data)).map(d => novaParcela({
      id: d.id, grupo: 'despesa', d, rotulo: [d.rubrica, d.descricao].filter(Boolean).join(' - ') || 'Despesa', data: d.data,
      P0: Number(d.valor), corrDesde: d.corrigir === false ? '' : d.data, jurosDesde: '', regimes: d.corrigir === false ? [{ desde: '', indice: 'Nenhum', juros: 'nenhum' }] : regsDesp,
    }));
  const parcelas = [...parcCotas, ...parcDesp];

  // Art. 523, § 1º (judicial): sombra das cotas e, se escolhido, das despesas
  const art = cob.tipo === 'judicial' && cob.art523?.aplicar ? { ...ART523_PADRAO, ...cob.art523 } : null;
  const sombras = art ? [...parcCotas, ...(art.baseDespesas ? parcDesp : [])].map(u => ({ ...novaParcela({ ...u, P0: u.P0, multaPct: u.multaPct }), fonte: u, sombra: true })) : [];

  // Pagamentos, em ordem de data
  const pagamentos = (cob.pagamentos || []).filter(a => Number(a.valor) > 0 && ehData(a.data) && a.data <= dataCalc).sort((x, y) => comparar(x.data, y.data));
  const amort = [];
  let excedente = 0;
  for (const a of pagamentos) {
    const d = a.data, reg = [];
    [...parcelas, ...sombras].forEach(u => acumular(u, d, ctx));
    const vivos = parcelas.filter(u => u.data <= d && saldoBase(u) > 1e-9);
    const antes = vivos.reduce((s, u) => s + saldoEm(u, d, ctx), 0);
    let X = Number(a.valor);
    const dest = a.destino || 'proporcional';
    if (dest === 'proporcional') X = distribuir(vivos, X, d, a.imputacao, ctx, reg);
    else if (dest === 'antigas') X = emOrdem(vivos, X, d, a.imputacao, ctx, reg);
    else if (dest === 'despesasPrimeiro') {
      X = distribuir(vivos.filter(u => u.grupo === 'despesa'), X, d, a.imputacao, ctx, reg);
      if (X > 0.005) X = distribuir(vivos.filter(u => u.grupo === 'cota' && saldoBase(u) > 1e-9), X, d, a.imputacao, ctx, reg);
    } else {
      const alvo = dest.startsWith('grupo:') ? vivos.filter(u => u.grupo === dest.slice(6)) : vivos.filter(u => u.id === dest);
      X = distribuir(alvo, X, d, a.imputacao, ctx, reg);
      // O que sobrar vai para os demais itens, dos mais antigos para os mais novos
      if (X > 0.005) X = emOrdem(vivos.filter(u => saldoBase(u) > 1e-9), X, d, a.imputacao, ctx, reg);
    }
    // Pagamento no prazo do art. 523 (§ 2º): a base da multa e dos honorários passa a ser o restante
    if (art && a.noPrazo) sombras.forEach(s => { s.Pb = s.fonte.Pb; s.Jb = s.fonte.Jb; s.Mb = s.fonte.Mb; });
    const depois = vivos.reduce((s, u) => s + saldoEm(u, d, ctx), 0);
    if (X > 0.005) excedente += X;
    amort.push({ a, data: d, valor: Number(a.valor), antes: r2(antes), imputado: reg, sobra: X > 0.005 ? r2(X) : 0, depois: r2(depois) });
  }
  [...parcelas, ...sombras].forEach(u => acumular(u, dataCalc, ctx));

  // Resultado de cada cota: sem pagamentos, exatamente como a planilha (juros e multa sobre o corrigido arredondado)
  const linha = u => {
    const f = fatorParcela(u, dataCalc, ctx.faltando);
    const corrigido = r2(u.P0 * f);
    const e = { fator: f, corrigido, dias: u.jurosDesde ? Math.max(0, diasEntre(u.jurosDesde, dataCalc)) : 0, pago: r2(u.pago) };
    if (!u.pago && u.P0 > 0) {
      // Mesma ordem de contas da planilha Excel (corrigido × taxa ÷ 100 ÷ 30 × dias), para os centavos baterem
      const unico = u.regimes.length === 1 && u.regimes[0].juros === 'mensal';
      e.juros = unico ? r2(corrigido * Number(u.regimes[0].taxa) / 100 / 30 * e.dias) : r2(corrigido * u.Jb / u.P0);
      e.multa = r2(corrigido * (Number(u.multaPct) || 0) / 100); e.principal = corrigido;
    } else { e.juros = r2(u.Jb * f); e.multa = r2(u.Mb * f); e.principal = r2(u.Pb * f); }
    e.correcao = r2(corrigido - u.P0);
    e.total = r2(e.principal + e.juros + e.multa);
    e.taxa = u.jurosDesde ? taxaJuros(u, u.jurosDesde, dataCalc, new Set(), new Set()) : 0;
    return e;
  };
  const cotas = parcCotas.map(u => ({ c: u.c, valor: u.P0, e: linha(u) }));
  const tc = {
    original: somar(cotas, x => x.valor), corrigido: somar(cotas, x => x.e.corrigido), correcao: somar(cotas, x => x.e.correcao),
    juros: somar(cotas, x => x.e.juros), multa: somar(cotas, x => x.e.multa), pago: somar(cotas, x => x.e.pago), total: somar(cotas, x => x.e.total),
    principal: somar(cotas, x => x.e.principal),
  };
  // Parte do principal (corrigido) quitada pelos pagamentos; juros e multa pagos já saem dos próprios saldos
  tc.amortizado = r2(tc.corrigido - tc.principal);
  // Saldo do principal em valores originários (para a composição do débito no acordo)
  tc.originalRestante = amort.length ? somar(parcCotas, u => u.Pb) : tc.original;
  tc.correcaoRestante = r2(tc.principal - tc.originalRestante);
  const honContr = p.embutir ? 0 : r2(tc.total * p.honContr / 100);
  const debito = r2(tc.total + honContr);

  const despesas = parcDesp.map(u => { const e = linha(u); return { d: u.d, valor: u.P0, fator: e.fator, corrigido: e.corrigido, pago: e.pago, total: e.total }; });
  const td = { original: somar(despesas, x => x.valor), corrigidoBruto: somar(despesas, x => x.corrigido), pago: somar(despesas, x => x.pago), corrigido: somar(despesas, x => x.total) };

  // Honorários sucumbenciais
  const s = cob.sucumbencia || {};
  const suc = { tipo: s.tipo || 'nenhum', valor: 0, base: 0, pct: Number(s.pct) || 0, fator: 1 };
  if (suc.tipo === 'percentual') {
    suc.base = r2(debito + (s.baseDespesas ? td.corrigido : 0));
    suc.valor = r2(suc.base * suc.pct / 100);
  } else if (suc.tipo === 'fixo') {
    suc.original = Number(s.valor) || 0;
    if (s.corrigir && s.data) {
      const r = fatorCorrecao(p.indice, s.data, dataCalc, p.ignorarNegativos);
      suc.fator = r.fator; r.faltando.forEach(m => ctx.faltando.add(m.length === 4 ? `${p.indice} ${m}` : `${p.indice} ${mesNum(m)}`));
    }
    suc.valor = r2(suc.original * suc.fator);
  }

  // Art. 523: base = sombra das cotas (com os honorários contratuais, se escolhido) + despesas e sucumbência, se escolhidos
  let art523 = null;
  if (art) {
    const cotasBase = r2(sombras.filter(u => u.grupo === 'cota').reduce((sm, u) => sm + saldoEm(u, dataCalc, ctx), 0));
    const despBase = r2(sombras.filter(u => u.grupo === 'despesa').reduce((sm, u) => sm + saldoEm(u, dataCalc, ctx), 0));
    const honBase = art.baseHonContr && !p.embutir ? r2(cotasBase * p.honContr / 100) : 0;
    const base = r2(cotasBase + honBase + despBase + (art.baseSuc ? suc.valor : 0));
    const mp = art.incluirMulta === false ? 0 : Number(art.multa) || 0, hp = art.incluirHonorarios === false ? 0 : Number(art.honorarios) || 0;
    art523 = { ...art, cotasBase, honBase, despBase, sucBase: art.baseSuc ? suc.valor : 0, base, multaPct: mp, honPct: hp, multa: r2(base * mp / 100), hon: r2(base * hp / 100) };
    art523.total = r2(art523.multa + art523.hon);
  }

  const simples = regsCota.length === 1 && regsCota[0].juros === 'mensal' && !amort.length && !art523;
  return {
    cob, p, dataCalc, cotas, aVencer, tc, honContr, debito, despesas, td, suc, art523, amort, simples,
    excedente: r2(excedente),
    total: r2(debito + td.corrigido + suc.valor + (art523 ? art523.total : 0)),
    faltando: [...ctx.faltando].sort(), estimados: [...ctx.estimados].sort(),
  };
}

/* ---------- Textos dos critérios ---------- */
const pelo = indice => (indice === 'UFIR-RJ' ? 'pela ' : 'pelo ') + indice;
const descIndice = p => p.indice === 'Nenhum' ? 'sem correção monetária'
  : p.indice + (p.ignorarNegativos && p.indice !== 'UFIR-RJ' ? ' (desconsiderados os índices negativos)' : '');

function descJuros(p) {
  if (p.tipoJuros === 'legal') return 'Juros de mora pela taxa legal (art. 406 do CC; Res. CMN 5.171/2024), simples, pro rata die, sobre o valor corrigido';
  if (p.tipoJuros === 'selic') return 'Juros de mora e correção monetária pela taxa SELIC, pro rata die';
  if (p.tipoJuros === 'nenhum') return 'Sem juros de mora';
  return `Juros de mora: ${fmtPct(p.juros)}% ao mês, pro rata die, sobre o valor corrigido`;
}

function descCriterios(r) {
  const p = r.p;
  const partes = [`Valores atualizados até ${fmtData(r.dataCalc)}.`];
  if (p.tipoJuros !== 'selic') partes.push(`Correção monetária: ${descIndice(p)}${p.indice === 'Nenhum' ? '' : ', desde o vencimento de cada cota'}.`);
  partes.push(descJuros(p) + '.');
  if (p.lei14905) partes.push(`A partir de ${fmtData(DATA_LEI_14905)} (Lei 14.905/2024): correção pelo IPCA e juros pela taxa legal.`);
  partes.push(`Multa: ${fmtPct(p.multa)}% sobre o valor corrigido.`);
  if (!p.embutir && p.honContr) partes.push(`Honorários advocatícios contratuais: ${fmtPct(p.honContr)}% sobre o débito atualizado.`);
  if (r.despesas.length) partes.push('Despesas corrigidas desde a data de cada pagamento' + (r.despesas.some(x => x.d.corrigir === false) ? ', quando indicado' : '') + '.');
  if (r.amort.length) partes.push(`Pagamentos abatidos na data de cada um, imputados ${r.amort.every(x => x.a.imputacao === 'principal') ? 'primeiro no principal' : 'primeiro nos juros e na multa (art. 354 do CC), quando assim indicado'}.`);
  if (r.suc.tipo === 'percentual') partes.push(`Honorários advocatícios sucumbenciais: ${fmtPct(r.suc.pct)}% sobre o débito atualizado${r.suc.base !== r.debito ? ' acrescido das despesas' : ''}.`);
  if (r.suc.tipo === 'fixo') partes.push('Honorários advocatícios sucumbenciais fixados em ' + fmtMoeda(r.suc.original) + (r.suc.fator !== 1 ? `, corrigidos desde ${fmtData(r.cob?.sucumbencia?.data || '')}` : '') + '.');
  if (r.art523) partes.push(`Art. 523, § 1º, do CPC: ${[r.art523.multaPct && `multa de ${fmtPct(r.art523.multaPct)}%`, r.art523.honPct && `honorários de ${fmtPct(r.art523.honPct)}%`].filter(Boolean).join(' e ')} sobre o débito atualizado (cotas${r.art523.honBase ? ', honorários contratuais' : ''}${r.art523.despBase ? ', despesas' : ''}${r.art523.sucBase ? ', honorários sucumbenciais' : ''}); só os pagamentos feitos no prazo reduzem a base (§ 2º).`);
  return partes.join(' ');
}

const notaMetodo = p => {
  const corr = p.tipoJuros === 'selic' ? '' : p.indice === 'UFIR-RJ'
    ? 'Fator de correção: valor da UFIR-RJ do ano do cálculo dividido pelo valor da UFIR-RJ do ano do vencimento (ou do pagamento da despesa). Fonte: SEFAZ-RJ.'
    : p.indice === 'Nenhum' ? '' : `Fator de correção: variação mensal acumulada do ${p.indice} do mês do vencimento (ou do pagamento da despesa) até o mês anterior ao do cálculo. Fonte: Banco Central do Brasil (SGS).`;
  const juros = ['legal', 'selic'].includes(p.tipoJuros) || p.lei14905 ? ' Taxa legal e SELIC: taxa do mês dividida pelos dias corridos do mês, multiplicada pelos dias do período (Res. CMN 5.171/2024, art. 6º). Fonte: Banco Central do Brasil (SGS).' : '';
  return (corr + juros).trim();
};
const notaFaltando = f => f.length ? `Atenção: índice ou taxa não disponível para ${f.join(', ')} (não considerado no cálculo).` : '';
const notaEstimados = e => e.length ? `Taxa ainda não divulgada, estimada pela última disponível: ${e.join('; ')}.` : '';
