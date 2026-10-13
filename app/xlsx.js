'use strict';
/*
  Gerador de planilhas Excel (.xlsx) sem bibliotecas externas.
  Célula: null | texto | número | { v, f (fórmula sem "="), s (estilo) }.
  Estilos: t texto, b negrito, m moeda, mt moeda/total, d data (v = 'AAAA-MM-DD'), p percentual (v = fração),
           f fator, tit título, cab cabeçalho, i inteiro, bt texto/total, it inteiro/total
*/

const XLSX_ESTILO = { t: 0, b: 1, m: 2, mt: 3, d: 4, p: 5, f: 6, tit: 7, cab: 8, i: 9, bt: 10, it: 11, tq: 12 };

const XLSX_ESTILOS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="0.000000"/><numFmt numFmtId="166" formatCode="dd/mm/yyyy"/><numFmt numFmtId="167" formatCode="0.00%"/></numFmts>
<fonts count="4"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font><font><b/><sz val="13"/><color rgb="FF1F4E79"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E79"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF0F7"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="13">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="1" fontId="1" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const xmlEsc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

function colunaXLSX(n) { let s = ''; n++; while (n) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }
const refXLSX = (lin, col) => colunaXLSX(col) + (lin + 1);
const serialData = iso => { const [a, m, d] = iso.split('-').map(Number); return (Date.UTC(a, m - 1, d) - Date.UTC(1899, 11, 30)) / 864e5; };

