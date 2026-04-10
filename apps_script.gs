// ============================================================
// Studio FC — Apps Script
// Estrutura da planilha:
//
// Aba DADOS:
//   A1: Cliente    B1: ESSENTIAL 53    D1: (label "data inicial")
//   A2: M²         B2: 153             C2: m²
//   A3: Previsão   B3: 90              C3: dias    D3: 01/03/2026
//
// Aba RESUMO (tabela dinâmica):
//   A: fonte (categoria)  B: Loja  C: SUM de debito  D: SUM de devedor
//   Última linha: "Total geral"
//
// Aba PREVISÃO:
//   A: ORIGEM (categoria)  B: PREVISÃO
//   Última linha: "TOTAL"
// ============================================================

var PASTA_RAIZ_ID = '1yUfuFKPOHCmG9UCwwPajYfpJu8nCRdkl';

function doGet(e) {
  var resultado = {};
  try {
    resultado.config      = lerDados();
    resultado.categorias  = lerCategorias();
    resultado.totalGeral  = resultado.config._totalGeral  || 0;
    resultado.totalPrevisto = resultado.config._totalPrevisto || 0;
    resultado.config.saldoDevedor = resultado.config._saldoDevedor || 0;
    // limpa campos internos
    delete resultado.config._totalGeral;
    delete resultado.config._totalPrevisto;
    delete resultado.config._saldoDevedor;
    resultado.config.projetos     = listarPDFs();
    resultado.config.perspectivas = listarImagens();
  } catch(err) {
    resultado.erro = err.message + ' | ' + err.stack;
  }
  return ContentService
    .createTextOutput(JSON.stringify(resultado))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── ABA DADOS ─────────────────────────────────────────────────
// Linha 1: Cliente | ESSENTIAL 53 | | data inicial (label)
// Linha 2: M²      | 153          | m²
// Linha 3: Previsão| 90           | dias | 01/03/2026
function lerDados() {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName('DADOS') || ss.getSheetByName('Dados') || ss.getSheetByName('dados');
  if (!aba) throw new Error('Aba DADOS não encontrada');

  var d = aba.getDataRange().getValues();

  var config = {};

  // Linha 1: col B = nome do cliente, col D = label (ignora)
  config.nome = String(d[0][1] || '').trim();

  // Linha 2: col B = área m²
  config.area = parseNum(d[1][1]);

  // Linha 3: col B = prazo em dias, col D = data inicial
  config.prazoDias  = parseNum(d[2][1]);
  config.dataInicio = formatarData(d[2][3]);

  // Calcula data fim = dataInicio + prazoDias corridos
  if (config.dataInicio && config.prazoDias) {
    config.dataFim = calcularDataFim(config.dataInicio, config.prazoDias);
  }

  // Dias úteis corridos desde o início
  if (config.dataInicio) {
    config.diasPassados = calcularDiasUteis(config.dataInicio);
  }

  // Lê totais do RESUMO
  var resumo = lerResumoTotais();
  config._totalGeral    = resumo.totalGeral;
  config._saldoDevedor  = resumo.totalDevedor;

  // Lê total previsto do PREVISÃO
  config._totalPrevisto = lerTotalPrevisto();
  config.orcamento      = config._totalPrevisto;

  return config;
}

// ── ABA RESUMO — extrai débito e devedor por categoria + totais ──
function lerResumoTotais() {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName('RESUMO') || ss.getSheetByName('Resumo');
  if (!aba) return { totalGeral: 0, totalDevedor: 0 };

  var d = aba.getDataRange().getValues();
  var totalGeral   = 0;
  var totalDevedor = 0;

  for (var i = 1; i < d.length; i++) {
    var label = String(d[i][0]).trim().toLowerCase();
    if (label === 'total geral') {
      totalGeral   = parseNum(d[i][2]);
      totalDevedor = parseNum(d[i][3]);
      break;
    }
  }
  return { totalGeral: totalGeral, totalDevedor: totalDevedor };
}

// ── ABA RESUMO — categorias com débito ──────────────────────────
// ── ABA PREVISÃO — previsto por categoria ───────────────────────
function lerCategorias() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Lê débitos do RESUMO (col A=categoria, col C=debito, col D=devedor)
  var abaR = ss.getSheetByName('RESUMO') || ss.getSheetByName('Resumo');
  var debitos = {};
  if (abaR) {
    var dr = abaR.getDataRange().getValues();
    for (var i = 1; i < dr.length; i++) {
      var cat   = String(dr[i][0]).trim().toUpperCase();
      var deb   = parseNum(dr[i][2]);
      var label = cat.toLowerCase();
      if (!cat || label === 'total geral' || label === '' || label === '-') continue;
      // agrupa por categoria (ignora a loja / fornecedor)
      if (!debitos[cat]) debitos[cat] = 0;
      debitos[cat] += deb;
    }
  }

  // Lê previsão do PREVISÃO (col A=origem, col B=previsão)
  var abaP = ss.getSheetByName('PREVISÃO') || ss.getSheetByName('PREVISAO') || ss.getSheetByName('Previsão');
  var previstos = {};
  if (abaP) {
    var dp = abaP.getDataRange().getValues();
    for (var j = 1; j < dp.length; j++) {
      var catP  = String(dp[j][0]).trim().toUpperCase();
      var prev  = parseNum(dp[j][1]);
      var labelP = catP.toLowerCase();
      if (!catP || labelP === 'total' || labelP === '') continue;
      previstos[catP] = prev;
    }
  }

  // Junta todas as categorias únicas
  var todasCats = {};
  Object.keys(debitos).forEach(function(c) { todasCats[c] = true; });
  Object.keys(previstos).forEach(function(c) { todasCats[c] = true; });

  var lista = Object.keys(todasCats).map(function(cat) {
    return {
      categoria: cat,
      debito:    debitos[cat]   || 0,
      previsto:  previstos[cat] || 0
    };
  });

  return lista.sort(function(a, b) { return a.categoria.localeCompare(b.categoria); });
}

