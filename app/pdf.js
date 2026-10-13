'use strict';
/* PDF (jsPDF): papel timbrado do escritório, tabelas, resumo, prévia e gravação */
const COR_PRI = [31, 78, 121];
const COR_FUNDO = [234, 240, 247];
const COR_TEXTO = [33, 37, 41];
const COR_SUAVE = [100, 108, 118];

function novoDocumento(paisagem) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: paisagem ? 'landscape' : 'portrait' });
  const P = paisagem ? { doc, M: 14, W: 297, H: 210, larg: 269, y: 0, rodape: 16 } : { doc, M: 14, W: 210, H: 297, larg: 182, y: 0, rodape: 16 };
  const adm = D.config.escritorio || {};

  // Cabeçalho (papel timbrado) repetido em todas as páginas
  P.cab = () => {
    const top = 9;
    let x = P.M, altLogo = 0;
    if (adm.logo && adm.logoL && adm.logoA) {
      const e = Math.min(40 / adm.logoL, 18 / adm.logoA), w = adm.logoL * e, h = adm.logoA * e;
      try { doc.addImage(adm.logo, adm.logo.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG', x, top, w, h); x += w + 5; altLogo = h; } catch (err) { console.warn(err); }
    }
    const larg = P.W - P.M - x;
    let y = top + 4.8;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...COR_PRI);
    doc.text(doc.splitTextToSize(adm.nome || 'Planilha de cobrança', larg)[0], x, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.2); doc.setTextColor(...COR_SUAVE);
    const linhas = [
      [adm.documento, adm.oab].filter(Boolean).join('   ·   '),
      adm.endereco,
      [adm.telefone, adm.email, adm.site].filter(Boolean).join('   ·   '),
    ].filter(Boolean).flatMap(l => doc.splitTextToSize(l, larg));
    linhas.forEach(l => { y += 3.7; doc.text(l, x, y); });
    const fim = Math.max(top + altLogo, y + 1.2) + 2.5;
    doc.setDrawColor(...COR_PRI); doc.setLineWidth(0.5);
    doc.line(P.M, fim, P.W - P.M, fim);
    P.y = fim + 6;
    doc.setTextColor(...COR_TEXTO);
  };
  P.novaPagina = () => { doc.addPage(); P.cab(); };
  P.espaco = h => { if (P.y + h > P.H - P.rodape) P.novaPagina(); };
  return P;
}

/*
  Tabela com ajuste automático das colunas.
  cols: [{ t, w, a: 'r' (direita), nw: true (não quebra) }] — colunas à direita (valores) e "nw" (datas) nunca quebram:
  ganham a largura necessária, tirada das colunas de texto; se mesmo assim não couber, a fonte diminui.
  linhas: [{ c: [...], total, grupo }]
*/
function larguraColunas(P, cols, linhas, fs) {
  const { doc } = P, pad = 1.5;
  const soma = cols.reduce((s, c) => s + c.w, 0);
  const w = cols.map(c => c.w * P.larg / soma);
  const min = cols.map((c, j) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(fs - 0.5);
    let m = Math.max(...String(c.t).split(/\s+/).map(p => doc.getTextWidth(p)));
    if (c.a === 'r' || c.nw) {
      for (const ln of linhas) {
        if (ln.grupo) continue;
        doc.setFont('helvetica', ln.total ? 'bold' : 'normal'); doc.setFontSize(fs);
        m = Math.max(m, doc.getTextWidth(String(ln.c[j] ?? '')));
      }
    } else {
      // Colunas de texto quebram entre palavras: a mais longa precisa caber (até 30 mm)
      for (const ln of linhas) {
        if (ln.grupo) continue;
        doc.setFont('helvetica', ln.total ? 'bold' : 'normal'); doc.setFontSize(fs);
        for (const p of String(ln.c[j] ?? '').split(/\s+/)) m = Math.max(m, Math.min(30, doc.getTextWidth(p)));
      }
    }
    return m + 2 * pad + 0.6;
  });
  const falta = w.reduce((s, x, j) => s + Math.max(0, min[j] - x), 0);
  if (!falta) return w;
  const folgas = w.map((x, j) => Math.max(0, x - min[j]));
  const totalFolga = folgas.reduce((s, x) => s + x, 0);
  if (totalFolga < falta) return null;
  return w.map((x, j) => x < min[j] ? min[j] : x - folgas[j] * falta / totalFolga);
}