function celulaXLSX(cel, lin, col) {
  if (cel === null || cel === undefined || cel === '') return '';
  const o = typeof cel === 'object' ? cel : { v: cel };
  const r = refXLSX(lin, col);
  const s = XLSX_ESTILO[o.s || (typeof o.v === 'number' ? 'm' : 't')] || 0;
  let v = o.v;
  if (o.s === 'd' && typeof v === 'string' && v) v = serialData(v);
  if (o.f) return `<c r="${r}" s="${s}"><f>${xmlEsc(o.f)}</f>${typeof v === 'number' && isFinite(v) ? `<v>${v}</v>` : ''}</c>`;
  if (typeof v === 'number') return isFinite(v) ? `<c r="${r}" s="${s}"><v>${v}</v></c>` : '';
  if (v === null || v === undefined || v === '') return s ? `<c r="${r}" s="${s}"/>` : '';
  return `<c r="${r}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
}

function folhaXLSX({ linhas, larguras = [], mesclar = [], congelar, imagem }) {
  const cols = larguras.length ? `<cols>${larguras.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const dados = linhas.map((ln, i) => {
    if (!ln) return '';
    const alta = Array.isArray(ln) ? null : ln.altura;
    const cels = Array.isArray(ln) ? ln : ln.c;
    return `<row r="${i + 1}"${alta ? ` ht="${alta}" customHeight="1"` : ''}>${cels.map((c, j) => celulaXLSX(c, i, j)).join('')}</row>`;
  }).join('');
  const painel = congelar ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${congelar}" topLeftCell="A${congelar + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : '';
  const merges = mesclar.length ? `<mergeCells count="${mesclar.length}">${mesclar.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>${painel}${cols}<sheetData>${dados}</sheetData>${merges}<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>${imagem ? '<drawing r:id="rId1"/>' : ''}</worksheet>`;
}

// folhas: [{ nome, linhas, larguras, mesclar, congelar }]
function gerarXLSX(folhas) {
  const nomes = folhas.map((f, i) => (f.nome || 'Planilha' + (i + 1)).replace(/[\[\]:*?/\\]/g, ' ').slice(0, 31));
  const arquivos = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${folhas.map((f, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${nomes.map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${folhas.map((f, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${folhas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': XLSX_ESTILOS_XML,
  };
  folhas.forEach((f, i) => { arquivos[`xl/worksheets/sheet${i + 1}.xml`] = folhaXLSX(f); });
  // Imagens (logotipo): uma por folha, no canto superior esquerdo
  const extras = [];
  folhas.forEach((f, i) => {
    const img = f.imagem && imagemDeDataURL(f.imagem.dados);
    if (!img) { if (f.imagem) arquivos[`xl/worksheets/sheet${i + 1}.xml`] = folhaXLSX({ ...f, imagem: null }); return; }
    const n = i + 1, emu = px => Math.round(px * 9525);
    arquivos[`xl/media/imagem${n}.${img.ext}`] = img.bytes;
    arquivos[`xl/worksheets/_rels/sheet${n}.xml.rels`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${n}.xml"/></Relationships>`;
    arquivos[`xl/drawings/_rels/drawing${n}.xml.rels`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/imagem${n}.${img.ext}"/></Relationships>`;
    arquivos[`xl/drawings/drawing${n}.xml`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>${emu(4)}</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>${emu(4)}</xdr:rowOff></xdr:from><xdr:ext cx="${emu(f.imagem.w)}" cy="${emu(f.imagem.h)}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${n + 1}" name="Logotipo"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(f.imagem.w)}" cy="${emu(f.imagem.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`;
    extras.push(`<Override PartName="/xl/drawings/drawing${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
  });
  if (extras.length) arquivos['[Content_Types].xml'] = arquivos['[Content_Types].xml'].replace('<Default Extension="xml"',
    '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="xml"').replace('</Types>', extras.join('') + '</Types>');
  return zipar(arquivos, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

/* ---------- ZIP (sem compressão) ---------- */
const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = TABELA_CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function zipar(arquivos, tipo) {
  const enc = new TextEncoder();
  const agora = new Date();
  const hora = (agora.getHours() << 11) | (agora.getMinutes() << 5) | (agora.getSeconds() >> 1);
  const data = ((agora.getFullYear() - 1980) << 9) | ((agora.getMonth() + 1) << 5) | agora.getDate();
  const partes = [], central = [];
  let pos = 0, tamCentral = 0;
  for (const [nomeArq, conteudo] of Object.entries(arquivos)) {
    const nome = enc.encode(nomeArq), dados = typeof conteudo === 'string' ? enc.encode(conteudo) : conteudo;
    const crc = crc32(dados), n = dados.length;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, hora, true); h.setUint16(12, data, true); h.setUint32(14, crc, true);
    h.setUint32(18, n, true); h.setUint32(22, n, true); h.setUint16(26, nome.length, true); h.setUint16(28, 0, true);
    partes.push(new Uint8Array(h.buffer), nome, dados);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, hora, true); c.setUint16(14, data, true); c.setUint32(16, crc, true); c.setUint32(20, n, true); c.setUint32(24, n, true);
    c.setUint16(28, nome.length, true); c.setUint16(30, 0, true); c.setUint16(32, 0, true); c.setUint16(34, 0, true); c.setUint16(36, 0, true);
    c.setUint32(38, 0, true); c.setUint32(42, pos, true);
    central.push(new Uint8Array(c.buffer), nome);
    pos += 30 + nome.length + n;
    tamCentral += 46 + nome.length;
  }
  const qtd = Object.keys(arquivos).length;
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true); fim.setUint16(4, 0, true); fim.setUint16(6, 0, true);
  fim.setUint16(8, qtd, true); fim.setUint16(10, qtd, true); fim.setUint32(12, tamCentral, true); fim.setUint32(16, pos, true); fim.setUint16(20, 0, true);
  return new Blob([...partes, ...central, new Uint8Array(fim.buffer)], { type: tipo });
}

/* ================= Leitura de planilhas (.xlsx e .csv) ================= */
async function descompactar(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Lê os arquivos de um .zip (o .xlsx é um zip): devolve { nome: Uint8Array } (só os pedidos por "filtro")
async function lerZip(buf, filtro = () => true) {
  const b = new Uint8Array(buf), v = new DataView(buf);
  let fim = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { fim = i; break; }
  if (fim < 0) throw new Error('Arquivo inválido: não é uma planilha .xlsx. Planilhas antigas (.xls) precisam ser salvas antes como .xlsx no Excel (Arquivo > Salvar como).');
  const qtd = v.getUint16(fim + 10, true);
  let p = v.getUint32(fim + 16, true);
  const dec = new TextDecoder(), saida = {};
  for (let k = 0; k < qtd; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const metodo = v.getUint16(p + 10, true), tamC = v.getUint32(p + 20, true);
    const nl = v.getUint16(p + 28, true), el = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true);
    const off = v.getUint32(p + 42, true);
    const nome = dec.decode(b.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + el + cl;
    if (!filtro(nome)) continue;
    const ini = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
    const dados = b.subarray(ini, ini + tamC);
    saida[nome] = metodo === 0 ? dados : metodo === 8 ? await descompactar(dados) : null;
  }
  return saida;
}

const xmlDe = bytes => new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
const textoNo = n => [...n.getElementsByTagName('t')].filter(t => t.parentNode.nodeName !== 'rPh').map(t => t.textContent).join('');
function colunaNum(ref) { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; }
const isoDeSerial = s => { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(s * 864e5)); return d.toISOString().slice(0, 10); };

// Devolve { folhas: [{ nome, linhas: [[célula]] }] }; datas vêm como 'AAAA-MM-DD', números como number
async function lerPlanilha(arquivo) {
  const nomeArq = arquivo.name.toLowerCase();
  if (nomeArq.endsWith('.csv') || nomeArq.endsWith('.txt')) return { folhas: [{ nome: arquivo.name, linhas: lerCSV(await arquivo.text()) }] };
  if (nomeArq.endsWith('.pdf')) return { folhas: [{ nome: arquivo.name, linhas: await lerPDFTabela(arquivo) }] };
  if (nomeArq.endsWith('.xls')) throw new Error('Planilhas no formato antigo (.xls) precisam ser salvas antes como .xlsx no Excel (Arquivo > Salvar como > Pasta de Trabalho do Excel).');
  const z = await lerZip(await arquivo.arrayBuffer(), n => n.startsWith('xl/') && n.endsWith('.xml') || n.endsWith('.rels'));
  if (!z['xl/workbook.xml']) throw new Error('Não foi possível ler a planilha (formato não reconhecido).');
  const wb = xmlDe(z['xl/workbook.xml']);
  const rels = {};
  if (z['xl/_rels/workbook.xml.rels']) for (const r of xmlDe(z['xl/_rels/workbook.xml.rels']).getElementsByTagName('Relationship')) rels[r.getAttribute('Id')] = r.getAttribute('Target');
  const compart = z['xl/sharedStrings.xml'] ? [...xmlDe(z['xl/sharedStrings.xml']).getElementsByTagName('si')].map(textoNo) : [];
  // Estilos com formato de data
  const ehDataFmt = new Set();
  if (z['xl/styles.xml']) {
    const st = xmlDe(z['xl/styles.xml']), custom = {};
    for (const f of st.getElementsByTagName('numFmt')) custom[f.getAttribute('numFmtId')] = f.getAttribute('formatCode');
    const xfs = st.getElementsByTagName('cellXfs')[0];
    if (xfs) [...xfs.getElementsByTagName('xf')].forEach((xf, i) => {
      const id = +xf.getAttribute('numFmtId');
      const cod = (custom[id] || '').replace(/"[^"]*"|\[[^\]]*\]|\./g, '');
      if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || /[dy]/i.test(cod) || /m{1,4}.*[dy]|[dy].*m/i.test(cod)) ehDataFmt.add(i);
    });
  }
  const folhas = [];
  for (const sh of wb.getElementsByTagName('sheet')) {
    const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let alvo = rels[rid] || '';
    alvo = alvo.startsWith('/') ? alvo.slice(1) : 'xl/' + alvo.replace(/^\.\//, '');
    if (!z[alvo]) continue;
    const linhas = [];
    for (const row of xmlDe(z[alvo]).getElementsByTagName('row')) {
      const ri = +row.getAttribute('r') - 1;
      const lin = linhas[ri] = [];
      for (const c of row.getElementsByTagName('c')) {
        const t = c.getAttribute('t'), s = +c.getAttribute('s') || 0;
        const vNo = c.getElementsByTagName('v')[0], v = vNo ? vNo.textContent : null;
        let val = null;
        if (t === 's') val = compart[+v] ?? '';
        else if (t === 'inlineStr') val = textoNo(c);
        else if (t === 'str' || t === 'e') val = v ?? '';
        else if (t === 'b') val = v === '1' ? 'VERDADEIRO' : 'FALSO';
        else if (v !== null && v !== '') { val = Number(v); if (ehDataFmt.has(s) && val > 0 && val < 2958466) val = isoDeSerial(val); }
        lin[colunaNum(c.getAttribute('r'))] = val;
      }
    }
    for (let i = 0; i < linhas.length; i++) linhas[i] = linhas[i] || [];
    folhas.push({ nome: sh.getAttribute('name'), linhas });
  }
  return { folhas };
}

function lerCSV(texto) {
  const prim = texto.split(/\r?\n/, 1)[0];
  const sep = ['\t', ';', ','].map(s => [s, prim.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const linhas = [];
  let lin = [], campo = '', aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) { lin.push(campo); campo = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++;
      lin.push(campo); linhas.push(lin); lin = []; campo = '';
    } else campo += ch;
  }
  if (campo || lin.length) { lin.push(campo); linhas.push(lin); }
  return linhas;
}

/*
  PDF com texto (gerado por sistema, não escaneado): reconstrói a tabela pela posição do texto.
  1) junta os pedaços de texto em linhas (mesma altura na página);
  2) junta os pedaços próximos de uma linha em células;
  3) define as colunas pelas faixas horizontais ocupadas pelas células das linhas com números ou datas;
  4) encaixa cada célula na coluna com que mais se sobrepõe.
*/
async function lerPDFTabela(arquivo) {
  await carregarPdfJs();
  let pdf;
  try { pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await arquivo.arrayBuffer()) }).promise; }
  catch (e) { throw new Error('Não foi possível abrir o PDF' + (e?.name === 'PasswordException' ? ' (protegido por senha).' : '.')); }
  const linhas = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const pg = await pdf.getPage(n);
    const tc = await pg.getTextContent({ disableCombineTextItems: true });
    const largPag = pg.getViewport({ scale: 1 }).width;
    const itens = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const h = Math.abs(it.transform[3]) || it.height || 8;
      const x = it.transform[4], y = it.transform[5], w = it.width || it.str.length * h * 0.5;
      // Texto com espaços largos dentro do mesmo pedaço: separa, estimando a posição pelo nº de caracteres
      const partes = it.str.split(/(\s{3,})/);
      let pos = 0;
      for (const p of partes) {
        const ini = x + w * pos / it.str.length;
        pos += p.length;
        if (p.trim()) itens.push({ x: ini, x1: x + w * pos / it.str.length, y, h, s: p.trim() });
      }
    }
    itens.sort((a, b) => b.y - a.y || a.x - b.x);
    const grupos = [];
    for (const it of itens) {
      const g = grupos[grupos.length - 1];
      if (g && Math.abs(g.y - it.y) <= Math.max(2, it.h * 0.45)) g.itens.push(it); else grupos.push({ y: it.y, itens: [it] });
    }
    for (const g of grupos) {
      g.itens.sort((a, b) => a.x - b.x);
      const cels = [];
      for (const it of g.itens) {
        const c = cels[cels.length - 1];
        const vao = c ? it.x - c.x1 : Infinity;
        if (c && vao <= Math.max(1.5, it.h * 0.6)) { c.s += (vao > it.h * 0.12 ? ' ' : '') + it.s; c.x1 = Math.max(c.x1, it.x1); }
        else cels.push({ x0: it.x, x1: it.x1, s: it.s });
      }
      cels.forEach(c => { c.largo = c.x1 - c.x0 > largPag * 0.3 || c.s.length > 45; });
      linhas.push(cels);
    }
  }
  if (!linhas.length) throw new Error('Este PDF não tem texto (provavelmente foi escaneado como imagem). Não é possível importar: peça o arquivo original ou em Excel.');

  // Faixas das colunas. Linhas de dados: 2+ células só com número, valor ou data.
  // As faixas vêm dessas células numéricas; depois as células de texto dessas linhas que não caem
  // em nenhuma faixa formam colunas próprias (descrição, rubrica…).
  const soNumero = s => /^[R$\s]*-?[\d.,/%-]+$/.test(s.trim()) && /\d/.test(s);
  const dados = linhas.filter(l => l.filter(c => soNumero(c.s)).length >= 2);
  const juntar = (cels, faixas) => {
    for (const c of [...cels].sort((a, b) => a.x0 - b.x0)) {
      const f = faixas.find(f => c.x0 < f.x1 - 0.5 && c.x1 > f.x0 + 0.5);
      if (f) { f.x0 = Math.min(f.x0, c.x0); f.x1 = Math.max(f.x1, c.x1); } else faixas.push({ x0: c.x0, x1: c.x1 });
    }
    return faixas;
  };
  let faixas = juntar(dados.flat().filter(c => soNumero(c.s)), []);
  const sobrepoe = c => faixas.some(f => c.x0 < f.x1 && c.x1 > f.x0);
  faixas = juntar(dados.flat().filter(c => !soNumero(c.s) && !c.largo && !sobrepoe(c)), faixas).sort((a, b) => a.x0 - b.x0);
  if (!faixas.length) return linhas.map(l => l.map(c => c.s));
  const coluna = c => {
    let melhor = 0, sobre = -Infinity;
    faixas.forEach((f, j) => {
      const s = Math.min(c.x1, f.x1) - Math.max(c.x0, f.x0); // sobreposição (negativa = distância)
      if (s > sobre) { sobre = s; melhor = j; }
    });
    return melhor;
  };
  return linhas.map(l => {
    const r = [];
    for (const c of l) { const j = coluna(c); r[j] = r[j] ? r[j] + ' ' + c.s : c.s; }
    for (let j = 0; j < r.length; j++) if (r[j] === undefined) r[j] = null;
    return r;
  });
}

// "data:image/png;base64,..." → { ext, bytes } (somente PNG e JPEG)
function imagemDeDataURL(url) {
  const m = /^data:image\/(png|jpe?g);base64,(.*)$/i.exec(url || '');
  if (!m) return null;
  const bin = atob(m[2]), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { ext: m[1].toLowerCase() === 'png' ? 'png' : 'jpeg', bytes };
}
