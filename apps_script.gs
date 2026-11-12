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
// Aba de CONTA CORRENTE (qualquer nome; achada pelo cabeçalho):
//   data | origem | entrada (crédito) | saída (débito) | saldo (opcional)
//
// Aba PREVISÃO:
//   A: ORIGEM (categoria)  B: PREVISÃO
//   Última linha: "TOTAL"
// ============================================================

var PASTA_RAIZ_ID = '1yUfuFKPOHCmG9UCwwPajYfpJu8nCRdkl';

// A chave é opcional. Sem a propriedade API_SHARED_SECRET o script responde
// como sempre respondeu (GET ou POST, sem chave). Com ela definida em
// Configurações do projeto → Propriedades do script, só POST com a chave
// certa recebe dados — ver SECURITY-DEPLOY.md.
function negarAcesso() {
  return ContentService.createTextOutput(JSON.stringify({erro: 'Acesso não autorizado'})).setMimeType(ContentService.MimeType.JSON);
}
function doGet(e) {
  var secret = PropertiesService.getScriptProperties().getProperty('API_SHARED_SECRET');
  if (secret) return negarAcesso();
  return obterDados(!!(e && e.parameter && e.parameter.refresh === '1'));
}
function doPost(e) {
  var secret = PropertiesService.getScriptProperties().getProperty('API_SHARED_SECRET');
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (_) { body = {}; }
  if (secret && (!body || body.key !== secret)) return negarAcesso();
  return obterDados(!!body && body.refresh === true);
}
var _sheetRows = {};
function linhasDaAba(aba) {
  var key = aba.getSheetId();
  if (!_sheetRows[key]) _sheetRows[key] = aba.getDataRange().getValues();
  return _sheetRows[key];
}
function obterDados(refresh) {
  _sheetRows = {};
  var cache = CacheService.getScriptCache();
  var cacheKey = 'dashboard-v3-' + PASTA_RAIZ_ID;
  if (!refresh) {
    var saved = cache.get(cacheKey);
    if (saved) return ContentService.createTextOutput(saved).setMimeType(ContentService.MimeType.JSON);
  }
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
    var crono = lerCronograma();
    resultado.cronograma          = crono.lista;
    resultado.totalCronograma     = crono.total;
    // Extrato e devedores são complementares: se falharem, o resto do
    // painel continua de pé e o front simplesmente esconde os cards.
    try { resultado.contaCorrente = lerContaCorrente(); } catch (e1) { console.error(e1); }
    try { resultado.devedores     = lerDevedores(); }     catch (e2) { console.error(e2); }
  } catch(err) {
    console.error(err);
    resultado.erro = 'Dados temporariamente indisponíveis';
  }
  var json = JSON.stringify(resultado);
  if (!resultado.erro && Utilities.newBlob(json).getBytes().length < 95000) {
    try { cache.put(cacheKey, json, 120); } catch (_) { /* cache is optional */ }
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// ── ABA DADOS ─────────────────────────────────────────────────
// Linha 1: Cliente  | ESSENTIAL 53 | | data inicial (label)
// Linha 2: M²       | 153          | m²
// Linha 3: Previsão | 90           | dias | 01/03/2026
// Linha 4: Concluído| 65           | %  ← informado à mão, manda no dashboard
function lerDados() {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName('DADOS') || ss.getSheetByName('Dados') || ss.getSheetByName('dados');
  if (!aba) throw new Error('Aba DADOS não encontrada');

  var d = linhasDaAba(aba);

  var config = {};

  // Linha 1: col B = nome do cliente, col D = label (ignora)
  config.nome = String(d[0][1] || '').trim();

  // Linha 2: col B = área m²
  config.area = parseNum(d[1][1]);

  // Linha 3: col B = prazo em dias, col D = data inicial
  config.prazoDias  = parseNum(d[2][1]);
  config.dataInicio = formatarData(d[2][3]);

  // Linha 4: col B = % concluído. Quando preenchida, é ela que vale no
  // dashboard; vazia, o front volta a calcular pela média do cronograma.
  var pct = lerPctConcluido(aba, d);
  if (pct !== null) config.pctConcluido = pct;

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

// ── DADOS B4 — % concluído informado à mão ──────────────────────
// Devolve null quando a célula está vazia, para o front cair no
// cálculo antigo em planilhas que ainda não têm essa linha.
function lerPctConcluido(aba, d) {
  if (d.length < 4) return null;

  var bruto = d[3][1];
  if (bruto === null || typeof bruto === 'undefined' || String(bruto).trim() === '') {
    return null;
  }

  var v = parseNum(bruto);

  // Célula formatada como porcentagem guarda 0,65 e não 65. O formato
  // da célula desfaz a ambiguidade sem precisar adivinhar pelo valor.
  if (aba.getRange(4, 2).getNumberFormat().indexOf('%') !== -1) {
    v = v * 100;
  }

  if (v < 0)   v = 0;
  if (v > 100) v = 100;
  return v;
}

// ── ABA RESUMO — extrai débito e devedor por categoria + totais ──
function lerResumoTotais() {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName('RESUMO') || ss.getSheetByName('Resumo');
  if (!aba) return { totalGeral: 0, totalDevedor: 0 };

  var d = linhasDaAba(aba);
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
    var dr = linhasDaAba(abaR);
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
    var dp = linhasDaAba(abaP);
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

// ── CONTA CORRENTE — extrato estilo banco ───────────────────────
// A aba é localizada pelo cabeçalho, não pelo nome: precisa ter uma
// coluna de data e uma de saída/débito. Nomes aceitos por coluna:
//   data    → "data..."
//   origem  → origem | fonte | histórico | descrição | loja | fornecedor
//   entrada → entrada | crédito | aporte | depósito | recebido | pagamento | pago
//   saída   → saída | débito | despesa
//   saldo   → saldo (opcional; sem ela o saldo é acumulado aqui)
// Abas com "conta", "corrente", "extrato" ou "caixa" no nome têm prioridade.
var CC_MAX_LINHAS = 200;

function normTxt(v) {
  return String(v === null || typeof v === 'undefined' ? '' : v)
    .trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function acharColuna(cab, padroes) {
  for (var p = 0; p < padroes.length; p++) {
    for (var c = 0; c < cab.length; c++) {
      if (cab[c].indexOf(padroes[p]) === 0) return c;
    }
  }
  return -1;
}

function acharCabecalhoCC(d) {
  var limite = Math.min(d.length, 10);
  for (var i = 0; i < limite; i++) {
    var cab = d[i].map(normTxt);
    var col = {
      linha:   i,
      data:    acharColuna(cab, ['data']),
      origem:  acharColuna(cab, ['origem', 'fonte', 'historico', 'descricao', 'loja', 'fornecedor']),
      entrada: acharColuna(cab, ['entrada', 'credito', 'aporte', 'deposito', 'recebido', 'pagamento', 'pago']),
      saida:   acharColuna(cab, ['saida', 'debito', 'despesa']),
      saldo:   acharColuna(cab, ['saldo'])
    };
    if (col.data >= 0 && col.saida >= 0) return col;
  }
  return null;
}

function acharAbaContaCorrente() {
  var abas = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  var melhor = null;
  for (var a = 0; a < abas.length; a++) {
    var d = linhasDaAba(abas[a]);
    var col = acharCabecalhoCC(d);
    if (!col) continue;
    var pontos = (/conta|corrente|extrato|caixa/.test(normTxt(abas[a].getName())) ? 10 : 0) +
                 (col.entrada >= 0 ? 2 : 0) + (col.saldo >= 0 ? 1 : 0);
    if (!melhor || pontos > melhor.pontos) melhor = { aba: abas[a], d: d, col: col, pontos: pontos };
  }
  return melhor;
}

function lerContaCorrente() {
  var achada = acharAbaContaCorrente();
  if (!achada) return null;

  var d = achada.d, col = achada.col;
  var linhas = [];
  var saldo = 0, totalEntrada = 0, totalSaida = 0;

  for (var i = col.linha + 1; i < d.length; i++) {
    var r = d[i];
    var origem  = col.origem  >= 0 ? String(r[col.origem] || '').trim() : '';
    var entrada = col.entrada >= 0 ? parseNum(r[col.entrada]) : 0;
    var saida   = Math.abs(parseNum(r[col.saida]));
    var rotulo  = normTxt(origem) || normTxt(r[col.data]);

    if (rotulo.indexOf('total') === 0) continue;       // linha de totais da planilha
    if (!r[col.data] && !entrada && !saida) continue;  // linha vazia

    var saldoPlanilha = col.saldo >= 0 ? r[col.saldo] : '';
    if (saldoPlanilha !== '' && saldoPlanilha !== null) saldo = parseNum(saldoPlanilha);
    else saldo += entrada - saida;

    totalEntrada += entrada;
    totalSaida   += saida;
    linhas.push({
      // Texto "dd/mm/aaaa" passa direto: new Date() leria como mm/dd.
      data:    (Object.prototype.toString.call(r[col.data]) === '[object Date]') ? formatarData(r[col.data]) : String(r[col.data] || '').trim(),
      origem:  origem,
      entrada: Math.round(entrada * 100) / 100,
      saida:   Math.round(saida * 100) / 100,
      saldo:   Math.round(saldo * 100) / 100
    });
  }

  return {
    aba:          achada.aba.getName(),
    totalLinhas:  linhas.length,
    totalEntrada: Math.round(totalEntrada * 100) / 100,
    totalSaida:   Math.round(totalSaida * 100) / 100,
    saldo:        Math.round(saldo * 100) / 100,
    linhas:       linhas.slice(-CC_MAX_LINHAS)   // só as mais recentes
  };
}

// ── DEVEDORES — RESUMO col A=fonte, B=loja, D=devedor ───────────
// Tabela dinâmica pode deixar a fonte em branco nas linhas repetidas,
// então a última fonte vista vale para as lojas logo abaixo.
function lerDevedores() {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName('RESUMO') || ss.getSheetByName('Resumo');
  if (!aba) return [];

  var d = linhasDaAba(aba);
  var lista = [];
  var fonteAtual = '';

  for (var i = 1; i < d.length; i++) {
    var fonte = String(d[i][0] || '').trim();
    var loja  = String(d[i][1] || '').trim();
    var rot   = normTxt(fonte);
    if (rot === 'total geral') break;
    if (/ total$/.test(rot)) continue;   // subtotal da tabela dinâmica
    if (fonte) fonteAtual = fonte;

    var valor = parseNum(d[i][3]);
    if (!valor) continue;
    lista.push({ fonte: fonteAtual, loja: loja, valor: Math.round(valor * 100) / 100 });
  }
  return lista.sort(function(a, b) { return b.valor - a.valor; });
}

// ── DEBUG — rode no editor para conferir qual aba virou extrato ──
function debugContaCorrente() {
  var cc = lerContaCorrente();
  if (!cc) { Logger.log('Nenhuma aba com colunas de data + saída/débito encontrada.'); return; }
  Logger.log('Aba: ' + cc.aba + ' | linhas: ' + cc.totalLinhas + ' | saldo: ' + cc.saldo);
  Logger.log(JSON.stringify(cc.linhas.slice(-5)));
  Logger.log('Devedores: ' + JSON.stringify(lerDevedores()));
}

function lerTotalPrevisto() {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName('PREVISÃO') || ss.getSheetByName('PREVISAO') || ss.getSheetByName('Previsão');
  if (!aba) return 0;
  var d = linhasDaAba(aba);
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
      lista.push('https://lh3.googleusercontent.com/d/' + img.getId());
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

// ── ABA CRONOGRAMA — categoria (col A) + % (col E) ────────────
// Retorna { lista, total } — total vem da linha TOTAL (col E)
function lerCronograma() {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName('CRONOGRAMA') || ss.getSheetByName('Cronograma');
  if (!aba) return { lista: [], total: 0 };
  var d = linhasDaAba(aba);
  var lista = [];
  var total = 0;
  for (var i = 0; i < d.length; i++) {
    var etapa  = String(d[i][0]).trim();
    if (!etapa) continue;
    var etapaUp = etapa.toUpperCase();
    // TOTAL: % em col F (índice 5); categorias: % em col E (índice 4)
    var pctRaw = (etapaUp === 'TOTAL' || etapaUp === 'CONCLUIDO' || etapaUp === 'CONCLUÍDO') ? d[i][5] : d[i][4];
    var pct = parsePct(pctRaw);
    if (etapaUp === 'TOTAL' || etapaUp === 'CONCLUIDO' || etapaUp === 'CONCLUÍDO') { total = pct; continue; }
    if (etapaUp === 'ORIGEM') continue; // ignora linha ORIGEM
    lista.push({ etapa: etapa, pct: Math.round(pct * 10) / 10 });
  }
  return { lista: lista, total: Math.round(total * 10) / 10 };
}

function parsePct(raw) {
  if (typeof raw === 'number') return raw <= 1 ? raw * 100 : raw;
  return parseFloat(String(raw).replace('%','').replace(',','.')) || 0;
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