function tabelaPDF(P, colsIn, linhas, fsMax = 8.5) {
  const { doc } = P;
  let fs = fsMax, larguras = null;
  while (!(larguras = larguraColunas(P, colsIn, linhas, fs)) && fs > 6.5) fs -= 0.5;
  if (!larguras) larguras = colsIn.map(c => c.w * P.larg / colsIn.reduce((s, x) => s + x.w, 0));
  const cols = colsIn.map((c, j) => ({ ...c, w: larguras[j] }));
  const pad = 1.5, lh = fs * 0.3528 * 1.22;
  const quebra = (txt, w, nw) => nw ? [String(txt ?? '')] : doc.splitTextToSize(String(txt ?? ''), w - 2 * pad);
  const escrever = (partes, cs, y) => {
    let x = P.M;
    partes.forEach((p, j) => {
      const c = cs[j];
      p.forEach((t, k) => {
        const ty = y + pad + k * lh + lh * 0.78;
        if (c.a === 'r') doc.text(t, x + c.w - pad, ty, { align: 'right' });
        else if (c.a === 'c') doc.text(t, x + c.w / 2, ty, { align: 'center' });
        else doc.text(t, x + pad, ty);
      });
      x += c.w;
    });
  };
  const desenharCab = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(fs - 0.5);
    const partes = cols.map(c => quebra(c.t, c.w));
    const h = Math.max(...partes.map(p => p.length)) * lh + 2 * pad;
    doc.setFillColor(...COR_PRI); doc.rect(P.M, P.y, P.larg, h, 'F');
    doc.setTextColor(255);
    escrever(partes, cols, P.y);
    P.y += h;
    doc.setTextColor(...COR_TEXTO);
  };

  P.espaco(lh * 4 + 10);
  desenharCab();
  linhas.forEach((ln, i) => {
    const fonte = () => { doc.setFont('helvetica', ln.total || ln.grupo ? 'bold' : (ln.italico ? 'italic' : 'normal')); doc.setFontSize(fs); };
    fonte();
    // Linha de grupo: o primeiro texto ocupa a largura toda da tabela
    const cs = ln.grupo ? [{ w: P.larg }] : cols;
    const partes = ln.grupo ? [quebra(ln.c[0], P.larg)] : ln.c.map((v, j) => quebra(v, cols[j].w, cols[j].a === 'r' || cols[j].nw));
    const h = Math.max(...partes.map(p => p.length)) * lh + 2 * pad;
    if (P.y + h > P.H - P.rodape) { P.novaPagina(); desenharCab(); fonte(); }
    if (ln.total || ln.grupo) { doc.setFillColor(...COR_FUNDO); doc.rect(P.M, P.y, P.larg, h, 'F'); }
    else if (i % 2) { doc.setFillColor(247, 249, 251); doc.rect(P.M, P.y, P.larg, h, 'F'); }
    doc.setTextColor(...(ln.grupo ? COR_PRI : ln.italico ? COR_SUAVE : COR_TEXTO));
    escrever(partes, cs, P.y);
    P.y += h;
    doc.setTextColor(...COR_TEXTO);
    doc.setDrawColor(222, 226, 230); doc.setLineWidth(0.15);
    doc.line(P.M, P.y, P.M + P.larg, P.y);
  });
  P.y += 4;
}

