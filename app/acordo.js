'use strict';
/*
  Acordos: negociação de um ou mais débitos do mesmo devedor, com desconto, sinal e parcelamento pela Tabela Price;
  acompanhamento dos pagamentos, amortização antecipada, quitação e cálculo do valor devido no descumprimento.

  Tabela Price com data livre para a 1ª parcela:
  - f1 = fator de juros do período até a 1ª parcela: (1+i)^(dias/30) se incidem juros até lá; 1 se não incidem;
  - parcela = saldo × f1 × i ÷ [(1 − (1+i)^−n) × (1+i)]   (com 1ª parcela 30 dias após o acordo e juros, é a Price clássica);
  - prazo informado a parcela: n = −ln(1 − saldo × f1 × i ÷ (parcela × (1+i))) ÷ ln(1+i), arredondado para cima;
  - os centavos de arredondamento vão para a última parcela.
*/

const COMPONENTES_ACORDO = [
  ['original', 'Cotas condominiais (valor originário)'],
  ['correcao', 'Correção monetária'],
  ['juros', 'Juros de mora'],
  ['multa', 'Multa'],
  ['honContr', 'Honorários advocatícios contratuais'],
  ['despesas', 'Despesas'],
  ['suc', 'Honorários advocatícios sucumbenciais'],
  ['a523m', 'Multa do art. 523 do CPC'],
  ['a523h', 'Honorários do art. 523 do CPC'],
];
const SITUACOES_ACORDO = { proposta: 'Proposta', aceito: 'Em andamento', quitado: 'Quitado', descumprido: 'Descumprido', descartado: 'Descartado' };
const chipAcordo = s => `<span class="chip ${s === 'aceito' ? 'aberto' : s === 'quitado' ? 'fechado' : s === 'descumprido' ? 'pendente' : 'neutro'}">${SITUACOES_ACORDO[s] || s}</span>`;

/* ================= Motor ================= */
// Débito consolidado das cobranças escolhidas, atualizado até a data do acordo
function debitoAcordo(cobIds, data) {
  const itens = cobIds.map(id => D.cobrancas[id]).filter(Boolean).map(cob => ({ cob, r: calcularCobranca(cob, data) }));
  const comp = Object.fromEntries(COMPONENTES_ACORDO.map(([k]) => [k, 0]));
  const porCobranca = itens.map(({ cob, r }) => {
    // Com pagamentos, o principal em aberto (originário + correção) já vem descontado do que foi quitado
    const c = { original: r.tc.originalRestante, correcao: r.tc.correcaoRestante, juros: r.tc.juros, multa: r.tc.multa, honContr: r.honContr, despesas: r.td.corrigido, suc: r.suc.valor,
      a523m: r.art523?.multa || 0, a523h: r.art523?.hon || 0 };
    for (const k in c) comp[k] = r2(comp[k] + c[k]);
    return { id: cob.id, rotulo: `${nomeCond(cob)} - ${cob.unidade}`, total: r.total, comp: c, indice: r.p.indice, faltando: r.faltando };
  });
  return { data, comp, total: somar(Object.values(comp), v => v), porCobranca };
}

const valorOuPct = (base, tipo, v) => Math.min(base, Math.max(0, tipo === 'valor' ? r2(parseValor(v)) : r2(base * parseValor(v) / 100)));

// Desconto, sinal e saldo a parcelar
function negociacao(a, deb) {
  const d = a.desconto || { modo: 'total', tipo: 'pct', valor: 0 };
  const descItens = {};
  let desconto;
  if (d.modo === 'itens') {
    for (const [k] of COMPONENTES_ACORDO) { const it = d.itens?.[k] || {}; descItens[k] = valorOuPct(deb.comp[k] || 0, it.tipo, it.valor); }
    desconto = somar(Object.values(descItens), v => v);
  } else desconto = valorOuPct(deb.total, d.tipo, d.valor);
  const negociado = r2(deb.total - desconto);
  const sinal = valorOuPct(negociado, a.sinal?.tipo, a.sinal?.valor);
  return { desconto, descItens, negociado, sinal, saldo: r2(negociado - sinal) };
}

const fatorPeriodo = (i, de, ate) => Math.pow(1 + i, Math.max(0, diasEntre(de, ate)) / 30);

/*
  Plano Price. saldo em de dataBase; f1 = fator de juros até a 1ª parcela; modo 'prazo' (n) ou 'parcela' (valor).
  numeroInicial: numeração das parcelas (para refazer o restante do plano após amortização).
*/
function planoPrice({ saldo, taxa, f1, primeiroVenc, modo, prazo, parcela, numeroInicial = 1 }) {
  const i = (Number(taxa) || 0) / 100;
  if (!(saldo > 0)) return { pmt: 0, n: 0, parcelas: [] };
  if (!ehData(primeiroVenc)) throw new Error('Informe a data de vencimento da 1ª parcela.');
  let n, pmt;
  if (modo === 'parcela') {
    pmt = r2(parseValor(parcela));
    if (!(pmt > 0)) throw new Error('Informe o valor da parcela.');
    if (i === 0) n = Math.ceil(saldo / pmt - 1e-9);
    else {
      const x = saldo * f1 * i / (pmt * (1 + i));
      if (x >= 1) throw new Error(`A parcela de ${fmtMoeda(pmt)} não cobre nem os juros do saldo: o acordo nunca seria quitado. Informe uma parcela maior que ${fmtMoeda(r2(saldo * f1 * i / (1 + i)) + 0.01)}.`);
      n = Math.ceil(-Math.log(1 - x) / Math.log(1 + i) - 1e-9);
    }
  } else {
    n = Math.floor(Number(prazo) || 0);
    if (n < 1) throw new Error('Informe o número de parcelas.');
    pmt = r2(i === 0 ? saldo / n : saldo * f1 * i / ((1 - Math.pow(1 + i, -n)) * (1 + i)));
  }
  if (n > 600) throw new Error('O parcelamento passaria de 600 parcelas. Confira os valores.');
  const dia = +primeiroVenc.slice(8), mes0 = primeiroVenc.slice(0, 7);
  const parcelas = [];
  let B = saldo;
  for (let k = 1; k <= n && B > 0.004; k++) {
    const venc = k === 1 ? primeiroVenc : diaDoMes(addMes(mes0, k - 1), dia);
    const f = k === 1 ? f1 : 1 + i;
    const juros = r2(B * (f - 1)), devido = r2(B + juros);
    const valor = k === n ? devido : Math.min(pmt, devido);
    B = r2(devido - valor);
    parcelas.push({ n: numeroInicial + k - 1, venc, valor, juros, amort: r2(valor - juros), saldo: B, pago: 0 });
  }
  return { pmt, n: parcelas.length, parcelas };
}

// Proposta completa (para a tela, o PDF e a gravação)
function calcularAcordo(a) {
  const deb = a.situacao === 'proposta' || !a.debito ? debitoAcordo(a.cobrancas || [], a.data) : a.debito;
  const neg = negociacao(a, deb);
  const p = a.parcelamento || {};
  const i = (Number(p.taxa) || 0) / 100;
  const f1 = p.jurosAte1 === false ? 1 : fatorPeriodo(i, a.data, p.primeiroVenc);
  const plano = neg.saldo > 0 ? planoPrice({ saldo: neg.saldo, taxa: p.taxa, f1, primeiroVenc: p.primeiroVenc, modo: p.modo, prazo: p.prazo, parcela: p.parcela }) : { pmt: 0, n: 0, parcelas: [] };
  const totalParcelas = somar(plano.parcelas, x => x.valor), totalJuros = somar(plano.parcelas, x => x.juros);
  // Rateio: parte de honorários advocatícios (contratuais e sucumbenciais) no valor negociado, depois do desconto
  const descDe = k => a.desconto?.modo === 'itens' ? neg.descItens[k] || 0 : deb.total ? neg.desconto * (deb.comp[k] || 0) / deb.total : 0;
  const honNeg = r2(['honContr', 'suc', 'a523h'].reduce((s, k) => s + (deb.comp[k] || 0) - descDe(k), 0));
  const propHon = neg.negociado > 0 ? Math.max(0, Math.min(1, honNeg / neg.negociado)) : 0;
  return { deb, ...neg, plano, f1, totalParcelas, totalJuros, totalAcordo: r2(neg.sinal + totalParcelas), honNeg, propHon };
}

// Divide um valor entre o condomínio e os honorários, na proporção do débito negociado
function rateio(valor, propHon) {
  const hon = r2(valor * propHon);
  return { hon, cond: r2(valor - hon) };
}

/* ---------- Acompanhamento ---------- */
const parcelasDoAcordo = a => [
  ...(a.sinalParcela ? [a.sinalParcela] : []),
  ...(a.plano || []),
];
const restanteNominal = p => r2(Math.max(0, p.valor - (p.pago || 0)));
const indiceAcordo = a => a.parcelamento?.indice || 'Nenhum';
const fatorAcordo = (a, ate) => fatorCorrecao(indiceAcordo(a), a.data, ate, !!D.config?.padroes?.ignorarNegativos);

// Valor devido de uma parcela (ou do restante dela) numa data: correção desde o acordo e, se em atraso, juros e multa
function devidoParcela(a, p, data) {
  const base = restanteNominal(p);
  const { fator, faltando } = fatorAcordo(a, data);
  const corrigido = r2(base * fator);
  const dias = Math.max(0, diasEntre(p.venc, data));
  const enc = a.encargos || {};
  const juros = dias ? r2(corrigido * (Number(enc.juros) || 0) / 100 / 30 * dias) : 0;
  const multa = dias ? r2(corrigido * (Number(enc.multa) || 0) / 100) : 0;
  return { base, fator, corrigido, dias, juros, multa, total: r2(corrigido + juros + multa), faltando };
}

// Saldo das parcelas futuras numa data (principal da Price + juros do período corrido, em valores do acordo)
function saldoFuturo(a, data) {
  const plano = a.plano || [];
  const vencidas = plano.filter(p => p.venc <= data);
  const futurasTodas = plano.filter(p => p.venc > data);
  const futuras = futurasTodas.filter(p => restanteNominal(p) > 0);
  if (!futuras.length) return { saldo: 0, ref: data, futuras };
  const ult = vencidas[vencidas.length - 1];
  const i = (Number(a.parcelamento?.taxa) || 0) / 100;
  const B = ult ? ult.saldo : a.saldoInicial;
  const ref = ult ? ult.venc : a.data;
  // Antes da 1ª parcela, sem juros até ela: o saldo não rende juros
  const f = !ult && a.parcelamento?.jurosAte1 === false ? 1 : fatorPeriodo(i, ref, data);
  // Parcelas futuras pagas antes do vencimento (no todo ou em parte) reduzem o saldo pelo valor pago
  const pagoFuturo = somar(futurasTodas, p => p.pago || 0);
  return { saldo: r2(Math.max(0, B * f - pagoFuturo)), ref, futuras, B };
}