function lerTotalPrevisto() {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName('PREVISÃO') || ss.getSheetByName('PREVISAO') || ss.getSheetByName('Previsão');
  if (!aba) return 0;
  var d = aba.getDataRange().getValues();
  for (var i = d.length - 1; i >= 0; i--) {
    var label = String(d[i][0]).trim().toLowerCase();
    if (label === 'total') return parseNum(d[i][1]);
  }
  return 0;
}

// ── PASTA PERSPECTIVAS: PASTA_RAIZ_ID aponta direto para ela ──
// ── PASTA PROJETOS: é o pai da PERSPECTIVAS ───────────────────
function getPastaPerspectivas() {
  return DriveApp.getFolderById(PASTA_RAIZ_ID);
}

function getPastaProjetos() {
  var perspectivas = getPastaPerspectivas();
  var pais = perspectivas.getParents();
  if (pais.hasNext()) return pais.next();
  return null;
}

// ── LISTAR PDFs — percorre subpastas de PROJETOS (exceto PERSPECTIVAS) ──
function listarPDFs() {
  var projetos = getPastaProjetos();
  if (!projetos) return [];

  var lista = [];

  var subpastas = projetos.getFolders();
  while (subpastas.hasNext()) {
    var sub = subpastas.next();
    // pula PERSPECTIVAS pelo ID (mais confiável que nome)
    if (sub.getId() === PASTA_RAIZ_ID) continue;

    var nomeSub = sub.getName().toUpperCase();
    var arquivos = sub.getFilesByType(MimeType.PDF);
    while (arquivos.hasNext()) {
      var arq = arquivos.next();
      lista.push({
        nome: nomeSub + ' — ' + arq.getName().replace(/\.pdf$/i, ''),
        url:  'https://drive.google.com/file/d/' + arq.getId() + '/view'
      });
    }
  }

  // PDFs soltos direto em PROJETOS
  var diretos = projetos.getFilesByType(MimeType.PDF);
  while (diretos.hasNext()) {
    var arq2 = diretos.next();
    lista.push({
      nome: arq2.getName().replace(/\.pdf$/i, ''),
      url:  'https://drive.google.com/file/d/' + arq2.getId() + '/view'
    });
  }

  return lista.sort(function(a, b) { return a.nome.localeCompare(b.nome); });
}