// Linhas "rótulo ....... valor", alinhadas à direita da página; rótulos longos quebram em mais linhas
function resumoPDF(P, itens, larg = 120) {
  const { doc } = P;
  const x0 = P.M + P.larg - larg, lh = 3.6, pad = 0.9;
  const medidas = itens.map(([rot, val, estilo]) => {
    doc.setFont('helvetica', estilo ? 'bold' : 'normal'); doc.setFontSize(8.5);
    const valor = 'R$ ' + fmtNum(val);
    const linhas = doc.splitTextToSize(rot, larg - doc.getTextWidth(valor) - 6);
    return { linhas, valor, h: linhas.length * lh + 2 * pad + (estilo === 'f' ? 0.6 : 0) };
  });
  P.espaco(Math.min(medidas.reduce((s, m) => s + m.h, 0) + 4, P.H - P.rodape - 40));
  itens.forEach(([, , estilo], i) => {
    const { linhas, valor, h } = medidas[i];
    if (P.y + h > P.H - P.rodape) P.novaPagina();
    if (estilo === 'f') { doc.setFillColor(...COR_PRI); doc.rect(x0, P.y, larg, h, 'F'); doc.setTextColor(255); }
    else if (estilo === 'b') { doc.setFillColor(...COR_FUNDO); doc.rect(x0, P.y, larg, h, 'F'); }
    else if (estilo === 'a') doc.setTextColor(179, 38, 30);
    doc.setFont('helvetica', estilo && estilo !== 'a' ? 'bold' : 'normal'); doc.setFontSize(8.5);
    linhas.forEach((l, k) => doc.text(l, x0 + 1.5, P.y + pad + k * lh + 2.8));
    doc.text(valor, x0 + larg - 1.5, P.y + pad + 2.8, { align: 'right' });
    doc.setTextColor(...COR_TEXTO);
    if (!estilo) { doc.setDrawColor(236, 239, 243); doc.setLineWidth(0.1); doc.line(x0, P.y + h, x0 + larg, P.y + h); }
    P.y += h;
  });
  P.y += 4;
}

function paragrafoPDF(P, texto, fs = 8.5, estilo = 'normal', cor = COR_TEXTO) {
  const { doc } = P;
  doc.setFont('helvetica', estilo); doc.setFontSize(fs); doc.setTextColor(...cor);
  const lh = fs * 0.3528 * 1.3;
  for (const l of doc.splitTextToSize(texto, P.larg)) {
    P.espaco(lh);
    doc.text(l, P.M, P.y + lh * 0.8);
    P.y += lh;
  }
  doc.setTextColor(...COR_TEXTO);
}

function subtituloPDF(P, texto, direita) {
  const { doc } = P;
  P.espaco(30); // não deixa o título sozinho no fim da página
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...COR_PRI);
  doc.text(texto, P.M, P.y + 4);
  if (direita) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...COR_SUAVE);
    doc.text(direita, P.M + P.larg, P.y + 4, { align: 'right' });
  }
  doc.setTextColor(...COR_TEXTO);
  P.y += 7;
}

function tituloPDF(P, titulo, linhas = []) {
  const { doc } = P;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...COR_PRI);
  doc.text(titulo, P.M, P.y + 3);
  P.y += 7.5;
  linhas.forEach(([t, fs, est, cor]) => paragrafoPDF(P, t, fs || 9.5, est || 'normal', cor || COR_TEXTO));
  P.y += 4;
}

// Rodapé com data de emissão e numeração
function rodapePDF(P) {
  const { doc } = P;
  const n = doc.getNumberOfPages();
  const agora = new Date();
  const emissao = `Emitido em ${fmtData(hoje())} às ${p2(agora.getHours())}:${p2(agora.getMinutes())}`;
  const adm = D.config.escritorio?.nome || '';
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setDrawColor(210); doc.setLineWidth(0.2);
    doc.line(P.M, P.H - 11, P.W - P.M, P.H - 11);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...COR_SUAVE);
    doc.text(emissao, P.M, P.H - 7);
    if (adm) doc.text(adm, P.W / 2, P.H - 7, { align: 'center' });
    doc.text(`Página ${i} de ${n}`, P.W - P.M, P.H - 7, { align: 'right' });
  }
}

let pdfjsPronto = null;
function carregarScript(src) {
  return new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = ok;
    s.onerror = () => falha(new Error('Não foi possível carregar o leitor de PDF.'));
    document.head.appendChild(s);
  });
}

// Aberto direto do disco (file:), o navegador não permite o "worker" do pdf.js: ele roda na própria página
function carregarPdfJs() {
  pdfjsPronto = pdfjsPronto || (async () => {
    await carregarScript('lib/pdf.min.js');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
    if (location.protocol === 'file:') await carregarScript('lib/pdf.worker.min.js');
  })().catch(e => { pdfjsPronto = null; throw e; });
  return pdfjsPronto;
}