// Quitação (ou vencimento antecipado) numa data: parcelas vencidas em aberto, com encargos, + saldo futuro corrigido
function valorQuitacao(a, data) {
  const vencidas = parcelasDoAcordo(a).filter(p => p.venc <= data && restanteNominal(p) > 0).map(p => ({ p, d: devidoParcela(a, p, data) }));
  const sf = saldoFuturo(a, data);
  const { fator } = fatorAcordo(a, data);
  const futuroCorrigido = r2(sf.saldo * fator);
  return { vencidas, totalVencidas: somar(vencidas, x => x.d.total), saldoFuturo: sf.saldo, fator, futuroCorrigido, total: r2(somar(vencidas, x => x.d.total) + futuroCorrigido) };
}

// Descumprimento: vencimento antecipado do saldo do acordo ou perda do desconto (débito original menos pagamentos)
function valorDescumprimento(a, data, modo, multaPct) {
  const pagamentos = (a.eventos || []).filter(e => e.valor > 0 && ['pagamento', 'amortizacao'].includes(e.tipo));
  if (modo === 'original') {
    const deb = debitoAcordo(a.cobrancas || [], data);
    const indice = deb.porCobranca[0]?.indice || 'Nenhum';
    const pags = pagamentos.map(e => { const { fator } = fatorCorrecao(indice, e.data, data, !!D.config?.padroes?.ignorarNegativos); return { e, fator, corrigido: r2(e.valor * fator) }; });
    const abatido = somar(pags, x => x.corrigido);
    const base = r2(Math.max(0, deb.total - abatido));
    const multa = r2(base * (Number(multaPct) || 0) / 100);
    return { modo, deb, indice, pags, abatido, base, multa, total: r2(base + multa) };
  }
  const q = valorQuitacao(a, data);
  const multa = r2(q.total * (Number(multaPct) || 0) / 100);
  return { modo: 'saldo', q, base: q.total, multa, total: r2(q.total + multa) };
}

/* ---------- Lançamentos (alteram o acordo; cada um guarda o plano anterior para poder desfazer) ---------- */
function novoEvento(a, ev) {
  a.eventos = a.eventos || [];
  ev.id = novoId(); ev.em = new Date().toISOString(); ev.por = Auth.usuario?.nome || '';
  ev.antes = JSON.stringify({ plano: a.plano, sinalParcela: a.sinalParcela, situacao: a.situacao });
  a.eventos.push(ev);
  return ev;
}

function lancarPagamento(a, { n, data, valor, obs }) {
  const p = parcelasDoAcordo(a).find(x => x.n === n);
  if (!p) throw new Error('Parcela não encontrada.');
  if (!ehData(data)) throw new Error('Informe a data do pagamento.');
  valor = r2(parseValor(valor));
  if (!(valor > 0)) throw new Error('Informe o valor pago.');
  const d = devidoParcela(a, p, data);
  if (valor > d.total + 0.009) throw new Error(`O valor pago é maior que o devido nesta parcela (${fmtMoeda(d.total)}). Lance a diferença como amortização antecipada.`);
  const ev = novoEvento(a, { tipo: 'pagamento', parcela: n, data, valor, obs, devido: d.total });
  // Converte o valor pago para o valor nominal da parcela (sem correção e encargos)
  const nominal = valor >= d.total - 0.009 ? d.base : r2(valor * d.base / d.total);
  p.pago = r2((p.pago || 0) + nominal);
  ev.nominal = nominal;
  atualizarSituacao(a);
}

function lancarAmortizacao(a, { data, valor, efeito, obs }) {
  if (!ehData(data)) throw new Error('Informe a data da amortização.');
  valor = r2(parseValor(valor));
  if (!(valor > 0)) throw new Error('Informe o valor.');
  const atrasadas = parcelasDoAcordo(a).filter(p => p.venc <= data && restanteNominal(p) > 0);
  if (atrasadas.length) throw new Error(`Há parcela(s) vencida(s) em aberto (${atrasadas.map(p => p.n || 'sinal').join(', ')}). Registre esses pagamentos antes da amortização.`);
  const sf = saldoFuturo(a, data);
  if (!sf.futuras.length) throw new Error('Não há parcelas futuras para amortizar.');
  if (sf.futuras[0].pago > 0) throw new Error(`A parcela ${sf.futuras[0].n} foi paga em parte. Complete o pagamento dela antes da amortização.`);
  const { fator } = fatorAcordo(a, data);
  const nominal = r2(valor / fator);
  if (nominal >= sf.saldo - 0.009) throw new Error(`O valor quita o acordo. Use "Quitar o acordo" (valor para quitação: ${fmtMoeda(r2(sf.saldo * fator))}).`);
  const novoSaldo = r2(sf.saldo - nominal);
  const i = (Number(a.parcelamento?.taxa) || 0) / 100;
  const prox = sf.futuras[0];
  // Ainda antes da 1ª parcela e sem juros até ela: continua sem juros até a próxima parcela
  const f1 = a.parcelamento?.jurosAte1 === false && !a.plano.some(p => p.venc <= data) ? 1 : fatorPeriodo(i, data, prox.venc);
  const novo = planoPrice({ saldo: novoSaldo, taxa: a.parcelamento?.taxa, f1, primeiroVenc: prox.venc, numeroInicial: prox.n,
    ...(efeito === 'parcela' ? { modo: 'prazo', prazo: sf.futuras.length } : { modo: 'parcela', parcela: prox.valor }) });
  const ev = novoEvento(a, { tipo: 'amortizacao', data, valor, obs, efeito, nominal, saldoAntes: sf.saldo, saldoDepois: novoSaldo });
  // Mantém as parcelas vencidas e as futuras já pagas; refaz as demais a partir da próxima em aberto
  a.plano = [...a.plano.filter(p => p.venc <= data || (restanteNominal(p) <= 0 && p.n < prox.n)), ...novo.parcelas];
  ev.resumo = efeito === 'parcela' ? `${novo.n} parcela(s) de ${fmtMoeda(novo.pmt)}` : `${novo.n} parcela(s) restante(s)`;
}

function lancarQuitacao(a, { data, valor, obs }) {
  if (!ehData(data)) throw new Error('Informe a data da quitação.');
  const q = valorQuitacao(a, data);
  valor = r2(parseValor(valor));
  if (valor < q.total - 0.009) throw new Error(`O valor para quitação em ${fmtData(data)} é ${fmtMoeda(q.total)}.`);
  novoEvento(a, { tipo: 'quitacao', data, valor, obs, devido: q.total });
  for (const p of parcelasDoAcordo(a)) p.pago = p.valor;
  a.situacao = 'quitado';
}

function lancarDescumprimento(a, { data, modo, multa, obs }) {
  if (!ehData(data)) throw new Error('Informe a data do descumprimento.');
  const r = valorDescumprimento(a, data, modo, multa);
  novoEvento(a, { tipo: 'descumprimento', data, valor: 0, modo, multa: Number(multa) || 0, obs, devido: r.total });
  a.situacao = 'descumprido';
}

function desfazerUltimo(a) {
  const ev = (a.eventos || []).pop();
  if (!ev) throw new Error('Não há lançamentos para desfazer.');
  const antes = JSON.parse(ev.antes);
  a.plano = antes.plano; a.sinalParcela = antes.sinalParcela; a.situacao = antes.situacao;
  return ev;
}

function atualizarSituacao(a) {
  if (a.situacao === 'aceito' && parcelasDoAcordo(a).every(p => restanteNominal(p) <= 0)) a.situacao = 'quitado';
}

const descEvento = e => ({
  pagamento: `Pagamento da ${e.parcela ? 'parcela ' + e.parcela : 'entrada (sinal)'}`,
  amortizacao: `Amortização antecipada (${e.efeito === 'parcela' ? 'reduz a parcela' : 'reduz o prazo'})${e.resumo ? ': ' + e.resumo : ''}`,
  quitacao: 'Quitação do acordo',
  descumprimento: `Descumprimento informado (${e.modo === 'original' ? 'perda do desconto' : 'vencimento antecipado do saldo'})`,
}[e.tipo] || e.tipo);

/* ================= Telas ================= */
const rotuloCobranca = cob => `${nomeCond(cob)} - ${cob.unidade || 'Unidade'}`;
const devedorDoAcordo = a => listaDevedores().find(d => d.chave === a.devedor) || { nome: a.devedorNome || '—', documento: '' };
const acordosDaCobranca = id => Object.values(D.acordos || {}).filter(a => (a.cobrancas || []).includes(id));
const opcaoTipo = (nome, tipo) => `<select data-tipo="${nome}" class="sel-tipo"><option value="pct" ${tipo !== 'valor' ? 'selected' : ''}>%</option><option value="valor" ${tipo === 'valor' ? 'selected' : ''}>R$</option></select>`;
const mostrarValor = (tipo, v) => vazio(v) ? '' : tipo === 'valor' ? fmtNum(parseValor(v)) : fmtPct(parseValor(v));