// ── LISTAR IMAGENS — usa PASTA_RAIZ_ID (= PERSPECTIVAS) + subpastas ──
function listarImagens() {
  var perspectivas = getPastaPerspectivas();
  var tipos = ['image/jpeg', 'image/png', 'image/webp'];
  var lista = [];

  // Imagens direto em PERSPECTIVAS
  coletarImagens(perspectivas, tipos, lista);

  // Imagens em subpastas (ex: FASE 2)
  var subs = perspectivas.getFolders();
  while (subs.hasNext()) {
    coletarImagens(subs.next(), tipos, lista);
  }

  return lista;
}

function coletarImagens(pasta, tipos, lista) {
  for (var t = 0; t < tipos.length; t++) {
    var imgs = pasta.getFilesByType(tipos[t]);
    while (imgs.hasNext()) {
      var img = imgs.next();
      lista.push('https://drive.google.com/thumbnail?id=' + img.getId() + '&sz=w1920');
    }
  }
}

// ── DEBUG — rode manualmente no editor para ver a estrutura ───
function debugDrive() {
  var perspectivas = getPastaPerspectivas();
  Logger.log('PERSPECTIVAS: ' + perspectivas.getName() + ' id=' + perspectivas.getId());

  var subs = perspectivas.getFolders();
  while (subs.hasNext()) {
    var s = subs.next();
    Logger.log('  Subpasta em PERSPECTIVAS: [' + s.getName() + ']');
  }

  var projetos = getPastaProjetos();
  if (!projetos) { Logger.log('Pai (PROJETOS) não encontrado!'); return; }
  Logger.log('Pasta pai (PROJETOS): ' + projetos.getName());

  var subs2 = projetos.getFolders();
  while (subs2.hasNext()) {
    var s2 = subs2.next();
    Logger.log('  Sub em PROJETOS: [' + s2.getName() + ']');
    var pdfs = s2.getFilesByType(MimeType.PDF);
    var count = 0;
    while (pdfs.hasNext()) { pdfs.next(); count++; }
    Logger.log('    PDFs: ' + count);
  }
}

// ── HELPERS ───────────────────────────────────────────────────
function parseNum(val) {
  if (typeof val === 'number') return val;
  var s = String(val).replace(/[R$\s.]/g, '').replace(',', '.');
  return parseFloat(s) || 0;
}

function formatarData(val) {
  if (!val) return '';
  try {
    var d = new Date(val);
    if (isNaN(d.getTime())) return String(val);
    return ('0' + d.getDate()).slice(-2) + '/' +
           ('0' + (d.getMonth() + 1)).slice(-2) + '/' +
           d.getFullYear();
  } catch(e) { return String(val); }
}

function calcularDataFim(dataInicioStr, prazoDias) {
  try {
    var p = dataInicioStr.split('/');
    var d = new Date(p[2], p[1]-1, p[0]);
    d.setDate(d.getDate() + Number(prazoDias));
    return ('0' + d.getDate()).slice(-2) + '/' +
           ('0' + (d.getMonth()+1)).slice(-2) + '/' +
           d.getFullYear();
  } catch(e) { return ''; }
}

function calcularDiasUteis(dataInicioStr) {
  try {
    var p     = dataInicioStr.split('/');
    var inicio = new Date(p[2], p[1]-1, p[0]);
    var hoje  = new Date();
    var dias  = 0;
    var cur   = new Date(inicio);
    while (cur <= hoje) {
      var dow = cur.getDay();
      if (dow !== 0 && dow !== 6) dias++;
      cur.setDate(cur.getDate() + 1);
    }
    return dias;
  } catch(e) { return 0; }
}