// Salva escolhendo a pasta (Chrome/Edge no computador) ou, se não der, na pasta Downloads
async function salvarArquivo(blob, nome, tipo) {
  if (window.showSaveFilePicker) {
    try {
      const ext = nome.split('.').pop();
      const h = await window.showSaveFilePicker({
        suggestedName: nome, id: 'cc-relatorios',
        types: [{ description: ext === 'pdf' ? 'Documento PDF' : 'Planilha do Excel', accept: { [tipo]: ['.' + ext] } }],
      });
      const w = await h.createWritable();
      await w.write(blob);
      await w.close();
      aviso('Arquivo salvo: ' + h.name);
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
      console.warn('Gravação com escolha de pasta indisponível; usando Downloads.', e);
    }
  }
  baixar(blob, nome);
  aviso('Arquivo salvo na pasta de downloads: ' + nome);
}

const salvarPDF = ({ doc, nome }) => salvarArquivo(doc.output('blob'), nome, 'application/pdf');
const salvarPlanilha = (blob, nome) => salvarArquivo(blob, nome, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

// Prévia do PDF numa janela sobre a tela (funciona também no celular)
async function visualizarPDF({ doc, nome }) {
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const arquivo = new File([blob], nome, { type: 'application/pdf' });
  const compartilhar = navigator.canShare?.({ files: [arquivo] });
  abrirModal(`<div class="modal-cab"><h2>Prévia do relatório</h2><button class="bt-x" data-fechar title="Fechar">&times;</button></div>
    ${D.config.escritorio?.nome ? '' : '<p class="alerta">Os dados do escritório ainda não foram preenchidos e não aparecem no cabeçalho. Preencha em <a href="#/config" data-fechar>Configurações</a>.</p>'}
    <div class="barra-previa"><span class="dica">${esc(nome)}</span><span class="espaco"></span>
      <button class="bt primario" id="pvSalvar">Salvar PDF</button>
      ${compartilhar ? '<button class="bt" id="pvCompartilhar">Compartilhar</button>' : ''}
      <a class="bt" href="${url}" target="_blank" rel="noopener">Abrir em nova aba</a></div>
    <div class="previa" id="previa"><p class="carregando">Preparando a prévia…</p></div>`, 'modal-grande');
  $('#pvSalvar').addEventListener('click', () => executar(() => salvarArquivo(blob, nome, 'application/pdf')));
  $('#pvCompartilhar')?.addEventListener('click', () => navigator.share({ files: [arquivo], title: nome }).catch(() => {}));
  const area = $('#previa');
  try {
    await carregarPdfJs();
    const pdf = await pdfjsLib.getDocument({ data: await blob.arrayBuffer() }).promise;
    area.innerHTML = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      if (!document.body.contains(area)) return; // a janela foi fechada
      const pg = await pdf.getPage(i);
      const base = pg.getViewport({ scale: 1 });
      const escala = Math.min(2.5, (area.clientWidth - 24) / base.width * (window.devicePixelRatio || 1));
      const vp = pg.getViewport({ scale: escala });
      const cv = document.createElement('canvas');
      cv.width = vp.width; cv.height = vp.height;
      cv.className = 'pagina-pdf';
      area.appendChild(cv);
      await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    }
  } catch (e) {
    console.warn(e);
    area.innerHTML = `<iframe class="previa-pdf" src="${url}" title="Prévia do PDF"></iframe>`;
  }
}

// Compatibilidade com as chamadas antigas
const mostrarPDF = visualizarPDF;

// Botões "Visualizar" e "Salvar PDF" lado a lado
const botoesPDF = (id, rotulo = 'PDF') => `<button class="bt" id="${id}Ver">Visualizar ${rotulo}</button><button class="bt" id="${id}Salvar">Salvar ${rotulo}</button>`;
function ligarBotoesPDF(id, gerar) {
  $('#' + id + 'Ver')?.addEventListener('click', () => executar(async () => visualizarPDF(await gerar())));
  $('#' + id + 'Salvar')?.addEventListener('click', () => executar(async () => salvarPDF(await gerar())));
}