function telaAcordos() {
  const lista = Object.values(D.acordos || {}).sort((a, b) => comparar(b.data, a.data));
  const hojeD = hoje();
  const proxima = a => {
    if (a.situacao !== 'aceito') return '';
    const abertas = parcelasDoAcordo(a).filter(p => restanteNominal(p) > 0);
    const vencidas = abertas.filter(p => p.venc < hojeD);
    if (vencidas.length) return `<span class="chip pendente">${vencidas.length} vencida(s)</span>`;
    return abertas[0] ? `Próxima: ${fmtData(abertas[0].venc)}` : '';
  };
  $('#conteudo').innerHTML = cabecalho('Acordos', 'Negociação de débitos com desconto, entrada e parcelamento, e acompanhamento dos pagamentos.', '<a class="bt primario" href="#/acordo/novo">Novo acordo</a>') +
    `<div class="cartao">${lista.length ? `<div class="rolagem"><table class="tabela clicavel"><thead><tr><th>Data</th><th>Devedor</th><th>Débitos</th><th class="num">Valor do acordo</th><th>Situação</th><th></th></tr></thead><tbody>
      ${lista.map(a => `<tr data-id="${a.id}"><td>${fmtData(a.data)}</td><td>${esc(devedorDoAcordo(a).nome)}</td>
        <td>${esc((a.cobrancas || []).map(id => D.cobrancas[id] ? rotuloCobranca(D.cobrancas[id]) : '(cobrança excluída)').join('; '))}</td>
        <td class="num">${a.resumo ? fmtNum(a.resumo.negociado) : ''}</td><td>${chipAcordo(a.situacao)}</td><td>${proxima(a)}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="vazio">Nenhum acordo. Use "Novo acordo" ou o botão "Negociar acordo" na tela da cobrança.</p>'}</div>`;
  $$('tr[data-id]').forEach(tr => tr.addEventListener('click', () => { location.hash = '#/acordo/' + tr.dataset.id; }));
}

function novoAcordo(params) {
  const cob = D.cobrancas[params.get('cob')];
  const dev = cob ? (cob.devedores || []).find(d => d.nome) : null;
  const p = cob ? paramsCobranca(cob) : { ...PADROES, ...(D.config?.padroes || {}) };
  const d0 = hoje();
  return {
    id: novoId(), situacao: 'proposta', data: d0,
    devedor: params.get('dev') || (dev ? chaveDevedor(dev) : ''), cobrancas: cob ? [cob.id] : [],
    desconto: { modo: 'total', tipo: 'pct', valor: '', itens: {} },
    sinal: { tipo: 'valor', valor: '', data: d0 },
    parcelamento: { modo: 'prazo', prazo: 12, parcela: '', taxa: 1, primeiroVenc: diaDoMes(addMes(d0.slice(0, 7), 1), +d0.slice(8)), jurosAte1: true, indice: p.indice },
    encargos: { multa: p.multa, juros: p.juros },
    quebra: { modo: 'saldo', multa: 0 },
    obs: '', eventos: [],
  };
}

async function telaAcordo(id, params) {
  await garantirIndices();
  const nova = !id || id === 'novo';
  const salvo = nova ? null : D.acordos[id];
  if (!nova && !salvo) throw new Error('Acordo não encontrado.');
  const a = nova ? novoAcordo(params) : structuredClone(salvo);
  if (a.situacao === 'proposta') return editorAcordo(a, nova);
  return acompanhamentoAcordo(a);
}

/* ---------- Proposta ---------- */
function editorAcordo(a, nova) {
  const devs = listaDevedores(Object.values(D.cobrancas).filter(c => (c.situacao || 'ativa') === 'ativa'));
  const pc = a.parcelamento;
  $('#conteudo').innerHTML = cabecalho(nova ? 'Novo acordo' : 'Proposta de acordo', nova ? '' : chipAcordo(a.situacao), '', '#/acordos') + `
  <div class="cartao"><h2>Devedor e débitos</h2>
    <div class="grade-form">
      <div class="campo w2"><label>Devedor</label><select id="acDev"><option value="">— escolha —</option>${devs.map(d => `<option value="${esc(d.chave)}" ${d.chave === a.devedor ? 'selected' : ''}>${esc(d.nome)}${d.documento ? ' - ' + esc(fmtDoc(d.documento)) : ''}</option>`).join('')}</select></div>
      <div class="campo"><label>Data do acordo</label><input type="date" id="acData" value="${a.data}"></div>
    </div>
    <p class="dica" style="margin-top:10px">Marque as cobranças incluídas no acordo (um mesmo devedor pode ter várias). O débito é atualizado até a data do acordo.</p>
    <div id="acCobs"></div></div>

  <div class="cartao"><h2>Débito e desconto</h2>
    <div class="segmentado"><label><input type="radio" name="acModoDesc" value="total" ${a.desconto.modo !== 'itens' ? 'checked' : ''}> Desconto sobre o total</label>
      <label><input type="radio" name="acModoDesc" value="itens" ${a.desconto.modo === 'itens' ? 'checked' : ''}> Desconto item a item</label></div>
    <div id="acDescTotal" class="linha-desc"><label>Desconto</label>${opcaoTipo('descTotal', a.desconto.tipo)}<input id="acDescValor" inputmode="decimal" value="${esc(mostrarValor(a.desconto.tipo, a.desconto.valor))}" placeholder="0"></div>
    <div id="acComp" class="rolagem" style="margin-top:10px"></div></div>

  <div class="cartao"><h2>Entrada (sinal)</h2>
    <div class="grade-form">
      <div class="campo"><label>Entrada</label><div class="campo-bt">${opcaoTipo('sinal', a.sinal.tipo)}<input id="acSinalValor" inputmode="decimal" value="${esc(mostrarValor(a.sinal.tipo, a.sinal.valor))}" placeholder="0"></div><small>Em R$ ou em % do valor com desconto.</small></div>
      <div class="campo"><label>Data de pagamento da entrada</label><input type="date" id="acSinalData" value="${a.sinal.data || a.data}"></div>
    </div></div>

  <div class="cartao"><h2>Parcelamento (Tabela Price)</h2>
    <div class="segmentado"><label><input type="radio" name="acModoParc" value="prazo" ${pc.modo !== 'parcela' ? 'checked' : ''}> Informar o prazo (calcula a parcela)</label>
      <label><input type="radio" name="acModoParc" value="parcela" ${pc.modo === 'parcela' ? 'checked' : ''}> Informar a parcela (calcula o prazo)</label></div>
    <div class="grade-form" style="margin-top:12px">
      <div class="campo so-prazo"><label>Número de parcelas</label><input id="acPrazo" type="number" min="1" max="600" value="${esc(pc.prazo)}"></div>
      <div class="campo so-parcela"><label>Valor da parcela (R$)</label><input id="acParcela" inputmode="decimal" value="${esc(pc.parcela ? fmtNum(parseValor(pc.parcela)) : '')}"></div>
      <div class="campo"><label>Juros (% ao mês)</label><input id="acTaxa" inputmode="decimal" value="${esc(fmtPct(pc.taxa))}"></div>
      <div class="campo"><label>Vencimento da 1ª parcela</label><input type="date" id="acPrimeiro" value="${pc.primeiroVenc}"></div>
      <div class="campo w2"><label class="inline" style="margin-top:6px"><input type="checkbox" id="acJuros1" ${pc.jurosAte1 !== false ? 'checked' : ''}> Incidem juros da data do acordo até a 1ª parcela</label>
        <small>Desmarcado: a 1ª parcela não tem juros (o prazo até ela é de carência sem juros).</small></div>
      <div class="campo"><label>Correção das parcelas</label><select id="acIndice">${INDICES.map(i => `<option ${pc.indice === i ? 'selected' : ''}>${i}</option>`).join('')}</select></div>
    </div></div>

  <div class="cartao"><h2>Atraso e descumprimento</h2>
    <div class="grade-form">
      <div class="campo"><label>Multa por atraso de parcela (%)</label><input id="acMulta" inputmode="decimal" value="${esc(fmtPct(a.encargos.multa))}"></div>
      <div class="campo"><label>Juros de mora (% ao mês)</label><input id="acMora" inputmode="decimal" value="${esc(fmtPct(a.encargos.juros))}"></div>
      <div class="campo w2"><label>Se o acordo for descumprido</label><select id="acQuebra"><option value="saldo">Vencimento antecipado do saldo do acordo</option><option value="original" ${a.quebra.modo === 'original' ? 'selected' : ''}>Perda do desconto: débito original, abatidos os pagamentos</option></select></div>
      <div class="campo"><label>Multa pelo descumprimento (%)</label><input id="acMultaQuebra" inputmode="decimal" value="${esc(fmtPct(a.quebra.multa))}"></div>
      <div class="campo wfull"><label>Observações (saem no PDF)</label><textarea id="acObs" rows="2">${esc(a.obs || '')}</textarea></div>
    </div></div>

  <div class="cartao destaque"><h2>Resultado</h2><div id="acResultado"></div>
    <label class="inline" style="margin-top:10px"><input type="checkbox" id="acDetalhe" checked> Incluir no PDF a planilha de débito detalhada de cada cobrança</label>
    <div class="acoes-linha"><button class="bt" id="acVer">Visualizar PDF</button><button class="bt" id="acPdf">Salvar PDF</button><button class="bt" id="acXlsx">Salvar Excel</button></div></div>

  <div class="barra-salvar"><span id="estadoSalvar"></span>
    ${nova ? '' : `${Auth.ehAdmin() ? '<button class="bt perigo" id="acExcluir">Excluir</button>' : ''}<button class="bt" id="acDescartar">Descartar proposta</button>`}
    <button class="bt" id="acSalvar">Salvar proposta</button><button class="bt primario" id="acAceitar">Acordo aceito</button></div>`;

  const ler = () => {
    a.devedor = $('#acDev').value; a.data = $('#acData').value;
    a.desconto.modo = $('input[name=acModoDesc]:checked').value;
    a.desconto.tipo = $('[data-tipo=descTotal]').value; a.desconto.valor = $('#acDescValor').value;
    $$('#acComp [data-item]').forEach(inp => { const k = inp.dataset.item; a.desconto.itens[k] = { tipo: $(`[data-tipo="it-${k}"]`).value, valor: inp.value }; });
    a.sinal = { tipo: $('[data-tipo=sinal]').value, valor: $('#acSinalValor').value, data: $('#acSinalData').value };
    Object.assign(a.parcelamento, { modo: $('input[name=acModoParc]:checked').value, prazo: $('#acPrazo').value, parcela: $('#acParcela').value,
      taxa: parseValor($('#acTaxa').value), primeiroVenc: $('#acPrimeiro').value, jurosAte1: $('#acJuros1').checked, indice: $('#acIndice').value });
    a.encargos = { multa: parseValor($('#acMulta').value), juros: parseValor($('#acMora').value) };
    a.quebra = { modo: $('#acQuebra').value, multa: parseValor($('#acMultaQuebra').value) };
    a.obs = $('#acObs').value;
  };
  const mostrarModos = () => {
    $('#acDescTotal').hidden = $('input[name=acModoDesc]:checked').value === 'itens';
    $$('.so-prazo').forEach(e => { e.hidden = $('input[name=acModoParc]:checked').value !== 'prazo'; });
    $$('.so-parcela').forEach(e => { e.hidden = $('input[name=acModoParc]:checked').value !== 'parcela'; });
  };

  function desenharCobs() {
    const dev = devs.find(d => d.chave === a.devedor);
    const cobs = dev ? dev.cobs : [];
    a.cobrancas = a.cobrancas.filter(id => cobs.some(c => c.id === id));
    if (!a.cobrancas.length && cobs.length === 1) a.cobrancas = [cobs[0].id];
    $('#acCobs').innerHTML = cobs.length ? cobs.map(c => `<label class="linha-cob"><input type="checkbox" data-cob="${c.id}" ${a.cobrancas.includes(c.id) ? 'checked' : ''}>
        <span><b>${esc(rotuloCobranca(c))}</b> <span class="dica">${c.tipo === 'judicial' ? 'Judicial' + (c.processo ? ' ' + esc(c.processo) : '') : 'Extrajudicial'}</span></span>
        <span class="num">${ehData(a.data) ? fmtMoeda(calcularCobranca(c, a.data).total) : ''}</span></label>`).join('')
      : '<p class="vazio">Escolha o devedor.</p>';
    $$('#acCobs [data-cob]').forEach(ch => ch.addEventListener('change', () => {
      a.cobrancas = $$('#acCobs [data-cob]:checked').map(x => x.dataset.cob);
      marcarSujo(); desenharComp(); recalcular();
    }));
  }

  function desenharComp() {
    if (!a.cobrancas.length || !ehData(a.data)) { $('#acComp').innerHTML = ''; return; }
    const deb = debitoAcordo(a.cobrancas, a.data);
    const itens = a.desconto.modo === 'itens';
    $('#acComp').innerHTML = `<table class="tabela tabela-edit"><thead><tr><th>Componente</th><th class="num">Débito atualizado</th>${itens ? '<th>Desconto</th>' : ''}<th class="num">Desconto</th><th class="num">Valor negociado</th></tr></thead><tbody>
      ${COMPONENTES_ACORDO.filter(([k]) => deb.comp[k]).map(([k, rot]) => { const it = a.desconto.itens[k] || {}; return `<tr><td>${rot}</td><td class="num">${fmtNum(deb.comp[k])}</td>
        ${itens ? `<td><div class="campo-bt">${opcaoTipo('it-' + k, it.tipo)}<input data-item="${k}" inputmode="decimal" value="${esc(mostrarValor(it.tipo, it.valor))}" placeholder="0" style="max-width:110px"></div></td>` : ''}
        <td class="num" data-desc="${k}"></td><td class="num" data-neg="${k}"></td></tr>`; }).join('')}
      <tr class="subtotal"><td>Total</td><td class="num">${fmtNum(deb.total)}</td>${itens ? '<td></td>' : ''}<td class="num" id="acTotDesc"></td><td class="num" id="acTotNeg"></td></tr></tbody></table>
      ${deb.porCobranca.length > 1 ? `<p class="dica">${deb.porCobranca.map(x => `${esc(x.rotulo)}: ${fmtMoeda(x.total)}`).join(' · ')}</p>` : ''}`;
    $$('#acComp input, #acComp select').forEach(el => el.addEventListener('input', () => { marcarSujo(); recalcularLogo(); }));
  }

  let tmr;
  const recalcularLogo = () => { clearTimeout(tmr); tmr = setTimeout(recalcular, 250); };
  let calc = null;
  function recalcular() {
    ler();
    calc = null;
    if (!a.cobrancas.length) { $('#acResultado').innerHTML = '<p class="vazio">Escolha o devedor e as cobranças.</p>'; return; }
    try { calc = calcularAcordo(a); }
    catch (e) { $('#acResultado').innerHTML = `<p class="alerta">${esc(e.message)}</p>`; return; }
    // Coluna de desconto da tabela de composição
    const itens = a.desconto.modo === 'itens';
    for (const [k] of COMPONENTES_ACORDO) {
      const dd = itens ? calc.descItens[k] || 0 : calc.deb.total ? r2(calc.desconto * (calc.deb.comp[k] || 0) / calc.deb.total) : 0;
      const c1 = $(`[data-desc="${k}"]`), c2 = $(`[data-neg="${k}"]`);
      if (c1) { c1.textContent = itens ? fmtNum(dd) : ''; c2.textContent = itens ? fmtNum(r2((calc.deb.comp[k] || 0) - dd)) : ''; }
    }
    if ($('#acTotDesc')) { $('#acTotDesc').textContent = fmtNum(calc.desconto); $('#acTotNeg').textContent = fmtNum(calc.negociado); }
    $('#acResultado').innerHTML = resultadoAcordoHTML(a, calc);
  }

  $('#acDev').addEventListener('change', () => { a.devedor = $('#acDev').value; a.cobrancas = []; marcarSujo(); desenharCobs(); desenharComp(); recalcular(); });
  $('#acData').addEventListener('change', () => { a.data = $('#acData').value; marcarSujo(); desenharCobs(); desenharComp(); recalcular(); });
  $$('input[name=acModoDesc]').forEach(r => r.addEventListener('change', () => { ler(); mostrarModos(); desenharComp(); recalcular(); marcarSujo(); }));
  $$('input[name=acModoParc]').forEach(r => r.addEventListener('change', () => { mostrarModos(); recalcular(); marcarSujo(); }));
  ['acDescValor', 'acSinalValor', 'acSinalData', 'acPrazo', 'acParcela', 'acTaxa', 'acPrimeiro', 'acJuros1', 'acIndice', 'acMulta', 'acMora', 'acQuebra', 'acMultaQuebra', 'acObs']
    .forEach(i => $('#' + i).addEventListener(['acJuros1', 'acIndice', 'acQuebra', 'acSinalData', 'acPrimeiro'].includes(i) ? 'change' : 'input', () => { marcarSujo(); recalcularLogo(); }));
  $$('[data-tipo=descTotal], [data-tipo=sinal]').forEach(s => s.addEventListener('change', () => { marcarSujo(); recalcular(); }));
  mostrarModos(); desenharCobs(); desenharComp(); recalcular();

  const validar = () => {
    ler();
    if (!a.devedor || !a.cobrancas.length) throw new Error('Escolha o devedor e ao menos uma cobrança.');
    if (!ehData(a.data)) throw new Error('Informe a data do acordo.');
    calc = calcularAcordo(a);
    if (calc.sinal > 0 && !ehData(a.sinal.data)) throw new Error('Informe a data de pagamento da entrada.');
    return calc;
  };
  const gravar = async () => {
    const c = validar();
    a.devedorNome = devedorDoAcordo(a).nome;
    a.resumo = { total: c.deb.total, desconto: c.desconto, negociado: c.negociado, sinal: c.sinal, saldo: c.saldo, n: c.plano.n, pmt: c.plano.pmt, propHon: c.propHon };
    const g = await salvarRegistro('acordos', a);
    a.rev = g.rev;
    sujo = false;
    return g;
  };
  $('#acSalvar').addEventListener('click', () => executar(async () => {
    const g = await gravar(); aviso('Proposta salva.');
    if (nova) { ignorarHash = true; location.hash = '#/acordo/' + g.id; hashAnterior = location.hash; }
  }));
  $('#acAceitar').addEventListener('click', () => executar(async () => {
    const c = validar();
    if (!confirm(`Registrar o acordo como ACEITO?\n\nValor negociado: ${fmtMoeda(c.negociado)}${c.sinal ? `\nEntrada: ${fmtMoeda(c.sinal)}` : ''}\n${c.plano.n} parcela(s) de ${fmtMoeda(c.plano.pmt)}\n\nOs valores ficam fixados e passa a valer o acompanhamento dos pagamentos.`)) return;
    a.situacao = 'aceito';
    a.aceitoEm = new Date().toISOString();
    a.debito = c.deb; a.saldoInicial = c.saldo;
    a.sinalParcela = c.sinal > 0 ? { n: 0, venc: a.sinal.data, valor: c.sinal, juros: 0, amort: c.sinal, saldo: c.saldo, pago: 0 } : null;
    a.plano = c.plano.parcelas;
    const g = await gravar();
    aviso('Acordo registrado.');
    ignorarHash = true; location.hash = '#/acordo/' + g.id; hashAnterior = location.hash;
    acompanhamentoAcordo(structuredClone(D.acordos[g.id]));
  }));
  $('#acDescartar')?.addEventListener('click', () => executar(async () => {
    if (!confirm('Marcar esta proposta como descartada?')) return;
    a.situacao = 'descartado'; await gravar(); aviso('Proposta descartada.'); location.hash = '#/acordos';
  }));
  $('#acExcluir')?.addEventListener('click', () => executar(async () => {
    if (!confirm('Excluir esta proposta? O arquivo vai para a lixeira.')) return;
    await excluirRegistro('acordos', a.id); sujo = false; location.hash = '#/acordos';
  }));
  const exportar = f => executar(async () => { const c = validar(); await exportarAcordo(f, a, c, $('#acDetalhe').checked); });
  $('#acVer').addEventListener('click', () => exportar('ver'));
  $('#acPdf').addEventListener('click', () => exportar('pdf'));
  $('#acXlsx').addEventListener('click', () => exportar('xlsx'));
}

function resultadoAcordoHTML(a, c) {
  const pc = a.parcelamento;
  const linhas = [
    ['Débito atualizado em ' + fmtData(a.data), c.deb.total],
    ...(c.desconto ? [['(−) Desconto', -c.desconto], ['(=) Valor negociado', c.negociado, 'dest']] : []),
    ...(c.sinal ? [[`(−) Entrada em ${fmtData(a.sinal.data)}`, -c.sinal]] : []),
    ['(=) Saldo a parcelar', c.saldo, 'dest'],
  ];
  const cond = c.plano.n ? `${c.plano.n} parcela(s) de ${fmtMoeda(c.plano.pmt)}${c.plano.parcelas.length && c.plano.parcelas[c.plano.parcelas.length - 1].valor !== c.plano.pmt ? ` (última de ${fmtMoeda(c.plano.parcelas[c.plano.parcelas.length - 1].valor)})` : ''}, a 1ª em ${fmtData(pc.primeiroVenc)}, juros de ${fmtPct(pc.taxa)}% ao mês (Tabela Price)` : 'Sem parcelamento';
  return `<div class="colunas2"><div class="resumo">${linhas.map(([r, v, e]) => `<div class="res-l ${e || ''}"><span>${r}</span><b>${fmtMoeda(Math.abs(v)).replace('R$', v < 0 ? '−R$' : 'R$')}</b></div>`).join('')}
      <div class="res-l final"><span>Total a pagar pelo acordo</span><b>${fmtMoeda(c.totalAcordo)}</b></div></div>
    <div><p><b>${cond}.</b></p><p class="dica">Total de juros do parcelamento: ${fmtMoeda(c.totalJuros)}.${c.desconto ? ` Desconto concedido: ${fmtMoeda(c.desconto)} (${fmtPct(r2(c.desconto / c.deb.total * 100))}% do débito).` : ''}</p>
      <p class="dica">${esc(clausulasAcordo(a).join(' '))}</p></div></div>
    ${c.plano.parcelas.length ? (() => {
      const rat = c.propHon > 0, rc = v => { const x = rateio(v, c.propHon); return rat ? `<td class="num">${fmtNum(x.cond)}</td><td class="num">${fmtNum(x.hon)}</td>` : ''; };
      const linhas = [...(c.sinal ? [['Entrada', a.sinal.data, c.sinal, null, c.sinal, c.saldo]] : []), ...c.plano.parcelas.map(p => [p.n, p.venc, p.valor, p.juros, p.amort, p.saldo])];
      const somaR = rat ? linhas.reduce((s, l) => { const x = rateio(l[2], c.propHon); return { cond: r2(s.cond + x.cond), hon: r2(s.hon + x.hon) }; }, { cond: 0, hon: 0 }) : null;
      return `<details class="detalhes" open><summary>Parcelas${rat ? ` (rateio: ${fmtPct(r2(c.propHon * 100))}% de honorários advocatícios)` : ''}</summary><div class="rolagem tabela-parcelas"><table class="tabela"><thead><tr><th>Nº</th><th>Vencimento</th><th class="num">Parcela</th><th class="num">Juros</th><th class="num">Amortização</th><th class="num">Saldo devedor</th>${rat ? '<th class="num">Condomínio</th><th class="num">Honorários</th>' : ''}</tr></thead><tbody>
      ${linhas.map(l => `<tr><td>${l[0]}</td><td>${fmtData(l[1])}</td><td class="num">${fmtNum(l[2])}</td><td class="num">${l[3] === null ? '—' : fmtNum(l[3])}</td><td class="num">${fmtNum(l[4])}</td><td class="num">${fmtNum(l[5])}</td>${rc(l[2])}</tr>`).join('')}
      <tr class="subtotal"><td>Totais</td><td></td><td class="num">${fmtNum(c.totalAcordo)}</td><td class="num">${fmtNum(c.totalJuros)}</td><td class="num">${fmtNum(r2(c.totalAcordo - c.totalJuros))}</td><td></td>${rat ? `<td class="num">${fmtNum(somaR.cond)}</td><td class="num">${fmtNum(somaR.hon)}</td>` : ''}</tr></tbody></table></div></details>`;
    })() : ''}`;
}

function clausulasAcordo(a) {
  const pc = a.parcelamento, enc = a.encargos || {}, q = a.quebra || {};
  return [
    pc.indice && pc.indice !== 'Nenhum' ? `As parcelas serão corrigidas monetariamente pelo ${pc.indice}, desde a data do acordo (${fmtData(a.data)}) até a data do efetivo pagamento.` : 'As parcelas não terão correção monetária.',
    `Em caso de atraso, incidirão multa de ${fmtPct(enc.multa || 0)}% e juros de mora de ${fmtPct(enc.juros || 0)}% ao mês, pro rata die, sobre o valor corrigido.`,
    pc.jurosAte1 === false ? 'Não incidem juros do parcelamento até o vencimento da 1ª parcela.' : '',
    q.modo === 'original'
      ? `O descumprimento implicará a perda dos descontos concedidos, sendo devido o débito original atualizado, abatidos os valores pagos${q.multa ? `, acrescido de multa de ${fmtPct(q.multa)}%` : ''}.`
      : `O descumprimento implicará o vencimento antecipado do saldo do acordo${q.multa ? `, acrescido de multa de ${fmtPct(q.multa)}%` : ''}.`,
  ].filter(Boolean);
}

/* ---------- Acompanhamento ---------- */
function situacaoParcela(p, data) {
  const resto = restanteNominal(p);
  if (resto <= 0) return '<span class="chip fechado">Paga</span>';
  if (p.pago > 0) return `<span class="chip aberto">Paga em parte</span>`;
  return p.venc < data ? '<span class="chip pendente">Vencida</span>' : '<span class="chip neutro">A vencer</span>';
}

function acompanhamentoAcordo(a) {
  const st = { data: hoje() };
  const dev = devedorDoAcordo(a);
  const ativo = a.situacao === 'aceito';
  const desenhar = () => {
    const parc = parcelasDoAcordo(a);
    const q = ativo ? valorQuitacao(a, st.data) : null;
    const faltas = [...new Set(parcelasDoAcordo(a).filter(p => restanteNominal(p) > 0).flatMap(p => devidoParcela(a, p, st.data).faltando))].sort();
    const ultimo = (a.eventos || [])[a.eventos.length - 1];
    const descump = a.situacao === 'descumprido' ? a.eventos.filter(e => e.tipo === 'descumprimento').pop() : null;
    $('#conteudo').innerHTML = cabecalho('Acordo de ' + dev.nome, `${chipAcordo(a.situacao)} <span class="dica">Acordo de ${fmtData(a.data)}${a.aceitoEm ? ' · registrado em ' + new Date(a.aceitoEm).toLocaleDateString('pt-BR') : ''}</span>`, '', '#/acordos') + `
    <div class="cartao"><dl class="dados">
      <div><dt>Débitos</dt><dd>${(a.cobrancas || []).map(id => D.cobrancas[id] ? `<a href="#/cobranca/${id}">${esc(rotuloCobranca(D.cobrancas[id]))}</a>` : '(cobrança excluída)').join('<br>')}</dd></div>
      <div><dt>Débito atualizado</dt><dd>${fmtMoeda(a.resumo.total)}</dd></div>
      <div><dt>Desconto</dt><dd>${fmtMoeda(a.resumo.desconto)}</dd></div>
      <div><dt>Valor negociado</dt><dd><b>${fmtMoeda(a.resumo.negociado)}</b></dd></div>
      <div><dt>Entrada</dt><dd>${a.resumo.sinal ? fmtMoeda(a.resumo.sinal) + ' em ' + fmtData(a.sinal.data) : '—'}</dd></div>
      <div><dt>Parcelamento</dt><dd>${(a.plano || []).length} parcela(s), juros de ${fmtPct(a.parcelamento.taxa)}% a.m., correção: ${esc(a.parcelamento.indice)}</dd></div>
    </dl>${a.obs ? `<p class="dica" style="margin-top:8px">${esc(a.obs)}</p>` : ''}</div>

    <div class="cartao"><div class="cartao-cab"><h2>Parcelas</h2><label class="inline">Valores devidos em <input type="date" id="acRef" value="${st.data}"></label></div>
      <div class="rolagem"><table class="tabela"><thead><tr><th>Nº</th><th>Vencimento</th><th class="num">Parcela</th><th class="num">Pago (valor do acordo)</th><th>Situação</th><th class="num">Devido em ${fmtData(st.data)}</th></tr></thead><tbody>
      ${parc.map(p => { const resto = restanteNominal(p); const d = resto > 0 ? devidoParcela(a, p, st.data) : null;
        return `<tr><td>${p.n || 'Entrada'}</td><td>${fmtData(p.venc)}</td><td class="num">${fmtNum(p.valor)}</td><td class="num">${p.pago ? fmtNum(p.pago) : ''}</td><td>${situacaoParcela(p, st.data)}</td>
        <td class="num">${d ? fmtNum(d.total) + (d.juros || d.multa ? `<div class="dica">corr. ${fmtNum(d.corrigido)} + juros ${fmtNum(d.juros)} + multa ${fmtNum(d.multa)}</div>` : '') : ''}</td></tr>`; }).join('')}</tbody></table></div>
      ${faltas.length ? `<p class="alerta" style="margin-top:10px">Índice ${esc(indiceAcordo(a))} ainda não disponível para ${esc(descFaltando(faltas))}: a correção desse período não foi considerada. ${indiceAcordo(a) === 'UFIR-RJ' ? 'Inclua o valor do ano em Configurações &gt; Índices quando a SEFAZ-RJ divulgar.' : 'Os índices são atualizados automaticamente quando divulgados.'}</p>` : ''}
      ${q ? `<div class="res-l dest" style="margin-top:10px"><span>Valor para quitar o acordo em ${fmtData(st.data)} (vencidas com encargos + saldo das parcelas futuras, corrigido)</span><b>${fmtMoeda(q.total)}</b></div>` : ''}
      ${ativo ? `<div class="acoes-linha"><button class="bt primario" id="btPag">Registrar pagamento</button><button class="bt" id="btAmort">Amortização antecipada</button>
        <button class="bt" id="btQuitar">Quitar o acordo</button><button class="bt perigo" id="btDescump">Informar descumprimento</button></div>` : ''}
    </div>

    ${descump ? `<div class="cartao erro"><h2>Descumprimento</h2><div id="acDescump"></div></div>` : ''}
    ${a.situacao === 'quitado' ? `<div class="cartao"><p><b>Acordo quitado.</b> Se for o caso, encerre as cobranças incluídas.</p><div class="acoes-linha"><button class="bt" id="btEncerrar">Encerrar as cobranças do acordo</button></div></div>` : ''}

    <div class="cartao"><div class="cartao-cab"><h2>Lançamentos</h2>${ultimo ? '<button class="bt pequeno" id="btDesfazer">Desfazer o último lançamento</button>' : ''}</div>
      ${(a.eventos || []).length ? `<div class="rolagem"><table class="tabela"><thead><tr><th>Data</th><th>Lançamento</th><th class="num">Valor</th><th>Registrado por</th></tr></thead><tbody>
        ${a.eventos.map(e => `<tr><td>${fmtData(e.data)}</td><td>${esc(descEvento(e))}${e.obs ? `<div class="dica">${esc(e.obs)}</div>` : ''}</td><td class="num">${e.valor ? fmtNum(e.valor) : e.devido ? 'devido ' + fmtNum(e.devido) : ''}</td><td class="dica">${esc(e.por || '')} ${e.em ? new Date(e.em).toLocaleString('pt-BR') : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="vazio">Nenhum pagamento registrado.</p>'}</div>

    <div class="cartao"><h2>Relatórios</h2><div class="acoes-linha">
      <button class="bt" id="exVer">Visualizar extrato (PDF)</button><button class="bt" id="exPdf">Salvar extrato (PDF)</button><button class="bt" id="exXlsx">Extrato em Excel</button>
      <button class="bt" id="tmVer">Termo do acordo (PDF)</button></div></div>`;

    $('#acRef').addEventListener('change', e => { if (ehData(e.target.value)) { st.data = e.target.value; desenhar(); } });
    $('#btPag')?.addEventListener('click', () => modalPagamento(a, gravarLancamento));
    $('#btAmort')?.addEventListener('click', () => modalAmortizacao(a, gravarLancamento));
    $('#btQuitar')?.addEventListener('click', () => modalQuitacao(a, gravarLancamento));
    $('#btDescump')?.addEventListener('click', () => modalDescumprimento(a, gravarLancamento));
    $('#btDesfazer')?.addEventListener('click', () => executar(async () => {
      const ev = a.eventos[a.eventos.length - 1];
      if (!confirm(`Desfazer o último lançamento?\n\n${descEvento(ev)} em ${fmtData(ev.data)}`)) return;
      desfazerUltimo(a); await gravarLancamento('Lançamento desfeito.');
    }));
    $('#btEncerrar')?.addEventListener('click', () => executar(async () => {
      if (!confirm('Marcar como encerradas as cobranças incluídas neste acordo?')) return;
      for (const id of a.cobrancas) { const c = D.cobrancas[id]; if (c && c.situacao !== 'encerrada') await salvarRegistro('cobrancas', { ...c, situacao: 'encerrada', obs: (c.obs ? c.obs + '\n' : '') + `Encerrada por acordo quitado (acordo de ${fmtData(a.data)}).` }); }
      aviso('Cobranças encerradas.');
    }));
    if (descump) $('#acDescump').innerHTML = descumprimentoHTML(a, descump);
    $('#exVer').addEventListener('click', () => executar(() => visualizarPDF(pdfExtratoAcordo(a, st.data))));
    $('#exPdf').addEventListener('click', () => executar(() => salvarPDF(pdfExtratoAcordo(a, st.data))));
    $('#exXlsx').addEventListener('click', () => executar(() => salvarPlanilha(xlsxExtratoAcordo(a, st.data), nomeArquivo('Extrato-acordo', dev.nome, a.data) + '.xlsx')));
    $('#tmVer').addEventListener('click', () => executar(() => visualizarPDF(pdfAcordo(a, calcularAcordo(a), true))));
  };
  async function gravarLancamento(msg) {
    const g = await salvarRegistro('acordos', a);
    Object.assign(a, structuredClone(g));
    fecharModal();
    aviso(msg);
    acompanhamentoAcordo(structuredClone(D.acordos[a.id]));
  }
  desenhar();
}

function descumprimentoHTML(a, ev) {
  const r = valorDescumprimento(a, ev.data, ev.modo, ev.multa);
  const linhas = r.modo === 'original'
    ? [[`Débito original atualizado em ${fmtData(ev.data)} (sem os descontos)`, r.deb.total], [`(−) Pagamentos feitos, corrigidos pelo ${r.indice}`, -r.abatido]]
    : [[`Parcelas vencidas em aberto, corrigidas, com multa e juros`, r.q.totalVencidas], [`Saldo das parcelas futuras (vencimento antecipado), corrigido`, r.q.futuroCorrigido]];
  return `<p>Informado em ${fmtData(ev.data)}${ev.obs ? ' · ' + esc(ev.obs) : ''}.</p>
    <div class="resumo resumo-estreito">${linhas.map(([t, v]) => `<div class="res-l"><span>${t}</span><b>${fmtMoeda(Math.abs(v)).replace('R$', v < 0 ? '−R$' : 'R$')}</b></div>`).join('')}
      ${r.multa ? `<div class="res-l"><span>(+) Multa pelo descumprimento (${fmtPct(ev.multa)}%)</span><b>${fmtMoeda(r.multa)}</b></div>` : ''}
      <div class="res-l final"><span>Valor devido em ${fmtData(ev.data)}</span><b>${fmtMoeda(r.total)}</b></div></div>
    <p class="dica">${r.modo === 'original' ? 'O débito original é recalculado com os dados atuais das cobranças, até a data do descumprimento. Os pagamentos são corrigidos da data de cada um até essa data.' : 'As parcelas vencidas são corrigidas desde a data do acordo, com juros e multa de atraso. O saldo futuro é o principal da Tabela Price com os juros até a data, corrigido.'}
      Para atualizar o valor para outra data, desfaça o lançamento e informe de novo, ou atualize as cobranças.</p>`;
}

/* ---------- Janelas de lançamento ---------- */
function modalPagamento(a, gravar) {
  const abertas = parcelasDoAcordo(a).filter(p => restanteNominal(p) > 0);
  if (!abertas.length) return aviso('Não há parcelas em aberto.', 'erro');
  abrirModal(`<div class="modal-cab"><h2>Registrar pagamento</h2><button class="bt-x" data-fechar>&times;</button></div>
    <div class="grade-form">
      <div class="campo w2"><label>Parcela</label><select id="pgParc">${abertas.map(p => `<option value="${p.n}">${p.n ? 'Parcela ' + p.n : 'Entrada'} - venc. ${fmtData(p.venc)} - ${fmtMoeda(restanteNominal(p))}</option>`).join('')}</select></div>
      <div class="campo"><label>Data do pagamento</label><input type="date" id="pgData" value="${hoje()}"></div>
      <div class="campo"><label>Valor pago (R$)</label><input id="pgValor" inputmode="decimal"></div>
      <div class="campo wfull"><label>Observação</label><input id="pgObs"></div></div>
    <p class="dica" id="pgDevido"></p>
    <div class="acoes-linha"><button class="bt primario" id="pgOk">Registrar</button><button class="bt" data-fechar>Cancelar</button></div>`, 'modal-medio');
  const sugerir = () => {
    const p = abertas.find(x => x.n === +$('#pgParc').value), data = $('#pgData').value;
    if (!p || !ehData(data)) return;
    const d = devidoParcela(a, p, data);
    $('#pgValor').value = fmtNum(d.total);
    $('#pgDevido').textContent = `Devido em ${fmtData(data)}: ${fmtMoeda(d.total)} (valor ${fmtNum(d.base)}, corrigido ${fmtNum(d.corrigido)}${d.dias ? `, ${d.dias} dia(s) de atraso: juros ${fmtNum(d.juros)} e multa ${fmtNum(d.multa)}` : ''}). Valor menor fica como pagamento parcial.`;
  };
  $('#pgParc').addEventListener('change', sugerir); $('#pgData').addEventListener('change', sugerir); sugerir();
  $('#pgOk').addEventListener('click', () => executar(async () => {
    lancarPagamento(a, { n: +$('#pgParc').value, data: $('#pgData').value, valor: $('#pgValor').value, obs: $('#pgObs').value.trim() });
    await gravar('Pagamento registrado.');
  }));
}

function modalAmortizacao(a, gravar) {
  abrirModal(`<div class="modal-cab"><h2>Amortização antecipada</h2><button class="bt-x" data-fechar>&times;</button></div>
    <div class="grade-form">
      <div class="campo"><label>Data</label><input type="date" id="amData" value="${hoje()}"></div>
      <div class="campo"><label>Valor pago (R$)</label><input id="amValor" inputmode="decimal"></div>
      <div class="campo w2"><label>Efeito</label><div class="segmentado"><label><input type="radio" name="amEf" value="prazo" checked> Reduzir o prazo</label><label><input type="radio" name="amEf" value="parcela"> Reduzir a parcela</label></div></div>
      <div class="campo wfull"><label>Observação</label><input id="amObs"></div></div>
    <div id="amPrevia" class="dica"></div>
    <div class="acoes-linha"><button class="bt primario" id="amOk">Registrar</button><button class="bt" data-fechar>Cancelar</button></div>`, 'modal-medio');
  const dados = () => ({ data: $('#amData').value, valor: $('#amValor').value, efeito: $('input[name=amEf]:checked').value, obs: $('#amObs').value.trim() });
  const previa = () => {
    try {
      const sf = saldoFuturo(a, $('#amData').value), { fator } = fatorAcordo(a, $('#amData').value);
      let txt = `Saldo das parcelas futuras em ${fmtData($('#amData').value)}: ${fmtMoeda(r2(sf.saldo * fator))}.`;
      if (parseValor($('#amValor').value) > 0) {
        const t = structuredClone(a); lancarAmortizacao(t, dados());
        const fut = t.plano.filter(p => p.venc > $('#amData').value);
        txt += ` Depois: ${fut.length} parcela(s)${fut.length ? ` de ${fmtMoeda(fut[0].valor)}${fut.length > 1 && fut[fut.length - 1].valor !== fut[0].valor ? ` (última de ${fmtMoeda(fut[fut.length - 1].valor)})` : ''}, até ${fmtData(fut[fut.length - 1].venc)}` : ''}.`;
      }
      $('#amPrevia').textContent = txt;
    } catch (e) { $('#amPrevia').textContent = e.message; }
  };
  ['amData', 'amValor'].forEach(i => $('#' + i).addEventListener('input', previa));
  $$('input[name=amEf]').forEach(r => r.addEventListener('change', previa)); previa();
  $('#amOk').addEventListener('click', () => executar(async () => { lancarAmortizacao(a, dados()); await gravar('Amortização registrada; parcelas futuras recalculadas.'); }));
}

function modalQuitacao(a, gravar) {
  abrirModal(`<div class="modal-cab"><h2>Quitar o acordo</h2><button class="bt-x" data-fechar>&times;</button></div>
    <div class="grade-form"><div class="campo"><label>Data do pagamento</label><input type="date" id="qtData" value="${hoje()}"></div>
      <div class="campo"><label>Valor pago (R$)</label><input id="qtValor" inputmode="decimal"></div>
      <div class="campo w2"><label>Observação</label><input id="qtObs"></div></div>
    <div id="qtDet"></div>
    <div class="acoes-linha"><button class="bt primario" id="qtOk">Registrar a quitação</button><button class="bt" data-fechar>Cancelar</button></div>`, 'modal-medio');
  const det = () => {
    const d = $('#qtData').value; if (!ehData(d)) return;
    const q = valorQuitacao(a, d);
    $('#qtValor').value = fmtNum(q.total);
    $('#qtDet').innerHTML = `<div class="resumo">${q.vencidas.map(x => `<div class="res-l"><span>${x.p.n ? 'Parcela ' + x.p.n : 'Entrada'} vencida em ${fmtData(x.p.venc)} (corrigida${x.d.dias ? ', com juros e multa' : ''})</span><b>${fmtMoeda(x.d.total)}</b></div>`).join('')}
      <div class="res-l"><span>Saldo das parcelas futuras, com juros até ${fmtData(d)} e corrigido (fator ${fmtFator(q.fator)})</span><b>${fmtMoeda(q.futuroCorrigido)}</b></div>
      <div class="res-l final"><span>Valor para quitação</span><b>${fmtMoeda(q.total)}</b></div></div>
      <p class="dica">Na quitação antecipada, os juros das parcelas futuras deixam de ser cobrados (conta só até a data do pagamento).</p>`;
  };
  $('#qtData').addEventListener('change', det); det();
  $('#qtOk').addEventListener('click', () => executar(async () => { lancarQuitacao(a, { data: $('#qtData').value, valor: $('#qtValor').value, obs: $('#qtObs').value.trim() }); await gravar('Acordo quitado.'); }));
}

function modalDescumprimento(a, gravar) {
  const q0 = a.quebra || {};
  abrirModal(`<div class="modal-cab"><h2>Informar descumprimento</h2><button class="bt-x" data-fechar>&times;</button></div>
    <div class="grade-form"><div class="campo"><label>Data do cálculo</label><input type="date" id="dsData" value="${hoje()}"></div>
      <div class="campo w2"><label>Consequência</label><select id="dsModo"><option value="saldo">Vencimento antecipado do saldo do acordo</option><option value="original" ${q0.modo === 'original' ? 'selected' : ''}>Perda do desconto (débito original, abatidos os pagamentos)</option></select></div>
      <div class="campo"><label>Multa pelo descumprimento (%)</label><input id="dsMulta" inputmode="decimal" value="${esc(fmtPct(q0.multa || 0))}"></div>
      <div class="campo wfull"><label>Observação</label><input id="dsObs"></div></div>
    <div id="dsDet"></div>
    <div class="acoes-linha"><button class="bt perigo" id="dsOk">Registrar o descumprimento</button><button class="bt" data-fechar>Cancelar</button></div>`, 'modal-medio');
  const det = () => {
    const d = $('#dsData').value; if (!ehData(d)) return;
    $('#dsDet').innerHTML = descumprimentoHTML(a, { data: d, modo: $('#dsModo').value, multa: parseValor($('#dsMulta').value) });
  };
  ['dsData', 'dsModo'].forEach(i => $('#' + i).addEventListener('change', det)); $('#dsMulta').addEventListener('input', det); det();
  $('#dsOk').addEventListener('click', () => executar(async () => {
    lancarDescumprimento(a, { data: $('#dsData').value, modo: $('#dsModo').value, multa: parseValor($('#dsMulta').value), obs: $('#dsObs').value.trim() });
    await gravar('Descumprimento registrado.');
  }));
}

/* ================= PDF e Excel ================= */
function infoAcordo(a) {
  const dev = devedorDoAcordo(a);
  const cobs = (a.cobrancas || []).map(id => D.cobrancas[id]).filter(Boolean);
  const credores = [...new Set(cobs.map(c => { const k = D.condominios[c.condominioId] || {}; return (k.razao || '') + (k.cnpj ? ' - CNPJ ' + fmtDoc(k.cnpj) : ''); }))];
  return [
    `Devedor: ${dev.nome}${dev.documento ? ` (${rotuloDoc(dev.documento)} ${fmtDoc(dev.documento)})` : ''}`,
    `Credor${credores.length > 1 ? 'es' : ''}: ${credores.join('; ')}`,
    `Débito${cobs.length > 1 ? 's' : ''}: ${cobs.map(c => `${c.unidade}${c.tipo === 'judicial' && c.processo ? ' (Processo nº ' + c.processo + ')' : ''}`).join('; ')}`,
    `Data do acordo: ${fmtData(a.data)}`,
  ];
}

function tabelaParcelasPDF(P, a, c) {
  const rat = c.propHon > 0;
  const rc = v => { if (!rat) return []; const x = rateio(v, c.propHon); return [fmtNum(x.cond), fmtNum(x.hon)]; };
  const valores = [...(c.sinal ? [c.sinal] : []), ...c.plano.parcelas.map(p => p.valor)];
  const tot = valores.reduce((s, v) => { const x = rateio(v, c.propHon); return { cond: r2(s.cond + x.cond), hon: r2(s.hon + x.hon) }; }, { cond: 0, hon: 0 });
  tabelaPDF(P, [{ t: 'Nº', w: 12 }, { t: 'Vencimento', w: 22, nw: true }, { t: 'Parcela', w: 24, a: 'r' }, { t: 'Juros', w: 22, a: 'r' }, { t: 'Amortização', w: 24, a: 'r' }, { t: 'Saldo devedor', w: 26, a: 'r' },
    ...(rat ? [{ t: 'Condomínio', w: 24, a: 'r' }, { t: 'Honorários', w: 22, a: 'r' }] : [])], [
    ...(c.sinal ? [{ c: ['Entrada', fmtData(a.sinal.data), fmtNum(c.sinal), '-', fmtNum(c.sinal), fmtNum(c.saldo), ...rc(c.sinal)] }] : []),
    ...c.plano.parcelas.map(p => ({ c: [String(p.n), fmtData(p.venc), fmtNum(p.valor), fmtNum(p.juros), fmtNum(p.amort), fmtNum(p.saldo), ...rc(p.valor)] })),
    { c: ['Totais', '', fmtNum(c.totalAcordo), fmtNum(c.totalJuros), fmtNum(r2(c.totalAcordo - c.totalJuros)), '', ...(rat ? [fmtNum(tot.cond), fmtNum(tot.hon)] : [])], total: true },
  ], 8);
  if (rat) paragrafoPDF(P, `Rateio: ${fmtPct(r2(c.propHon * 100))}% de cada pagamento corresponde a honorários advocatícios, na proporção do débito negociado.`, 7.5, 'normal', COR_SUAVE);
}

function pdfAcordo(a, c, detalhe) {
  const P = novoDocumento(false);
  P.cab();
  tituloPDF(P, a.situacao === 'proposta' ? 'Proposta de acordo' : 'Termo de acordo - demonstrativo');
  blocoInfoPDF(P, devedorDoAcordo(a).nome, infoAcordo(a));
  subtituloPDF(P, 'Débito e desconto');
  const itens = a.desconto.modo === 'itens';
  tabelaPDF(P, [{ t: 'Componente', w: 70 }, { t: 'Débito atualizado', w: 30, a: 'r' }, { t: 'Desconto', w: 26, a: 'r' }, { t: 'Valor negociado', w: 30, a: 'r' }], [
    ...COMPONENTES_ACORDO.filter(([k]) => c.deb.comp[k]).map(([k, rot]) => {
      const dd = itens ? c.descItens[k] || 0 : r2(c.desconto * c.deb.comp[k] / c.deb.total);
      return { c: [rot, fmtNum(c.deb.comp[k]), itens ? fmtNum(dd) : '', itens ? fmtNum(r2(c.deb.comp[k] - dd)) : ''] };
    }),
    { c: ['Total', fmtNum(c.deb.total), fmtNum(c.desconto), fmtNum(c.negociado)], total: true },
  ], 8.5);
  subtituloPDF(P, 'Condições');
  resumoPDF(P, [
    ['Débito atualizado em ' + fmtData(a.data), c.deb.total],
    ...(c.desconto ? [['(-) Desconto', c.desconto], ['(=) Valor negociado', c.negociado, 'b']] : []),
    ...(c.sinal ? [['(-) Entrada em ' + fmtData(a.sinal.data), c.sinal]] : []),
    ['(=) Saldo a parcelar', c.saldo, 'b'],
    [`${c.plano.n} parcela(s) - juros de ${fmtPct(a.parcelamento.taxa)}% ao mês (Tabela Price)`, c.totalParcelas],
    ['Total a pagar pelo acordo', c.totalAcordo, 'f'],
  ], 120);
  if (c.plano.parcelas.length || c.sinal) { subtituloPDF(P, 'Pagamentos'); tabelaParcelasPDF(P, a, c); }
  subtituloPDF(P, 'Cláusulas');
  clausulasAcordo(a).forEach(t => { paragrafoPDF(P, t, 8.5); P.y += 1; });
  if (a.obs) { P.y += 2; paragrafoPDF(P, 'Observações: ' + a.obs, 8.5, 'italic', COR_SUAVE); }
  if (detalhe) for (const id of a.cobrancas) { const cob = D.cobrancas[id]; if (!cob) continue; P.novaPagina(); tituloPDF(P, 'Planilha de débito'); secaoCobrancaPDF(P, cob, calcularCobranca(cob, a.data)); }
  rodapePDF(P);
  return { doc: P.doc, nome: nomeArquivo(a.situacao === 'proposta' ? 'Proposta-acordo' : 'Acordo', devedorDoAcordo(a).nome, a.data) + '.pdf' };
}

function pdfExtratoAcordo(a, data) {
  const P = novoDocumento(false);
  P.cab();
  tituloPDF(P, 'Extrato do acordo', [[`Situação: ${SITUACOES_ACORDO[a.situacao]} · valores devidos calculados em ${fmtData(data)}`, 9, 'normal', COR_SUAVE]]);
  blocoInfoPDF(P, devedorDoAcordo(a).nome, [...infoAcordo(a), `Valor negociado: ${fmtMoeda(a.resumo.negociado)}${a.resumo.sinal ? ` · entrada ${fmtMoeda(a.resumo.sinal)}` : ''} · ${(a.plano || []).length} parcela(s) · juros ${fmtPct(a.parcelamento.taxa)}% a.m. · correção: ${a.parcelamento.indice}`]);
  subtituloPDF(P, 'Parcelas');
  tabelaPDF(P, [{ t: 'Nº', w: 14 }, { t: 'Vencimento', w: 22, nw: true }, { t: 'Parcela', w: 22, a: 'r' }, { t: 'Pago (valor do acordo)', w: 26, a: 'r' }, { t: 'Situação', w: 22 }, { t: `Devido em ${fmtData(data)}`, w: 28, a: 'r' }],
    parcelasDoAcordo(a).map(p => { const resto = restanteNominal(p), d = resto > 0 ? devidoParcela(a, p, data) : null;
      return { c: [p.n ? String(p.n) : 'Entrada', fmtData(p.venc), fmtNum(p.valor), p.pago ? fmtNum(p.pago) : '', resto <= 0 ? 'Paga' : p.pago ? 'Paga em parte' : p.venc < data ? 'Vencida' : 'A vencer', d ? fmtNum(d.total) : ''] }; }), 8);
  if ((a.eventos || []).length) {
    subtituloPDF(P, 'Lançamentos');
    tabelaPDF(P, [{ t: 'Data', w: 20, nw: true }, { t: 'Lançamento', w: 90 }, { t: 'Valor', w: 26, a: 'r' }],
      a.eventos.map(e => ({ c: [fmtData(e.data), descEvento(e) + (e.obs ? ' - ' + e.obs : ''), e.valor ? fmtNum(e.valor) : e.devido ? 'devido ' + fmtNum(e.devido) : ''] })), 8);
  }
  if (a.situacao === 'aceito') { const q = valorQuitacao(a, data); resumoPDF(P, [['Total pago', somar(a.eventos || [], e => e.valor || 0)], [`Valor para quitação em ${fmtData(data)}`, q.total, 'f']], 120); }
  const ev = a.situacao === 'descumprido' ? a.eventos.filter(e => e.tipo === 'descumprimento').pop() : null;
  if (ev) {
    const r = valorDescumprimento(a, ev.data, ev.modo, ev.multa);
    subtituloPDF(P, 'Descumprimento - valor devido');
    resumoPDF(P, [
      ...(r.modo === 'original' ? [[`Débito original atualizado em ${fmtData(ev.data)}`, r.deb.total], [`(-) Pagamentos corrigidos (${r.indice})`, r.abatido]]
        : [['Parcelas vencidas em aberto, com encargos', r.q.totalVencidas], ['Saldo das parcelas futuras, corrigido', r.q.futuroCorrigido]]),
      ...(r.multa ? [[`(+) Multa pelo descumprimento (${fmtPct(ev.multa)}%)`, r.multa]] : []),
      [`Valor devido em ${fmtData(ev.data)}`, r.total, 'f'],
    ], 130);
  }
  P.y += 2;
  clausulasAcordo(a).forEach(t => { paragrafoPDF(P, t, 7.5, 'normal', COR_SUAVE); P.y += 1; });
  rodapePDF(P);
  return { doc: P.doc, nome: nomeArquivo('Extrato-acordo', devedorDoAcordo(a).nome, data) + '.pdf' };
}

// Proposta em Excel com fórmulas da Tabela Price (é possível mudar a taxa e o saldo na planilha)
function xlsxAcordo(a, c) {
  const rat = c.propHon > 0;
  const LARG = [10, 14, 15, 14, 15, 16, ...(rat ? [15, 15] : [])], cab = cabecalhoXLSX(LARG);
  const L = [...cab.linhas, [{ v: a.situacao === 'proposta' ? 'Proposta de acordo' : 'Acordo', s: 'tit' }], ...infoAcordo(a).map(t => [t]), null];
  const param = (rot, cel) => { L.push([{ v: rot, s: 'b' }, null, null, null, cel]); return '$E$' + L.length; };
  const DEB = param('Débito atualizado', { v: c.deb.total, s: 'm' });
  const DESC = param('(-) Desconto', { v: c.desconto, s: 'm' });
  const NEG = param('(=) Valor negociado', { f: `${DEB}-${DESC}`, v: c.negociado, s: 'm' });
  const SIN = param('(-) Entrada', { v: c.sinal, s: 'm' });
  const SALDO = param('(=) Saldo a parcelar', { f: `${NEG}-${SIN}`, v: c.saldo, s: 'm' });
  const TAXA = param('Juros ao mês', { v: (Number(a.parcelamento.taxa) || 0) / 100, s: 'p' });
  const N = param('Número de parcelas', { v: c.plano.n, s: 'i' });
  const DIAS1 = param('Dias do acordo até a 1ª parcela', { v: Math.max(0, diasEntre(a.data, a.parcelamento.primeiroVenc)), s: 'i' });
  // Com juros até a 1ª parcela: (1 + taxa) ^ (dias ÷ 30); sem juros até lá: 1
  const F1 = param('Fator de juros até a 1ª parcela', a.parcelamento.jurosAte1 === false ? { v: 1, s: 'f' } : { f: `(1+${TAXA})^(${DIAS1}/30)`, v: c.f1, s: 'f' });
  const PMT = param('Valor da parcela', a.parcelamento.modo === 'parcela' ? { v: c.plano.pmt, s: 'm' }
    : { f: `IF(${TAXA}=0,ROUND(${SALDO}/${N},2),ROUND(${SALDO}*${F1}*${TAXA}/((1-(1+${TAXA})^-${N})*(1+${TAXA})),2))`, v: c.plano.pmt, s: 'm' });
  // Rateio: parte de honorários advocatícios em cada pagamento (na proporção do débito negociado)
  const PROP = rat ? param('Rateio: parte de honorários advocatícios', { v: c.propHon, s: 'p' }) : null;
  const colsRat = n => rat ? [{ f: `C${n}-H${n}`, v: rateio(0, 0).cond, s: 'm' }, { f: `ROUND(C${n}*${PROP},2)`, v: 0, s: 'm' }] : [];
  const comValores = (linha, valor) => { if (rat) { const x = rateio(valor, c.propHon); linha[6].v = x.cond; linha[7].v = x.hon; } return linha; };
  L.push(null, { c: ['Nº', 'Vencimento', 'Parcela', 'Juros', 'Amortização', 'Saldo devedor', ...(rat ? ['Condomínio', 'Honorários'] : [])].map(v => ({ v, s: 'cab' })), altura: 26 });
  if (c.sinal) { const n = L.length + 1; L.push(comValores(['Entrada', { v: a.sinal.data, s: 'd' }, { f: SIN, v: c.sinal, s: 'm' }, { v: 0, s: 'm' }, { f: SIN, v: c.sinal, s: 'm' }, { f: SALDO, v: c.saldo, s: 'm' }, ...colsRat(n)], c.sinal)); }
  const ini = L.length + 1;
  c.plano.parcelas.forEach((p, k) => {
    const n = L.length + 1, ant = k === 0 ? SALDO : 'F' + (n - 1), f = k === 0 ? F1 : `(1+${TAXA})`;
    L.push(comValores([{ v: p.n, s: 'i' }, { v: p.venc, s: 'd' }, { f: k === c.plano.parcelas.length - 1 ? `${ant}+D${n}` : `MIN(${PMT},${ant}+D${n})`, v: p.valor, s: 'm' },
      { f: `ROUND(${ant}*(${f}-1),2)`, v: p.juros, s: 'm' }, { f: `C${n}-D${n}`, v: p.amort, s: 'm' }, { f: `ROUND(${ant}+D${n}-C${n},2)`, v: p.saldo, s: 'm' }, ...colsRat(n)], p.valor));
  });
  const fim = L.length, vz = { v: '', s: 'bt' };
  const iniTot = c.sinal ? ini - 1 : ini;
  const soma = col => ({ f: `SUM(${col}${iniTot}:${col}${fim})`, v: 0, s: 'mt' });
  if (c.plano.parcelas.length) L.push([{ v: 'Totais', s: 'bt' }, vz, { f: `SUM(C${iniTot}:C${fim})`, v: c.totalAcordo, s: 'mt' }, { f: `SUM(D${ini}:D${fim})`, v: c.totalJuros, s: 'mt' }, { f: `SUM(E${iniTot}:E${fim})`, v: r2(c.totalAcordo - c.totalJuros), s: 'mt' }, vz, ...(rat ? [soma('G'), soma('H')] : [])]);
  L.push(null);
  const mesclar = [], ultCol = rat ? 'H' : 'F';
  clausulasAcordo(a).forEach(t => { L.push({ c: [{ v: t, s: 'tq' }], altura: Math.ceil(t.length / 95) * 13 + 2 }); mesclar.push(`A${L.length}:${ultCol}${L.length}`); });
  return gerarXLSX([{ nome: 'Acordo', linhas: L, larguras: LARG, imagem: cab.imagem, mesclar }]);
}

function xlsxExtratoAcordo(a, data) {
  const LARG = [10, 14, 15, 18, 16, 18], cab = cabecalhoXLSX(LARG);
  const L = [...cab.linhas, [{ v: 'Extrato do acordo', s: 'tit' }], ...infoAcordo(a).map(t => [t]), [`Situação: ${SITUACOES_ACORDO[a.situacao]} · valores devidos em ${fmtData(data)}`], null];
  L.push({ c: ['Nº', 'Vencimento', 'Parcela', 'Pago (valor do acordo)', 'Situação', `Devido em ${fmtData(data)}`].map(v => ({ v, s: 'cab' })), altura: 26 });
  for (const p of parcelasDoAcordo(a)) {
    const resto = restanteNominal(p), d = resto > 0 ? devidoParcela(a, p, data) : null;
    L.push([p.n ? { v: p.n, s: 'i' } : 'Entrada', { v: p.venc, s: 'd' }, { v: p.valor, s: 'm' }, { v: p.pago || 0, s: 'm' }, resto <= 0 ? 'Paga' : p.pago ? 'Paga em parte' : p.venc < data ? 'Vencida' : 'A vencer', d ? { v: d.total, s: 'm' } : null]);
  }
  L.push(null, [{ v: 'Lançamentos', s: 'b' }], { c: ['Data', 'Lançamento', null, null, null, 'Valor'].map(v => v && ({ v, s: 'cab' })) });
  for (const e of a.eventos || []) L.push([{ v: e.data, s: 'd' }, descEvento(e) + (e.obs ? ' - ' + e.obs : ''), null, null, null, { v: e.valor || 0, s: 'm' }]);
  return gerarXLSX([{ nome: 'Extrato', linhas: L, larguras: LARG, imagem: cab.imagem }]);
}

async function exportarAcordo(formato, a, c, detalhe) {
  if (formato === 'xlsx') return salvarPlanilha(xlsxAcordo(a, c), nomeArquivo('Proposta-acordo', devedorDoAcordo(a).nome, a.data) + '.xlsx');
  const pdf = pdfAcordo(a, c, detalhe);
  return formato === 'ver' ? visualizarPDF(pdf) : salvarPDF(pdf);
}
