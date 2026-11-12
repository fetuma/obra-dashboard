# Implantação de segurança — Studio FC

A pasta trivor não foi alterada. Nenhuma configuração de DNS, Cloudflare ou Vercel foi publicada automaticamente.

## Antes do deploy

- JWT_SECRET precisa ter pelo menos 32 caracteres aleatórios. A troca encerra todas as sessões.
- O novo frontend e a API devem ser publicados juntos. Tokens antigos não são aceitos; clientes precisarão entrar novamente.
- A API usa cookie HttpOnly, Secure em produção e SameSite=Strict, com validação de Origin em operações POST. Desenvolvimento local: http://localhost ou http://127.0.0.1. Preview Vercel não está autorizado para login por padrão.
- Senhas existentes CLIENT_N_PASS continuam funcionando para permitir migração. Gere hashes scrypt com `node scripts/hash-password.js`, fornecendo a senha pela entrada padrão (não em argumentos ou histórico). Configure CLIENT_N_PASS_HASH e remova CLIENT_N_PASS. Não compartilhe senhas nem hashes no chat.
- Não reatribua índices CLIENT_N a outros clientes; o identificador está na sessão. Ao reorganizá-los, rotacione JWT_SECRET.

## Fechar o acesso direto ao Apps Script (obrigatório para completar a proteção)

1. Gere uma chave longa e aleatória para cada script e adicione API_SHARED_SECRET nas propriedades do projeto Apps Script.
2. Copie apps_script.gs para o projeto correspondente, preservando o ID de pasta específico daquele cliente. Publique uma nova versão da implantação.
3. Configure CLIENT_N_SCRIPT_KEY na Vercel com a mesma chave e faça deploy da API. Coordene estes passos em janela de manutenção: até ambos estarem ativos, a leitura pode falhar.
4. Verifique que GET direto no script e POST sem chave não retornam dados. Confirme o painel com uma conta válida.

A chave é opcional no script: enquanto API_SHARED_SECRET não estiver definida nas propriedades, o script novo responde sem chave (GET ou POST), como o antigo. Isso permite republicar o script primeiro e ligar a chave depois, cliente por cliente. Definida a propriedade, GET e POST sem a chave certa são recusados.

Sem CLIENT_N_SCRIPT_KEY, a API mantém temporariamente GET para compatibilidade com a implantação antiga. Isso NÃO fecha o acesso direto ao script antigo. A URL não é mais enviada ao navegador; URLs anteriormente expostas devem ser substituídas por uma nova implantação, desativando a antiga. Revise também permissões de compartilhamento dos arquivos do Drive.

## Firewall e sessões

O limitador em memória é apenas uma proteção por instância (10 tentativas por IP e por conta em 15 minutos). Em serverless, não garante limite global. Configure proteção de /api/login na Vercel ou armazenamento compartilhado para contadores antes de considerar a proteção contra força bruta completa. Não confiamos em X-Forwarded-For arbitrário; valide a topologia antes de habilitar trust proxy.

Logout remove o cookie local. Um cookie roubado permanece válido até expirar (30 minutos); revogação imediata exige armazenamento de sessões. Troca de senha também não revoga cookies já emitidos: rotacione JWT_SECRET em incidentes.

Não foi instalado Cloudflare: envolve configuração externa e análise de compatibilidade com a Vercel. Caso adotado, exclua /api/* do cache e proteja também o acesso direto ao deployment. Turnstile ainda não foi instalado; requer sitekey/secret e validação de servidor.

## Cabeçalhos e SEO

A CSP adicionada restringe objetos, base, frames e formulários apenas na raiz, index.html e API; não altera /trivor. Ainda não restringe script-src, pois o site contém scripts e handlers inline: uma CSP estrita exige extração destes recursos e validação visual.

robots.txt indica o sitemap, sem bloquear Trivor. Metadados e título semântico foram melhorados, e o favicon embutido foi extraído para cache separado. Páginas próprias de serviços/projetos, Search Console, Core Web Vitals e revisão visual ficam para uma etapa posterior.

## Verificação

Execute `node --test tests/security.test.js` e `npm audit --omit=dev`. Após o deploy, valide login, atualização, expiração, logout e instalação PWA com uma conta real. O ambiente local usa Node 24; a Vercel está configurada para Node 22, que também deve ser validado antes da publicação.

## Desempenho e galeria (10/11/2026)

- Perspectivas: grade de miniaturas com carregamento lazy, ampliação ao clicar, setas, Escape e foco de teclado. URLs existentes do Google recebem variantes w480/w1920; os originais do Drive não são alterados. Valide com os arquivos reais e suas permissões após publicar; testes locais usam imagens simuladas. URLs HTTPS fora desse provedor continuam funcionando, mas exigem um serviço de thumbnails para reduzir o arquivo transferido.
- Portfólio: derivados em assets/web/portfolio, 640 px para grade e 1920 px para ampliação; hero usa srcset. Originais preservados. As 32 imagens de grade passam de 7.153.030 bytes para 844.006 bytes (88,2% menos). As versões grandes totalizam 6.468.710 bytes. Esses números são tamanho de arquivos, não medição de tempo em produção.
- Regeração: Python com Pillow, `python scripts/optimize-images.py`. Relatório em scripts/image-report.json. Nunca processa trivor.
- API: requisições simultâneas por cliente/configuração compartilham a mesma consulta. Cache de 5 minutos continua isolado por cliente e configuração. Atualizar envia refresh=1 e ignora cache; no Apps Script atualizado, também ignora o cache de origem.
- Apps Script: cache autenticado por 120 segundos; cada aba é lida uma vez por execução. É necessário republicar o script e configurar CLIENT_N_SCRIPT_KEY conforme acima para ativar essas melhorias. Cache é best-effort; até a expiração podem aparecer dados anteriores. Documentação: https://developers.google.com/apps-script/reference/cache/cache
- Interface: evita consultas simultâneas, mantém o painel visível na atualização, cancela solicitações no logout e não restaura dados privados no localStorage. Imagens externas não entram no cache do service worker.
- Verificação: `node --test tests/security.test.js tests/gallery.test.js`. O teste de galeria usa Chromium com dados/API/gráficos simulados e tamanhos desktop/mobile. Para preparar o navegador: `npx playwright install chromium`. É preciso confirmar latência e imagens reais depois do deploy.

Próxima melhoria recomendada: separar os dados financeiros da listagem de documentos/imagens. Isso permite apresentar o resumo antes de concluir a consulta ao Drive. Para maior escala, avaliar cache compartilhado autenticado entre instâncias; o cache local da API é perdido em cold starts.
