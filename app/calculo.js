'use strict';
/*
  Cálculo da cobrança de uma unidade:
  - cotas em aberto: correção monetária desde o vencimento, juros de mora pro rata die sobre o valor corrigido
    e multa sobre o valor corrigido;
  - honorários contratuais: percentual sobre o débito atualizado, em linha própria ou embutidos no valor
    originário de cada cota (o valor originário passa a ser cota × (1 + %), sem menção na planilha);
  - despesas (custas, certidões, registros…): corrigidas desde a data do pagamento, se marcado;
  - honorários sucumbenciais: percentual (sobre o débito, com ou sem as despesas) ou valor fixo corrigido.
*/

const PADROES = { indice: 'UFIR-RJ', multa: 2, juros: 1, honContr: 10, embutir: false, ignorarNegativos: false };

const vazio = x => x === null || x === undefined || x === '';

// Parâmetros efetivos: Configurações → condomínio → cobrança (campos em branco herdam)
function paramsCobranca(cob) {
  const cfg = { ...PADROES, ...(D.config?.padroes || {}) };
  const cond = D.condominios[cob?.condominioId]?.padroes || {};
  const own = cob?.params || {};
  const pegar = (k, num) => {
    for (const fonte of [own, cond]) if (!vazio(fonte[k])) return num ? Number(fonte[k]) : fonte[k];
    return num ? Number(cfg[k]) : cfg[k];
  };
  const embutir = pegar('embutir');
  return {
    indice: pegar('indice'), multa: pegar('multa', true), juros: pegar('juros', true), honContr: pegar('honContr', true),
    embutir: embutir === true || embutir === 'sim', ignorarNegativos: !!cfg.ignorarNegativos,
  };
}

function encargos(valor, venc, dataCalc, p) {
  const dias = Math.max(0, diasEntre(venc, dataCalc));
  if (!dias || valor <= 0) return { dias, fator: 1, corrigido: valor, correcao: 0, juros: 0, multa: 0, total: valor, faltando: [] };
  const { fator, faltando } = fatorCorrecao(p.indice, venc, dataCalc, p.ignorarNegativos);
  const corrigido = r2(valor * fator);
  const juros = r2(corrigido * p.juros / 100 / 30 * dias);
  const multa = r2(corrigido * p.multa / 100);
  return { dias, fator, corrigido, correcao: r2(corrigido - valor), juros, multa, total: r2(corrigido + juros + multa), faltando };
}

const somar = (lista, f) => lista.reduce((s, x) => s + cent(f(x)), 0) / 100;

function calcularCobranca(cob, dataCalc, pIn) {
  const p = pIn || paramsCobranca(cob);
  const faltando = new Set();
  const fatorEmbutir = p.embutir ? 1 + p.honContr / 100 : 1;

  const todas = (cob.cotas || []).filter(c => !c.pago && Number(c.valor) > 0 && c.vencimento)
    .sort((a, b) => comparar(a.vencimento, b.vencimento) || comparar(a.competencia, b.competencia));
  const aVencer = todas.filter(c => c.vencimento >= dataCalc);
  const cotas = todas.filter(c => c.vencimento < dataCalc).map(c => {
    const valor = r2(Number(c.valor) * fatorEmbutir);
    const e = encargos(valor, c.vencimento, dataCalc, p);
    e.faltando.forEach(m => faltando.add(m));
    return { c, valor, e };
  });
  const tc = {
    original: somar(cotas, x => x.valor), corrigido: somar(cotas, x => x.e.corrigido), correcao: somar(cotas, x => x.e.correcao),
    juros: somar(cotas, x => x.e.juros), multa: somar(cotas, x => x.e.multa), total: somar(cotas, x => x.e.total),
  };
  const honContr = p.embutir ? 0 : r2(tc.total * p.honContr / 100);
  const debito = r2(tc.total + honContr);

  const despesas = (cob.despesas || []).filter(d => Number(d.valor) > 0 && d.data && d.data <= dataCalc)
    .sort((a, b) => comparar(a.data, b.data)).map(d => {
      const { fator, faltando: f } = d.corrigir === false ? { fator: 1, faltando: [] } : fatorCorrecao(p.indice, d.data, dataCalc, p.ignorarNegativos);
      f.forEach(m => faltando.add(m));
      return { d, valor: Number(d.valor), fator, corrigido: r2(Number(d.valor) * fator) };
    });
  const td = { original: somar(despesas, x => x.valor), corrigido: somar(despesas, x => x.corrigido) };

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
      suc.fator = r.fator; r.faltando.forEach(m => faltando.add(m));
    }
    suc.valor = r2(suc.original * suc.fator);
  }

  return {
    cob, p, dataCalc, cotas, aVencer, tc, honContr, debito, despesas, td, suc,
    total: r2(debito + td.corrigido + suc.valor),
    faltando: [...faltando].sort(),
  };
}

const descIndice = p => p.indice === 'Nenhum' ? 'sem correção monetária'
  : p.indice + (p.ignorarNegativos && p.indice !== 'UFIR-RJ' ? ' (desconsiderados os índices negativos)' : '');

function descCriterios(r) {
  const p = r.p;
  const partes = [
    `Valores atualizados até ${fmtData(r.dataCalc)}.`,
    `Correção monetária: ${descIndice(p)}${p.indice === 'Nenhum' ? '' : ', desde o vencimento de cada cota'}.`,
    `Juros de mora: ${fmtPct(p.juros)}% ao mês, pro rata die, sobre o valor corrigido.`,
    `Multa: ${fmtPct(p.multa)}% sobre o valor corrigido.`,
  ];
  if (!p.embutir && p.honContr) partes.push(`Honorários advocatícios contratuais: ${fmtPct(p.honContr)}% sobre o débito atualizado.`);
  if (r.despesas.length) partes.push('Despesas corrigidas desde a data de cada pagamento' + (r.despesas.some(x => x.d.corrigir === false) ? ', quando indicado' : '') + '.');
  if (r.suc.tipo === 'percentual') partes.push(`Honorários advocatícios sucumbenciais: ${fmtPct(r.suc.pct)}% sobre o débito atualizado${r.suc.base !== r.debito ? ' acrescido das despesas' : ''}.`);
  if (r.suc.tipo === 'fixo') partes.push('Honorários advocatícios sucumbenciais fixados em ' + fmtMoeda(r.suc.original) + (r.suc.fator !== 1 ? `, corrigidos desde ${fmtData(r.cob?.sucumbencia?.data || '')}` : '') + '.');
  return partes.join(' ');
}

const notaMetodo = p => p.indice === 'UFIR-RJ'
  ? 'Fator de correção: valor da UFIR-RJ do ano do cálculo dividido pelo valor da UFIR-RJ do ano do vencimento (ou do pagamento da despesa). Fonte: SEFAZ-RJ.'
  : p.indice === 'Nenhum' ? '' : `Fator de correção: variação mensal acumulada do ${p.indice} do mês do vencimento (ou do pagamento da despesa) até o mês anterior ao do cálculo. Fonte: Banco Central do Brasil (SGS).`;
const notaFaltando = f => f.length ? `Atenção: índice não disponível para ${descFaltando(f)} (não considerado no fator).` : '';
