'use strict';
/* Cobrança Condominial — dados, telas e editor das cobranças */

const VERSAO = '1.0.0';

/* ================= Dados ================= */
const D = { config: null, indices: null, condominios: {}, cobrancas: {}, carregadoEm: 0 };

const RUBRICAS_PADRAO = [
  'Custas iniciais', 'Taxa judiciária', 'Custas de distribuição', 'Diligência de oficial de justiça', 'Certidão de ônus reais (RGI)',
  'Certidão', 'Registro / averbação', 'Publicação de edital', 'Postagem / AR', 'Cópias e autenticações', 'Avaliação / perícia', 'Outras despesas',
];

function normalizarConfig(c) {
  c = c || {};
  c.escritorio = c.escritorio || {};
  c.padroes = { ...PADROES, ...(c.padroes || {}) };
  if (!Array.isArray(c.rubricas) || !c.rubricas.length) c.rubricas = [...RUBRICAS_PADRAO];
  return c;
}

const usuarioLocal = () => localStorage.getItem('cc-usuario') || '';

async function lerJSON(caminho, padrao) {
  const t = await Armaz.ler(caminho);
  if (t === null || t === '') return padrao;
  try { return JSON.parse(t); } catch { throw new Error(`O arquivo ${caminho} está corrompido.`); }
}

async function carregarColecao(col) {
  const nomes = await Armaz.listar(col);
  const mapa = {};
  await Promise.all(nomes.map(async n => {
    try {
      const reg = JSON.parse(await Armaz.ler(`${col}/${n}`));
      if (reg?.id) mapa[reg.id] = reg;
    } catch (e) { console.warn('Arquivo ignorado', col, n, e); }
  }));
  return mapa;
}

async function recarregarTudo() {
  Armaz.conflitos = [];
  const [config, indices, condominios, cobrancas] = await Promise.all([
    lerJSON('config.json', null), lerJSON('indices.json', { series: {} }), carregarColecao('condominios'), carregarColecao('cobrancas'),
  ]);
  D.config = normalizarConfig(config);
  D.indices = indices;
  D.condominios = condominios;
  D.cobrancas = cobrancas;
  D.carregadoEm = Date.now();
  atualizarDatalists();
}

function atualizarDatalists() {
  $('#dlRubricas').innerHTML = D.config.rubricas.map(r => `<option value="${esc(r)}">`).join('');
  const descs = new Set(['Cota condominial', 'Cota extra', 'Fundo de reserva', 'Fundo de obras', 'Rateio extraordinário', 'Água', 'Gás']);
  $('#dlDescCotas').innerHTML = [...descs].map(r => `<option value="${esc(r)}">`).join('');
}

// Grava o registro conferindo se ninguém o alterou desde que foi lido
async function salvarRegistro(col, reg) {
  const caminho = `${col}/${reg.id}.json`;
  const noDisco = JSON.parse(await Armaz.ler(caminho) || 'null');
  if (noDisco && (noDisco.rev || 0) !== (reg.rev || 0)) {
    throw new ErroConflito(`Este registro foi alterado${noDisco.alteradoPor ? ' por ' + noDisco.alteradoPor : ''}${noDisco.alteradoEm ? ' em ' + new Date(noDisco.alteradoEm).toLocaleString('pt-BR') : ''} enquanto você editava. Os dados foram recarregados: confira e refaça a alteração.`);
  }
  const novo = { ...reg, rev: (reg.rev || 0) + 1, alteradoEm: new Date().toISOString(), alteradoPor: usuarioLocal() };
  if (!novo.criadoEm) { novo.criadoEm = novo.alteradoEm; novo.criadoPor = novo.alteradoPor; }
  await Armaz.gravar(caminho, JSON.stringify(novo, null, 1));
  D[col][novo.id] = novo;
  return novo;
}

async function excluirRegistro(col, id) {
  await Armaz.paraLixeira(`${col}/${id}.json`);
  delete D[col][id];
}

async function salvarConfig(c) {
  await Armaz.gravar('config.json', JSON.stringify(c, null, 1));
  D.config = normalizarConfig(c);
  atualizarDatalists();
}

function novaCobranca(condominioId) {
  return { id: novoId(), condominioId: condominioId || '', unidade: '', tipo: 'extrajudicial', situacao: 'ativa', processo: '', juizo: '', obs: '',
    devedores: [{ nome: '', documento: '', endereco: '' }], cotas: [], despesas: [], params: {}, sucumbencia: { tipo: 'nenhum' } };
}

/* ================= Navegação ================= */
let sujo = false, ignorarHash = false, hashAnterior = location.hash;

window.addEventListener('hashchange', () => {
  if (ignorarHash) { ignorarHash = false; return; }
  if (sujo && !confirm('Há alterações não salvas. Sair sem salvar?')) { ignorarHash = true; location.hash = hashAnterior; return; }
  sujo = false;
  hashAnterior = location.hash;
  rotear();
});
window.addEventListener('beforeunload', e => { if (sujo) { e.preventDefault(); e.returnValue = ''; } });

function marcarSujo() {
  sujo = true;
  const e = $('#estadoSalvar');
  if (e) e.textContent = 'Alterações não salvas';
}

function destacarMenu(rota) {
  $$('#menu a[data-rota]').forEach(a => a.classList.toggle('ativo', rota.startsWith(a.dataset.rota)));
  document.body.classList.remove('menu-aberto');
}

async function rotear() {
  if (!Armaz.modo) return telaConexao();
  const h = location.hash.replace(/^#\/?/, '') || 'inicio';
  const [rota, arg] = h.split('/');
  const params = new URLSearchParams(h.split('?')[1] || '');
  destacarMenu(rota);
  window.scrollTo(0, 0);
  const tela = {
    inicio: telaInicio, condominios: telaCondominios, condominio: () => telaCondominio(arg?.split('?')[0]),
    cobranca: () => telaCobranca(arg?.split('?')[0], params), devedores: telaDevedores, imoveis: telaImoveis,
    relatorios: () => telaRelatorios(params), config: telaConfig,
  }[rota] || telaInicio;
  await executar(tela);
}

const cabecalho = (titulo, sub = '', acoes = '', voltar = '') => `<div class="cab-pagina"><div>${voltar ? `<a class="voltar" href="${voltar}">&larr; Voltar</a>` : ''}<h1>${esc(titulo)}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div><div class="acoes">${acoes}</div></div>`;
const optCondominios = sel => Object.values(D.condominios).sort((a, b) => comparar(a.razao, b.razao))
  .map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.razao)}</option>`).join('');
const chipTipo = cob => cob.tipo === 'judicial' ? '<span class="chip pendente">Judicial</span>' : '<span class="chip aberto">Extrajudicial</span>';
const chipSit = cob => (cob.situacao || 'ativa') === 'ativa' ? '' : ' <span class="chip neutro">Encerrada</span>';

/* ================= Início ================= */
async function telaInicio() {
  garantirIndices();
  const data = hoje();
  const cobs = Object.values(D.cobrancas).sort(ordemCobranca);
  const st = { busca: localStorage.getItem('cc-busca') || '', cond: '', tipo: 'todas', sit: 'ativa' };
  const calc = {};
  const totalDe = cob => (calc[cob.id] = calc[cob.id] || calcularCobranca(cob, data)).total;
  const filtrar = () => cobs.filter(c => (!st.cond || c.condominioId === st.cond) && (st.tipo === 'todas' || c.tipo === st.tipo)
    && (st.sit === 'todas' || (c.situacao || 'ativa') === st.sit)
    && (!st.busca || normalizar([nomeCond(c), c.unidade, devedoresCurto(c), c.processo, ...(c.devedores || []).map(d => soDigitos(d.documento))].join(' ')).includes(normalizar(st.busca))));
  const ativas = cobs.filter(c => (c.situacao || 'ativa') === 'ativa');
  const kpi = (r, v, s = '') => `<div class="kpi"><span>${r}</span><b>${v}</b>${s ? `<small>${s}</small>` : ''}</div>`;
  const total = ativas.reduce((s, c) => s + cent(totalDe(c)), 0) / 100;
  $('#conteudo').innerHTML = cabecalho('Cobranças', `Valores atualizados até hoje (${fmtData(data)}) com os critérios de cada cobrança.`,
    `<a class="bt primario" href="#/cobranca/nova">Nova cobrança</a>`) +
    (Armaz.conflitos.length ? `<p class="alerta">O Dropbox criou cópias com conflito (duas pessoas alteraram o mesmo arquivo ao mesmo tempo). Elas não são lidas pelo programa. Confira e apague na pasta dos dados: ${Armaz.conflitos.map(esc).join(', ')}</p>` : '') +
    (!Object.keys(D.condominios).length ? `<div class="cartao destaque"><h2>Primeiros passos</h2><ol>
      <li>Preencha os dados do escritório e os padrões de encargos em <a href="#/config">Configurações</a>.</li>
      <li>Cadastre o condomínio (cliente) em <a href="#/condominio/novo">Condomínios</a>.</li>
      <li>Crie as cobranças, uma por unidade, ou importe uma planilha com várias unidades na tela do condomínio.</li></ol></div>` : '') +
    `<div class="kpis">${kpi('Cobranças ativas', ativas.length, `${ativas.filter(c => c.tipo === 'judicial').length} judiciais · ${ativas.filter(c => c.tipo !== 'judicial').length} extrajudiciais`)}
      ${kpi('Total atualizado (ativas)', fmtMoeda(total))}${kpi('Condomínios', Object.keys(D.condominios).length)}${kpi('Devedores', listaDevedores(ativas).length)}</div>
    <div class="cartao"><div class="barra-filtros">
      <input type="search" id="fBusca" placeholder="Buscar unidade, devedor, CPF, processo…" value="${esc(st.busca)}">
      <select id="fCond"><option value="">Todos os condomínios</option>${optCondominios(st.cond)}</select>
      <select id="fTipo"><option value="todas">Judiciais e extrajudiciais</option><option value="judicial">Judiciais</option><option value="extrajudicial">Extrajudiciais</option></select>
      <select id="fSit"><option value="ativa">Ativas</option><option value="encerrada">Encerradas</option><option value="todas">Todas</option></select>
    </div><div id="lista"></div></div>`;
  const desenhar = () => {
    const l = filtrar();
    $('#lista').innerHTML = l.length ? `<div class="rolagem"><table class="tabela clicavel"><thead><tr><th>Condomínio</th><th>Unidade</th><th>Devedor(es)</th><th>Cobrança</th><th class="num">Cotas</th><th class="num">Total atualizado</th></tr></thead><tbody>
      ${l.map(c => `<tr data-id="${c.id}"><td>${esc(nomeCond(c))}</td><td>${esc(c.unidade)}</td><td>${esc(devedoresCurto(c))}</td><td>${chipTipo(c)}${chipSit(c)}${c.processo ? `<div class="dica">${esc(c.processo)}</div>` : ''}</td>
        <td class="num">${(c.cotas || []).filter(x => !x.pago).length}</td><td class="num">${fmtNum(totalDe(c))}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="vazio">Nenhuma cobrança encontrada.</p>';
    $$('#lista tr[data-id]').forEach(tr => tr.addEventListener('click', () => { location.hash = '#/cobranca/' + tr.dataset.id; }));
  };
  $('#fBusca').addEventListener('input', e => { st.busca = e.target.value; localStorage.setItem('cc-busca', st.busca); desenhar(); });
  $('#fCond').addEventListener('change', e => { st.cond = e.target.value; desenhar(); });
  $('#fTipo').addEventListener('change', e => { st.tipo = e.target.value; desenhar(); });
  $('#fSit').addEventListener('change', e => { st.sit = e.target.value; desenhar(); });
  desenhar();
}

/* ================= Condomínios ================= */
function telaCondominios() {
  const lista = Object.values(D.condominios).sort((a, b) => comparar(a.razao, b.razao));
  const qtd = id => Object.values(D.cobrancas).filter(c => c.condominioId === id && (c.situacao || 'ativa') === 'ativa').length;
  $('#conteudo').innerHTML = cabecalho('Condomínios (clientes)', '', '<a class="bt primario" href="#/condominio/novo">Novo condomínio</a>') +
    `<div class="cartao">${lista.length ? `<div class="rolagem"><table class="tabela clicavel"><thead><tr><th>Razão social</th><th>CNPJ</th><th>Endereço</th><th class="num">Cobranças ativas</th></tr></thead><tbody>
      ${lista.map(c => `<tr data-id="${c.id}"><td>${esc(c.razao)}</td><td>${esc(fmtDoc(c.cnpj))}</td><td>${esc(c.endereco)}</td><td class="num">${qtd(c.id)}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="vazio">Nenhum condomínio cadastrado.</p>'}</div>`;
  $$('tr[data-id]').forEach(tr => tr.addEventListener('click', () => { location.hash = '#/condominio/' + tr.dataset.id; }));
}

// Campos de encargos que podem herdar o padrão (condomínio herda das Configurações; cobrança herda do condomínio)
function camposEncargosHTML(valores, herdado, rotuloHerda) {
  const v = k => vazio(valores?.[k]) ? '' : valores[k];
  const ph = k => herdado ? `placeholder="${esc(fmtPct(herdado[k]))} (${rotuloHerda})"` : '';
  const emb = vazio(valores?.embutir) ? '' : (valores.embutir === true || valores.embutir === 'sim') ? 'sim' : 'nao';
  return `<div class="grade-form">
    <div class="campo"><label>Índice de correção</label><select data-p="indice">${herdado ? `<option value="">${esc(herdado.indice)} (${rotuloHerda})</option>` : ''}${INDICES.map(i => `<option ${v('indice') === i ? 'selected' : ''}>${i}</option>`).join('')}</select></div>
    <div class="campo"><label>Multa (%)</label><input data-p="multa" inputmode="decimal" value="${esc(v('multa') === '' ? '' : fmtPct(v('multa')))}" ${ph('multa')}></div>
    <div class="campo"><label>Juros de mora (% ao mês)</label><input data-p="juros" inputmode="decimal" value="${esc(v('juros') === '' ? '' : fmtPct(v('juros')))}" ${ph('juros')}></div>
    <div class="campo"><label>Honorários contratuais (%)</label><input data-p="honContr" inputmode="decimal" value="${esc(v('honContr') === '' ? '' : fmtPct(v('honContr')))}" ${ph('honContr')}></div>
    <div class="campo w2"><label>Honorários contratuais na planilha</label><select data-p="embutir">
      ${herdado ? `<option value="">${herdado.embutir ? 'Embutidos no valor das cotas' : 'Em linha separada'} (${rotuloHerda})</option>` : ''}
      <option value="nao" ${emb === 'nao' ? 'selected' : ''}>Em linha separada</option><option value="sim" ${emb === 'sim' ? 'selected' : ''}>Embutidos no valor originário das cotas</option></select>
      <small>Embutidos: o valor originário de cada cota já inclui o percentual dos honorários contratuais, sem menção na planilha.</small></div>
  </div>`;
}

function lerEncargos(raiz, permiteVazio) {
  const p = {};
  $$('[data-p]', raiz).forEach(el => {
    const k = el.dataset.p, val = el.value.trim();
    if (k === 'indice') p[k] = val;
    else if (k === 'embutir') p[k] = val === '' ? '' : val === 'sim';
    else p[k] = val === '' ? '' : parseValor(val);
  });
  if (!permiteVazio) for (const k of ['multa', 'juros', 'honContr']) if (p[k] === '') p[k] = 0;
  return p;
}

function telaCondominio(id) {
  const novo = !id || id === 'novo';
  const c = novo ? { id: novoId(), razao: '', cnpj: '', endereco: '', obs: '', padroes: {} } : structuredClone(D.condominios[id]);
  if (!c) throw new Error('Condomínio não encontrado.');
  const cobs = novo ? [] : Object.values(D.cobrancas).filter(x => x.condominioId === id).sort(ordemCobranca);
  const herd = { ...PADROES, ...D.config.padroes };
  const data = hoje();
  $('#conteudo').innerHTML = cabecalho(novo ? 'Novo condomínio' : c.razao, novo ? '' : esc(fmtDoc(c.cnpj)), '', '#/condominios') + `
    <form class="cartao" id="fCond" autocomplete="off">
      <h2>Dados do condomínio (credor)</h2>
      <div class="grade-form">
        <div class="campo w2"><label>Razão social *</label><input name="razao" required value="${esc(c.razao)}"></div>
        <div class="campo"><label>CNPJ</label><input name="cnpj" value="${esc(fmtDoc(c.cnpj))}"></div>
        <div class="campo"><label>Administradora / síndico (contato)</label><input name="contato" value="${esc(c.contato || '')}"></div>
        <div class="campo wfull"><label>Endereço</label><input name="endereco" value="${esc(c.endereco)}"></div>
        <div class="campo wfull"><label>Observações</label><textarea name="obs" rows="2">${esc(c.obs)}</textarea></div>
      </div>
      <h3 class="sec" style="margin-top:16px">Encargos e honorários deste condomínio</h3>
      <p class="dica">Conforme a convenção e o contrato de honorários com este cliente. Em branco, valem os padrões das Configurações. Cada cobrança ainda pode ter critérios próprios.</p>
      <div id="encCond">${camposEncargosHTML(c.padroes, herd, 'padrão')}</div>
      <div class="barra-form"><button class="bt primario">Salvar</button>${novo ? '' : '<button type="button" class="bt perigo" id="btExcluir">Excluir</button>'}</div>
    </form>
    ${novo ? '' : `<div class="cartao"><div class="cartao-cab"><h2>Cobranças (${cobs.length})</h2><div class="acoes">
      <a class="bt primario" href="#/cobranca/nova?cond=${c.id}">Nova cobrança</a><button class="bt" id="btLote">Importar planilha (Excel ou PDF)</button></div></div>
      ${cobs.length ? `<div class="rolagem"><table class="tabela clicavel"><thead><tr><th>Unidade</th><th>Devedor(es)</th><th>Cobrança</th><th class="num">Total atualizado</th></tr></thead><tbody>
        ${cobs.map(x => `<tr data-id="${x.id}"><td>${esc(x.unidade)}</td><td>${esc(devedoresCurto(x))}</td><td>${chipTipo(x)}${chipSit(x)}</td><td class="num">${fmtNum(calcularCobranca(x, data).total)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="vazio">Nenhuma cobrança.</p>'}
      <h3 class="sec" style="margin-top:16px">Planilha do cliente</h3>
      <div class="acoes-linha">${barraRelatorioHTML('rc')}</div></div>`}`;
  $('#fCond').addEventListener('input', marcarSujo);
  $('#fCond').addEventListener('submit', e => { e.preventDefault(); executar(async () => {
    const f = new FormData(e.target);
    for (const k of ['razao', 'cnpj', 'endereco', 'obs', 'contato']) c[k] = String(f.get(k) || '').trim();
    if (!c.razao) throw new Error('Informe a razão social.');
    c.padroes = lerEncargos($('#encCond'), true);
    await salvarRegistro('condominios', c);
    sujo = false;
    aviso('Condomínio salvo.');
    if (novo) location.hash = '#/condominio/' + c.id; else rotear();
  }); });
  $('#btExcluir')?.addEventListener('click', () => executar(async () => {
    if (cobs.length) throw new Error('Este condomínio tem cobranças. Exclua ou transfira as cobranças antes.');
    if (!confirm(`Excluir o condomínio "${c.razao}"? O arquivo vai para a pasta "lixeira".`)) return;
    await excluirRegistro('condominios', c.id);
    sujo = false;
    location.hash = '#/condominios';
  }));
  $$('tr[data-id]').forEach(tr => tr.addEventListener('click', () => { location.hash = '#/cobranca/' + tr.dataset.id; }));
  $('#btLote')?.addEventListener('click', () => abrirImportacao({ destino: 'lote', condominioId: c.id }));
  if (!novo) ligarBarraRelatorio('rc', 'cliente', () => c.id);
}

/* ---------- Barra de exportação (data, filtros, PDF e Excel) ---------- */
const barraRelatorioHTML = (id, comFiltros = true) => `
  <label class="inline">Atualizar até <input type="date" id="${id}Data" value="${hoje()}"></label>
  ${comFiltros ? `<select id="${id}Tipo" style="width:auto"><option value="todas">Judiciais e extrajudiciais</option><option value="judicial">Só judiciais</option><option value="extrajudicial">Só extrajudiciais</option></select>
  <select id="${id}Sit" style="width:auto"><option value="ativa">Só ativas</option><option value="todas">Ativas e encerradas</option></select>` : ''}
  <button class="bt" id="${id}Ver">Visualizar PDF</button><button class="bt" id="${id}Pdf">Salvar PDF</button><button class="bt" id="${id}Xlsx">Salvar Excel</button>`;

function ligarBarraRelatorio(id, tipo, chave) {
  const go = formato => executar(async () => {
    const data = $('#' + id + 'Data').value;
    if (!ehData(data)) throw new Error('Informe a data do cálculo.');
    await exportarRelatorio(formato, tipo, chave(), data, { tipo: $('#' + id + 'Tipo')?.value || 'todas', situacao: $('#' + id + 'Sit')?.value || 'ativa' });
  });
  $('#' + id + 'Ver').addEventListener('click', () => go('ver'));
  $('#' + id + 'Pdf').addEventListener('click', () => go('pdf'));
  $('#' + id + 'Xlsx').addEventListener('click', () => go('xlsx'));
}

/* ================= Cobrança ================= */
function telaCobranca(id, params) {
  const nova = !id || id === 'nova';
  const original = nova ? null : D.cobrancas[id];
  if (!nova && !original) throw new Error('Cobrança não encontrada.');
  const cob = nova ? novaCobranca(params.get('cond') || '') : structuredClone(original);
  cob.devedores = cob.devedores?.length ? cob.devedores : [{ nome: '', documento: '', endereco: '' }];
  cob.cotas = cob.cotas || []; cob.despesas = cob.despesas || []; cob.params = cob.params || {}; cob.sucumbencia = cob.sucumbencia || { tipo: 'nenhum' };
  const st = { data: hoje() };
  if (!Object.keys(D.condominios).length) {
    $('#conteudo').innerHTML = cabecalho('Nova cobrança', '', '', '#/inicio') + '<div class="cartao"><p>Cadastre antes o condomínio (credor).</p><a class="bt primario" href="#/condominio/novo">Novo condomínio</a></div>';
    return;
  }
  garantirIndices().then(() => { if (document.body.contains($('#calcResumo'))) recalcular(); });

  $('#conteudo').innerHTML = cabecalho(nova ? 'Nova cobrança' : `${cob.unidade || 'Unidade'} - ${nomeCond(cob)}`,
    nova ? '' : `${chipTipo(cob)}${chipSit(cob)} <span class="dica">${cob.alteradoPor ? 'Alterada por ' + esc(cob.alteradoPor) + ' em ' : 'Alterada em '}${new Date(cob.alteradoEm).toLocaleString('pt-BR')}</span>`, '', '#/inicio') + `
  <div class="cartao"><h2>Dados da cobrança</h2>
    <div class="grade-form">
      <div class="campo w2"><label>Condomínio (credor) *</label><select data-c="condominioId"><option value="">— escolha —</option>${optCondominios(cob.condominioId)}</select></div>
      <div class="campo w2"><label>Unidade *</label><input data-c="unidade" value="${esc(cob.unidade)}" placeholder="Ex.: Apartamento 101, Bloco A"></div>
      <div class="campo w2"><label>Tipo</label><div class="segmentado">
        <label><input type="radio" name="tipo" value="extrajudicial" ${cob.tipo !== 'judicial' ? 'checked' : ''}> Extrajudicial</label>
        <label><input type="radio" name="tipo" value="judicial" ${cob.tipo === 'judicial' ? 'checked' : ''}> Judicial</label></div></div>
      <div class="campo"><label>Situação</label><select data-c="situacao"><option value="ativa">Ativa</option><option value="encerrada" ${cob.situacao === 'encerrada' ? 'selected' : ''}>Encerrada</option></select></div>
      <div class="campo so-judicial"><label>Processo nº</label><input data-c="processo" value="${esc(cob.processo)}"></div>
      <div class="campo w2 so-judicial"><label>Juízo / vara</label><input data-c="juizo" value="${esc(cob.juizo)}"></div>
      <div class="campo wfull"><label>Observações internas (não saem na planilha)</label><textarea data-c="obs" rows="2">${esc(cob.obs)}</textarea></div>
    </div></div>

  <div class="cartao"><div class="cartao-cab"><h2>Devedores</h2><button class="bt pequeno" id="btAddDev">+ Adicionar devedor</button></div><div id="devedores"></div></div>

  <div class="cartao"><div class="cartao-cab"><h2>Cotas em aberto</h2><div class="acoes">
      <button class="bt pequeno" id="btAddCota">+ Adicionar cota</button><button class="bt pequeno" id="btSeqCotas">Lançar meses em sequência</button>
      <button class="bt pequeno" id="btImpCotas">Importar planilha</button><button class="bt pequeno" id="btOrdCotas">Ordenar por vencimento</button></div></div>
    <p class="dica">Valores originários de cada mês. Marque "Paga" para tirar a cota do cálculo sem apagá-la.</p>
    <div class="rolagem"><table class="tabela tabela-edit"><thead><tr><th>Competência</th><th>Descrição</th><th>Vencimento</th><th class="num">Valor originário</th><th class="cen">Paga</th><th></th></tr></thead><tbody id="cotas"></tbody></table></div>
    <div id="totCotas" class="dica" style="margin-top:8px"></div></div>

  <div class="cartao"><div class="cartao-cab"><h2>Despesas pagas</h2><div class="acoes"><button class="bt pequeno" id="btAddDesp">+ Adicionar despesa</button><button class="bt pequeno" id="btImpDesp">Importar planilha</button></div></div>
    <p class="dica">Custas, certidões, registros e outras despesas, com a data do pagamento. Marque "Corrigir" para atualizar o valor desde o pagamento pelo índice da cobrança.</p>
    <div class="rolagem"><table class="tabela tabela-edit"><thead><tr><th>Data do pagamento</th><th>Rubrica</th><th>Descrição</th><th class="num">Valor</th><th class="cen">Corrigir</th><th></th></tr></thead><tbody id="despesas"></tbody></table></div></div>

  <div class="cartao" id="encCob"><h2>Encargos e honorários contratuais</h2>
    <p class="dica">Em branco, valem os critérios do condomínio (ou os padrões das Configurações).</p><div id="encCampos"></div></div>

  <div class="cartao"><h2>Honorários sucumbenciais</h2>
    <div class="grade-form">
      <div class="campo w2"><label>Forma</label><select id="sucTipo"><option value="nenhum">Não incluir</option><option value="percentual">Percentual</option><option value="fixo">Valor fixo</option></select></div>
      <div class="campo suc-pct"><label>Percentual (%)</label><input id="sucPct" inputmode="decimal" value="${esc(cob.sucumbencia.pct ? fmtPct(cob.sucumbencia.pct) : '')}"></div>
      <div class="campo suc-pct"><label class="inline" style="margin-top:22px"><input type="checkbox" id="sucBaseDesp" ${cob.sucumbencia.baseDespesas ? 'checked' : ''}> Base inclui as despesas</label></div>
      <div class="campo suc-fixo"><label>Valor fixado (R$)</label><input id="sucValor" inputmode="decimal" value="${esc(cob.sucumbencia.valor ? fmtNum(cob.sucumbencia.valor) : '')}"></div>
      <div class="campo suc-fixo"><label>Data da fixação</label><input type="date" id="sucData" value="${esc(cob.sucumbencia.data || '')}"></div>
      <div class="campo suc-fixo"><label class="inline" style="margin-top:22px"><input type="checkbox" id="sucCorrigir" ${cob.sucumbencia.corrigir ? 'checked' : ''}> Corrigir desde a fixação</label></div>
    </div>
    <p class="dica">Percentual: incide sobre o débito atualizado (cotas com correção, juros e multa, mais os honorários contratuais), e também sobre as despesas se marcado.</p></div>

  <div class="cartao destaque"><div class="cartao-cab"><h2>Cálculo</h2><label class="inline">Atualizar até <input type="date" id="calcData" value="${st.data}"></label></div>
    <div class="colunas2"><div id="calcResumo" class="resumo"></div><div><p id="calcCrit" class="dica"></p><div id="calcAvisos"></div></div></div>
    <details class="detalhes"><summary>Ver o cálculo de cada cota</summary><div id="calcDet" class="rolagem"></div></details>
    <div class="acoes-linha"><button class="bt" id="expVer">Visualizar PDF</button><button class="bt" id="expPdf">Salvar PDF</button><button class="bt" id="expXlsx">Salvar Excel</button></div>
  </div>

  <div class="barra-salvar"><span id="estadoSalvar"></span>${nova ? '' : '<button class="bt perigo" id="btExcluir">Excluir</button><button class="bt" id="btDuplicar">Duplicar</button>'}<button class="bt primario" id="btSalvar">Salvar</button></div>`;

  // ---- Dados gerais
  const alterado = () => { marcarSujo(); recalcularLogo(); };
  $$('[data-c]').forEach(el => el.addEventListener('input', () => { cob[el.dataset.c] = el.value; alterado(); }));
  $$('[data-c]').forEach(el => el.addEventListener('change', () => { if (el.dataset.c === 'condominioId') desenharEncargos(); }));
  const mostrarJudicial = () => $$('.so-judicial').forEach(e => { e.hidden = cob.tipo !== 'judicial'; });
  $$('input[name=tipo]').forEach(r => r.addEventListener('change', () => { cob.tipo = r.value; mostrarJudicial(); alterado(); }));
  mostrarJudicial();

  // ---- Devedores
  function desenharDevedores() {
    $('#devedores').innerHTML = `<div class="dev-cab"><span>Nome</span><span>CPF/CNPJ</span><span>Endereço</span><span></span></div>` + cob.devedores.map((d, i) => `<div class="dev-linha" data-i="${i}">
      <input data-d="nome" value="${esc(d.nome)}" placeholder="Nome completo"><input data-d="documento" value="${esc(fmtDoc(d.documento))}" placeholder="CPF ou CNPJ">
      <input data-d="endereco" value="${esc(d.endereco || '')}" placeholder="Endereço para citação / notificação"><button class="bt-x" title="Remover" ${cob.devedores.length < 2 ? 'disabled' : ''}>&times;</button></div>`).join('');
    $$('#devedores .dev-linha').forEach(l => {
      const d = cob.devedores[+l.dataset.i];
      $$('[data-d]', l).forEach(inp => inp.addEventListener('input', () => { d[inp.dataset.d] = inp.value.trim(); alterado(); }));
      $('[data-d=documento]', l).addEventListener('change', e => { e.target.value = fmtDoc(e.target.value); });
      $('.bt-x', l).addEventListener('click', () => { cob.devedores.splice(+l.dataset.i, 1); desenharDevedores(); alterado(); });
    });
  }
  $('#btAddDev').addEventListener('click', () => { cob.devedores.push({ nome: '', documento: '', endereco: '' }); desenharDevedores(); marcarSujo(); });
  desenharDevedores();

  // ---- Cotas
  function desenharCotas() {
    $('#cotas').innerHTML = cob.cotas.map((c, i) => `<tr data-i="${i}" class="${c.pago ? 'excluido' : ''}">
      <td><input type="month" data-k="competencia" value="${esc(c.competencia || '')}"></td>
      <td><input data-k="descricao" list="dlDescCotas" value="${esc(c.descricao || '')}" placeholder="Cota condominial"></td>
      <td><input type="date" data-k="vencimento" value="${esc(c.vencimento || '')}"></td>
      <td><input data-k="valor" class="num" inputmode="decimal" value="${c.valor ? fmtNum(c.valor) : ''}"></td>
      <td class="cen"><input type="checkbox" data-k="pago" ${c.pago ? 'checked' : ''}></td>
      <td><button class="bt-x" title="Remover">&times;</button></td></tr>`).join('') || '<tr><td colspan="6" class="vazio">Nenhuma cota lançada.</td></tr>';
    $$('#cotas tr[data-i]').forEach(tr => {
      const c = cob.cotas[+tr.dataset.i];
      $$('[data-k]', tr).forEach(inp => inp.addEventListener(inp.type === 'checkbox' ? 'change' : 'input', () => {
        const k = inp.dataset.k;
        if (k === 'valor') c.valor = r2(parseValor(inp.value));
        else if (k === 'pago') { c.pago = inp.checked; tr.classList.toggle('excluido', c.pago); }
        else c[k] = inp.value;
        // Competência nova sem vencimento: sugere o mesmo dia de vencimento da cota anterior
        if (k === 'competencia' && ehMes(inp.value) && !c.vencimento) {
          const ant = cob.cotas.find(x => x !== c && x.vencimento);
          c.vencimento = diaDoMes(inp.value, ant ? +ant.vencimento.slice(8) : 10);
          $('[data-k=vencimento]', tr).value = c.vencimento;
        }
        alterado(); totalCotas();
      }));
      $('[data-k=valor]', tr).addEventListener('change', e => { e.target.value = c.valor ? fmtNum(c.valor) : ''; });
      $('.bt-x', tr).addEventListener('click', () => { cob.cotas.splice(+tr.dataset.i, 1); desenharCotas(); alterado(); });
    });
    totalCotas();
  }
  function totalCotas() {
    const abertas = cob.cotas.filter(c => !c.pago);
    $('#totCotas').textContent = `${abertas.length} cota(s) em aberto · total originário ${fmtMoeda(abertas.reduce((s, c) => s + cent(c.valor), 0) / 100)}` + (cob.cotas.length > abertas.length ? ` · ${cob.cotas.length - abertas.length} marcada(s) como paga(s)` : '');
  }
  $('#btAddCota').addEventListener('click', () => {
    const ult = [...cob.cotas].filter(c => c.competencia).sort((a, b) => comparar(a.competencia, b.competencia)).pop();
    const comp = ult ? addMes(ult.competencia, 1) : '';
    cob.cotas.push({ id: novoId(), competencia: comp, descricao: ult?.descricao || 'Cota condominial', vencimento: ult && comp ? diaDoMes(addMes(ult.vencimento.slice(0, 7), 1), +ult.vencimento.slice(8)) : '', valor: ult?.valor || 0 });
    desenharCotas(); alterado();
    $('#cotas tr:last-child input')?.focus();
  });
  $('#btOrdCotas').addEventListener('click', () => { cob.cotas.sort((a, b) => comparar(a.vencimento, b.vencimento) || comparar(a.competencia, b.competencia)); desenharCotas(); marcarSujo(); });
  $('#btSeqCotas').addEventListener('click', () => lancarSequencia(cob, () => { desenharCotas(); alterado(); }));
  $('#btImpCotas').addEventListener('click', () => abrirImportacao({ destino: 'cotas', aoConcluir: lista => { cob.cotas.push(...lista); desenharCotas(); alterado(); } }));
  desenharCotas();

  // ---- Despesas
  function desenharDespesas() {
    $('#despesas').innerHTML = cob.despesas.map((d, i) => `<tr data-i="${i}">
      <td><input type="date" data-k="data" value="${esc(d.data || '')}"></td>
      <td><input data-k="rubrica" list="dlRubricas" value="${esc(d.rubrica || '')}"></td>
      <td><input data-k="descricao" value="${esc(d.descricao || '')}"></td>
      <td><input data-k="valor" class="num" inputmode="decimal" value="${d.valor ? fmtNum(d.valor) : ''}"></td>
      <td class="cen"><input type="checkbox" data-k="corrigir" ${d.corrigir !== false ? 'checked' : ''}></td>
      <td><button class="bt-x" title="Remover">&times;</button></td></tr>`).join('') || '<tr><td colspan="6" class="vazio">Nenhuma despesa lançada.</td></tr>';
    $$('#despesas tr[data-i]').forEach(tr => {
      const d = cob.despesas[+tr.dataset.i];
      $$('[data-k]', tr).forEach(inp => inp.addEventListener(inp.type === 'checkbox' ? 'change' : 'input', () => {
        const k = inp.dataset.k;
        if (k === 'valor') d.valor = r2(parseValor(inp.value)); else if (k === 'corrigir') d.corrigir = inp.checked; else d[k] = inp.value;
        alterado();
      }));
      $('[data-k=valor]', tr).addEventListener('change', e => { e.target.value = d.valor ? fmtNum(d.valor) : ''; });
      $('.bt-x', tr).addEventListener('click', () => { cob.despesas.splice(+tr.dataset.i, 1); desenharDespesas(); alterado(); });
    });
  }
  $('#btAddDesp').addEventListener('click', () => { cob.despesas.push({ id: novoId(), data: hoje(), rubrica: '', descricao: '', valor: 0, corrigir: true }); desenharDespesas(); marcarSujo(); });
  $('#btImpDesp').addEventListener('click', () => abrirImportacao({ destino: 'despesas', aoConcluir: lista => { cob.despesas.push(...lista); desenharDespesas(); alterado(); } }));
  desenharDespesas();

  // ---- Encargos (herdam do condomínio)
  function desenharEncargos() {
    const herd = paramsCobranca({ condominioId: cob.condominioId, params: {} });
    $('#encCampos').innerHTML = camposEncargosHTML(cob.params, herd, cob.condominioId ? 'do condomínio' : 'padrão');
    $$('#encCampos [data-p]').forEach(el => el.addEventListener('input', () => { cob.params = lerEncargos($('#encCampos'), true); alterado(); }));
    recalcular();
  }

  // ---- Sucumbência
  const mostrarSuc = () => {
    const t = cob.sucumbencia.tipo || 'nenhum';
    $$('.suc-pct').forEach(e => { e.hidden = t !== 'percentual'; });
    $$('.suc-fixo').forEach(e => { e.hidden = t !== 'fixo'; });
  };
  $('#sucTipo').value = cob.sucumbencia.tipo || 'nenhum';
  const lerSuc = () => {
    cob.sucumbencia = { tipo: $('#sucTipo').value, pct: parseValor($('#sucPct').value), baseDespesas: $('#sucBaseDesp').checked,
      valor: r2(parseValor($('#sucValor').value)), data: $('#sucData').value, corrigir: $('#sucCorrigir').checked };
    mostrarSuc(); alterado();
  };
  ['sucTipo', 'sucPct', 'sucBaseDesp', 'sucValor', 'sucData', 'sucCorrigir'].forEach(i => $('#' + i).addEventListener('input', lerSuc));
  ['sucBaseDesp', 'sucCorrigir', 'sucTipo'].forEach(i => $('#' + i).addEventListener('change', lerSuc));
  mostrarSuc();

  // ---- Cálculo
  let tmr;
  function recalcularLogo() { clearTimeout(tmr); tmr = setTimeout(recalcular, 250); }
  function recalcular() {
    const data = $('#calcData').value;
    if (!ehData(data)) return;
    const r = calcularCobranca(cob, data);
    $('#calcResumo').innerHTML = itensResumo(r).map(([rot, v, e]) => `<div class="res-l ${e === 'f' ? 'final' : e === 'b' ? 'dest' : ''}"><span>${esc(rot)}</span><b>${fmtMoeda(v)}</b></div>`).join('');
    $('#calcCrit').textContent = descCriterios(r);
    $('#calcAvisos').innerHTML = notasCalculo(r).slice(1).map(n => `<p class="alerta">${esc(n)}</p>`).join('')
      + (r.p.embutir ? `<p class="dica">Honorários contratuais de ${fmtPct(r.p.honContr)}% embutidos no valor originário das cotas.</p>` : '');
    $('#calcDet').innerHTML = r.cotas.length ? `<table class="tabela"><thead><tr><th>Competência</th><th>Vencimento</th><th class="num">Valor originário</th><th class="num">Fator</th><th class="num">Corrigido</th><th class="num">Dias</th><th class="num">Juros</th><th class="num">Multa</th><th class="num">Total</th></tr></thead><tbody>
      ${r.cotas.map(x => `<tr><td>${mesNum(x.c.competencia)} ${esc(x.c.descricao && x.c.descricao !== 'Cota condominial' ? '· ' + x.c.descricao : '')}</td><td>${fmtData(x.c.vencimento)}</td><td class="num">${fmtNum(x.valor)}</td><td class="num">${fmtFator(x.e.fator)}</td><td class="num">${fmtNum(x.e.corrigido)}</td><td class="num">${x.e.dias}</td><td class="num">${fmtNum(x.e.juros)}</td><td class="num">${fmtNum(x.e.multa)}</td><td class="num">${fmtNum(x.e.total)}</td></tr>`).join('')}
      <tr class="subtotal"><td>Totais</td><td></td><td class="num">${fmtNum(r.tc.original)}</td><td></td><td class="num">${fmtNum(r.tc.corrigido)}</td><td></td><td class="num">${fmtNum(r.tc.juros)}</td><td class="num">${fmtNum(r.tc.multa)}</td><td class="num">${fmtNum(r.tc.total)}</td></tr></tbody></table>` : '<p class="vazio">Nenhuma cota vencida em aberto até a data.</p>';
  }
  $('#calcData').addEventListener('change', recalcular);
  desenharEncargos();

  // ---- Exportação (usa o que está na tela, mesmo antes de salvar)
  const exportar = formato => executar(async () => {
    validar();
    const data = $('#calcData').value;
    if (!ehData(data)) throw new Error('Informe a data do cálculo.');
    await garantirIndices();
    const nome = nomeArquivo('Planilha', nomeCond(cob).slice(0, 40), cob.unidade);
    if (formato === 'xlsx') return salvarPlanilha(gerarXLSXCobrancas({ cobs: [cob], dataCalc: data }), nome + '.xlsx');
    const pdf = gerarPDFCobrancas({ titulo: 'Planilha de débito', cobs: [cob], dataCalc: data, nome });
    return formato === 'ver' ? visualizarPDF(pdf) : salvarPDF(pdf);
  });
  $('#expVer').addEventListener('click', () => exportar('ver'));
  $('#expPdf').addEventListener('click', () => exportar('pdf'));
  $('#expXlsx').addEventListener('click', () => exportar('xlsx'));

  // ---- Salvar / excluir / duplicar
  function validar() {
    if (!cob.condominioId) throw new Error('Escolha o condomínio (credor).');
    if (!cob.unidade.trim()) throw new Error('Informe a unidade.');
    const semData = cob.cotas.filter(c => Number(c.valor) > 0 && !ehData(c.vencimento));
    if (semData.length) throw new Error(`Há ${semData.length} cota(s) sem data de vencimento.`);
  }
  $('#btSalvar').addEventListener('click', () => executar(async () => {
    validar();
    cob.unidade = cob.unidade.trim();
    cob.devedores = cob.devedores.filter(d => d.nome || d.documento);
    cob.cotas = cob.cotas.filter(c => Number(c.valor) > 0 || c.competencia);
    cob.despesas = cob.despesas.filter(d => Number(d.valor) > 0);
    await salvarRegistro('cobrancas', cob);
    sujo = false;
    aviso('Cobrança salva.');
    if (nova) { ignorarHash = true; location.hash = '#/cobranca/' + cob.id; hashAnterior = location.hash; }
    telaCobranca(cob.id, new URLSearchParams());
  }));
  $('#btExcluir')?.addEventListener('click', () => executar(async () => {
    if (!confirm('Excluir esta cobrança? O arquivo vai para a pasta "lixeira" dos dados.')) return;
    await excluirRegistro('cobrancas', cob.id);
    sujo = false;
    location.hash = '#/inicio';
  }));
  $('#btDuplicar')?.addEventListener('click', () => executar(async () => {
    if (sujo) throw new Error('Salve as alterações antes de duplicar.');
    const copia = { ...structuredClone(original), id: novoId(), rev: 0, criadoEm: '', unidade: original.unidade + ' (cópia)' };
    copia.cotas.forEach(c => { c.id = novoId(); });
    await salvarRegistro('cobrancas', copia);
    location.hash = '#/cobranca/' + copia.id;
  }));
}

// Lança várias competências seguidas com o mesmo valor
function lancarSequencia(cob, depois) {
  const ult = [...cob.cotas].filter(c => c.competencia).sort((a, b) => comparar(a.competencia, b.competencia)).pop();
  const de = ult ? addMes(ult.competencia, 1) : addMes(mesAtual(), -12);
  abrirModal(`<div class="modal-cab"><h2>Lançar meses em sequência</h2><button class="bt-x" data-fechar>&times;</button></div>
    <div class="grade-form">
      <div class="campo"><label>Da competência</label><input type="month" id="sqDe" value="${de}"></div>
      <div class="campo"><label>Até a competência</label><input type="month" id="sqAte" value="${addMes(mesAtual(), -1) < de ? de : addMes(mesAtual(), -1)}"></div>
      <div class="campo"><label>Dia do vencimento</label><input type="number" id="sqDia" min="1" max="31" value="${ult ? +ult.vencimento.slice(8) : 10}"></div>
      <div class="campo"><label>Vencimento</label><select id="sqMes"><option value="0">No mês da competência</option><option value="1">No mês seguinte</option></select></div>
      <div class="campo"><label>Valor de cada mês (R$)</label><input id="sqValor" inputmode="decimal" value="${ult?.valor ? fmtNum(ult.valor) : ''}"></div>
      <div class="campo w2"><label>Descrição</label><input id="sqDesc" list="dlDescCotas" value="${esc(ult?.descricao || 'Cota condominial')}"></div>
    </div>
    <p class="dica">Os valores podem ser ajustados mês a mês depois. Competências já lançadas com a mesma descrição não são repetidas.</p>
    <div class="acoes-linha"><button class="bt primario" id="sqOk">Lançar</button><button class="bt" data-fechar>Cancelar</button></div>`, 'modal-medio');
  if (ult && ult.vencimento.slice(0, 7) > ult.competencia) $('#sqMes').value = '1';
  $('#sqOk').addEventListener('click', () => executar(() => {
    const a = $('#sqDe').value, b = $('#sqAte').value, valor = r2(parseValor($('#sqValor').value)), desc = $('#sqDesc').value.trim() || 'Cota condominial';
    if (!ehMes(a) || !ehMes(b) || a > b) throw new Error('Confira as competências inicial e final.');
    if (!(valor > 0)) throw new Error('Informe o valor.');
    let n = 0;
    for (let m = a; m <= b; m = addMes(m, 1)) {
      if (cob.cotas.some(c => c.competencia === m && normalizar(c.descricao) === normalizar(desc))) continue;
      cob.cotas.push({ id: novoId(), competencia: m, descricao: desc, vencimento: diaDoMes(addMes(m, +$('#sqMes').value), $('#sqDia').value), valor });
      n++;
      if (n > 600) break;
    }
    cob.cotas.sort((x, y) => comparar(x.vencimento, y.vencimento));
    fecharModal(); depois(); aviso(`${n} cota(s) lançada(s).`);
  }));
}

/* ================= Devedores e imóveis ================= */
function telaAgrupada({ titulo, sub, itens, colunas, linha, tipo }) {
  const data = hoje();
  $('#conteudo').innerHTML = cabecalho(titulo, sub) + `<div class="cartao">
    <div class="barra-filtros"><input type="search" id="fBusca" placeholder="Buscar…"><span class="espaco"></span>${barraRelatorioHTML('rg')}</div>
    <p class="dica">Clique numa linha para escolher. A planilha sai com o resumo e o detalhamento de cada cobrança.</p>
    <div id="lista"></div></div>`;
  let escolhido = null;
  const desenhar = () => {
    const q = normalizar($('#fBusca').value);
    const l = itens.filter(i => !q || normalizar(i.busca).includes(q));
    $('#lista').innerHTML = l.length ? `<div class="rolagem"><table class="tabela clicavel"><thead><tr><th></th>${colunas.map(c => `<th class="${c.num ? 'num' : ''}">${c.t}</th>`).join('')}<th class="num">Total atualizado</th></tr></thead><tbody>
      ${l.map(i => `<tr data-k="${esc(i.chave)}" class="${i.chave === escolhido ? 'selecionado' : ''}"><td><input type="radio" name="esc" ${i.chave === escolhido ? 'checked' : ''}></td>${linha(i)}<td class="num">${fmtNum(i.cobs.filter(c => (c.situacao || 'ativa') === 'ativa').reduce((s, c) => s + cent(calcularCobranca(c, data).total), 0) / 100)}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="vazio">Nada encontrado.</p>';
    $$('#lista tr[data-k]').forEach(tr => tr.addEventListener('click', () => { escolhido = tr.dataset.k; desenhar(); }));
  };
  $('#fBusca').addEventListener('input', desenhar);
  desenhar();
  ligarBarraRelatorio('rg', tipo, () => { if (!escolhido) throw new Error('Escolha uma linha da lista.'); return escolhido; });
}

function telaDevedores() {
  const itens = listaDevedores().map(d => ({ ...d, busca: d.nome + ' ' + soDigitos(d.documento) }));
  telaAgrupada({
    titulo: 'Devedores', sub: 'Planilha por devedor: reúne todas as cobranças em que a pessoa figura como devedora (identificada pelo CPF/CNPJ, ou pelo nome).', tipo: 'devedor', itens,
    colunas: [{ t: 'Devedor' }, { t: 'CPF/CNPJ' }, { t: 'Unidades' }],
    linha: i => `<td>${esc(i.nome)}</td><td>${esc(fmtDoc(i.documento))}</td><td>${esc(i.cobs.map(c => `${c.unidade} (${nomeCond(c)})`).join('; '))}</td>`,
  });
}

function telaImoveis() {
  const itens = listaImoveis().map(i => ({ ...i, busca: nomeCond(i.cobs[0]) + ' ' + i.unidade + ' ' + i.cobs.map(devedoresCurto).join(' ') }));
  telaAgrupada({
    titulo: 'Imóveis (unidades)', sub: 'Planilha por imóvel: reúne todas as cobranças da unidade (por exemplo, a extrajudicial e a judicial, ou de proprietários diferentes).', tipo: 'imovel', itens,
    colunas: [{ t: 'Condomínio' }, { t: 'Unidade' }, { t: 'Devedor(es)' }, { t: 'Cobranças', num: true }],
    linha: i => `<td>${esc(nomeCond(i.cobs[0]))}</td><td>${esc(i.unidade)}</td><td>${esc([...new Set(i.cobs.map(devedoresCurto))].join('; '))}</td><td class="num">${i.cobs.length}</td>`,
  });
}

function telaRelatorios() {
  $('#conteudo').innerHTML = cabecalho('Planilhas', 'Planilhas de débito em PDF e Excel.') + `
    <div class="opcoes-conexao">
      <a class="cartao link-cartao" href="#/condominios"><h2>Por cliente (condomínio)</h2><p class="dica">Abra o condomínio e use "Planilha do cliente": todas as unidades em cobrança, com resumo e detalhamento.</p></a>
      <a class="cartao link-cartao" href="#/devedores"><h2>Por devedor</h2><p class="dica">Todas as cobranças de um devedor, inclusive em condomínios diferentes.</p></a>
      <a class="cartao link-cartao" href="#/imoveis"><h2>Por imóvel</h2><p class="dica">Todas as cobranças de uma unidade.</p></a>
      <a class="cartao link-cartao" href="#/inicio"><h2>Por cobrança</h2><p class="dica">Abra a cobrança e use os botões da seção "Cálculo".</p></a>
    </div>
    <p class="dica" style="margin-top:16px">A planilha em Excel tem fórmulas em tudo: alterando a data do cálculo, a multa, os juros ou os honorários, os valores são recalculados, inclusive a correção monetária. Também é possível incluir novos meses e despesas nas linhas em branco das tabelas: os encargos são calculados e somados ao total.</p>`;
}

/* ================= Configurações ================= */
function telaConfig() {
  const c = structuredClone(D.config), e = c.escritorio;
  $('#conteudo').innerHTML = cabecalho('Configurações') + `
  <form class="cartao" id="fEsc" autocomplete="off"><h2>Escritório (cabeçalho das planilhas)</h2>
    <div class="grade-form">
      <div class="campo w2"><label>Nome</label><input name="nome" value="${esc(e.nome || '')}"></div>
      <div class="campo"><label>CNPJ / CPF</label><input name="documento" value="${esc(e.documento || '')}"></div>
      <div class="campo"><label>OAB</label><input name="oab" value="${esc(e.oab || '')}" placeholder="OAB/RJ 000.000"></div>
      <div class="campo wfull"><label>Endereço</label><input name="endereco" value="${esc(e.endereco || '')}"></div>
      <div class="campo"><label>Telefone</label><input name="telefone" value="${esc(e.telefone || '')}"></div>
      <div class="campo"><label>E-mail</label><input name="email" value="${esc(e.email || '')}"></div>
      <div class="campo w2"><label>Site</label><input name="site" value="${esc(e.site || '')}"></div>
      <div class="campo wfull"><label>Logotipo (PNG ou JPG)</label><div class="logo-ctl">${e.logo ? `<img src="${e.logo}" alt="">` : ''}<input type="file" id="logoArq" accept="image/png,image/jpeg">${e.logo ? '<button type="button" class="bt pequeno" id="logoTirar">Remover</button>' : ''}</div></div>
    </div>
    <h3 class="sec" style="margin-top:16px">Padrões de encargos e honorários</h3>
    <p class="dica">Usados quando o condomínio e a cobrança não têm critérios próprios. Código Civil, art. 1.336, § 1º: juros convencionados ou, se não previstos, de 1% ao mês, e multa de até 2%.</p>
    <div id="encPad">${camposEncargosHTML(c.padroes, null)}</div>
    <label class="inline" style="margin-top:10px"><input type="checkbox" id="ignNeg" ${c.padroes.ignorarNegativos ? 'checked' : ''}> Desconsiderar índices mensais negativos (deflação) no IGP-M e no IPCA</label>
    <h3 class="sec" style="margin-top:16px">Rubricas de despesas</h3>
    <p class="dica">Sugestões ao lançar despesas (uma por linha).</p>
    <textarea id="rubricas" rows="6">${esc(c.rubricas.join('\n'))}</textarea>
    <div class="barra-form"><button class="bt primario">Salvar configurações</button></div>
  </form>
  ${secaoIndicesHTML()}
  <div class="cartao"><h2>Este computador</h2>
    <div class="grade-form"><div class="campo w2"><label>Seu nome (registrado em cada alteração)</label><input id="nomeUsu" value="${esc(usuarioLocal())}"></div></div>
    <dl class="dados" style="margin-top:12px"><div><dt>Dados</dt><dd>${esc(Armaz.descricao())}</dd></div><div><dt>Versão</dt><dd>${VERSAO}</dd></div></dl>
    <div class="acoes-linha"><button class="bt" id="btNomeUsu">Gravar nome</button><button class="bt" id="btTrocar">Trocar a pasta dos dados</button></div></div>`;
  ligarIndices();
  let logo = { logo: e.logo, logoL: e.logoL, logoA: e.logoA };
  $('#fEsc').addEventListener('input', marcarSujo);
  $('#logoArq').addEventListener('change', ev => executar(async () => {
    const f = ev.target.files[0]; if (!f) return;
    if (f.size > 600e3) throw new Error('Imagem grande demais (máximo 600 KB).');
    const url = await new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(f); });
    const img = new Image(); img.src = url; await img.decode();
    logo = { logo: url, logoL: img.naturalWidth, logoA: img.naturalHeight };
    marcarSujo();
  }));
  $('#logoTirar')?.addEventListener('click', () => { logo = {}; $('.logo-ctl img')?.remove(); marcarSujo(); });
  $('#fEsc').addEventListener('submit', ev => { ev.preventDefault(); executar(async () => {
    const f = new FormData(ev.target);
    c.escritorio = { ...Object.fromEntries(['nome', 'documento', 'oab', 'endereco', 'telefone', 'email', 'site'].map(k => [k, String(f.get(k) || '').trim()])), ...logo };
    c.padroes = { ...lerEncargos($('#encPad'), false), ignorarNegativos: $('#ignNeg').checked };
    if (!c.padroes.indice) c.padroes.indice = 'UFIR-RJ';
    c.rubricas = $('#rubricas').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    await salvarConfig(c);
    sujo = false;
    aviso('Configurações salvas.');
    telaConfig();
  }); });
  $('#btNomeUsu').addEventListener('click', () => { localStorage.setItem('cc-usuario', $('#nomeUsu').value.trim()); aviso('Nome gravado neste computador.'); });
  $('#btTrocar').addEventListener('click', () => executar(async () => {
    if (sujo && !confirm('Há alterações não salvas. Continuar?')) return;
    sujo = false;
    Armaz.desconectar();
    document.body.classList.remove('conectado');
    telaConexao();
  }));
}

/* ================= Conexão (pasta dos dados) ================= */
async function telaConexao() {
  document.body.classList.remove('conectado');
  $('#statusArmaz').textContent = '';
  const salva = localStorage.getItem('cc-modo') === 'pasta' ? await Armaz.nomePastaSalva() : '';
  const suporta = 'showDirectoryPicker' in window;
  $('#conteudo').innerHTML = `<div class="boas-vindas"><h1>Cobrança Condominial</h1>
    <p class="dica">Planilhas de cobrança judicial e extrajudicial de cotas condominiais em atraso.</p></div>
    ${suporta ? '' : '<p class="alerta">Este navegador não permite gravar numa pasta. Abra o programa no Google Chrome ou no Microsoft Edge.</p>'}
    <div class="opcoes-conexao">
      ${salva ? `<div class="cartao destaque"><h2>Continuar</h2><p>Pasta dos dados: <b>${esc(salva)}</b></p><button class="bt primario" id="btRetomar">Abrir</button></div>` : ''}
      <div class="cartao"><h2>${salva ? 'Escolher outra pasta' : 'Escolher a pasta dos dados'}</h2>
        <p class="dica">Para trabalhar em equipe, escolha uma pasta do <b>Dropbox</b> compartilhada com todos (ex.: <i>Dropbox\\Cobrança Condominial\\dados</i>). Cada pessoa abre o programa no próprio computador e escolhe a mesma pasta.</p>
        <button class="bt ${salva ? '' : 'primario'}" id="btPasta" ${suporta ? '' : 'disabled'}>Escolher pasta…</button></div>
      <div class="cartao"><h2>Apenas testar</h2><p class="dica">Os dados ficam só neste navegador. Não use para o trabalho real.</p><button class="bt" id="btLocal">Testar sem pasta</button></div>
    </div>`;
  const entrar = async () => {
    if (!usuarioLocal()) {
      const n = prompt('Seu nome (fica registrado em cada alteração que você fizer):', '');
      if (n) localStorage.setItem('cc-usuario', n.trim());
    }
    await conectado();
  };
  $('#btRetomar')?.addEventListener('click', () => executar(async () => {
    if (!await Armaz.retomarPasta(true)) throw new Error('Sem permissão para a pasta. Escolha a pasta novamente.');
    await entrar();
  }));
  $('#btPasta').addEventListener('click', () => executar(async () => { await Armaz.conectarPasta(); await entrar(); }));
  $('#btLocal').addEventListener('click', () => executar(async () => { Armaz.usarLocal(); await entrar(); }));
}

async function conectado() {
  $('#conteudo').innerHTML = '<p class="carregando">Lendo os dados…</p>';
  await recarregarTudo();
  document.body.classList.add('conectado');
  $('#statusArmaz').textContent = Armaz.descricao() + (usuarioLocal() ? ' · ' + usuarioLocal() : '');
  $('#rodapeMenu').innerHTML = `Versão ${VERSAO}`;
  rotear();
}

/* ================= Início ================= */
function eventosGlobais() {
  $('#btMenu').addEventListener('click', () => document.body.classList.toggle('menu-aberto'));
  $('#fundoMenu').addEventListener('click', () => document.body.classList.remove('menu-aberto'));
  document.addEventListener('click', e => { if (e.target.closest('[data-fechar]')) fecharModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) fecharModal(); });
  // Ao voltar para a janela, relê os dados (outras pessoas podem ter alterado pelo Dropbox)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !document.body.classList.contains('conectado') || sujo || !$('#modal').hidden) return;
    if (Date.now() - D.carregadoEm < 30000) return;
    executar(async () => { await recarregarTudo(); rotear(); });
  });
}

async function iniciar() {
  eventosGlobais();
  const modo = localStorage.getItem('cc-modo');
  try {
    if (modo === 'local') { Armaz.usarLocal(); return await conectado(); }
    if (modo === 'pasta' && await Armaz.retomarPasta(false)) return await conectado();
  } catch (e) { console.error(e); aviso(e.message, 'erro'); }
  telaConexao();
}

iniciar();
