# ATech

Plataforma web para assistência técnica. A interface usa React + TypeScript, a API usa Express e o PostgreSQL guarda usuários e sessões.

Após o login, admins e membros convidados do Workspace usam o mesmo workspace operacional. **Acessos** continua exclusivo do administrador; nele, cada página pode ser liberada individualmente por usuário. Chamados, programação, colaboradores, informações, garantias, validação da API e Processos Jurídicos verificam a permissão também na API.

## Requisitos

- Node.js 20.19+ ou 22.12+
- Docker Desktop com Docker Compose, ou PostgreSQL 15+ instalado localmente
- Um projeto Google Cloud com OAuth 2.0 configurado para contas Google Workspace

## Execução via Docker Compose

O arquivo `.env` deve ficar no mesmo diretório do `docker-compose.yml`. O Docker Compose lê esse arquivo no host e injeta somente as variáveis necessárias nos serviços; ele **não** é copiado para a imagem nem fica disponível como `/app/.env` dentro do container. Isso evita gravar segredos na imagem.

```bash
cp .env.example .env
nano .env
```

Antes de subir, configure no `.env` `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `SESSION_SECRET`, `CORPORATE_DOMAIN` e `VITE_CORPORATE_DOMAIN`. O Compose usa `POSTGRES_*` tanto para configurar o PostgreSQL quanto para montar a URL de conexão do backend (`db:5432`, na rede privada do Compose); `DATABASE_URL` é usada quando a aplicação roda diretamente no host e não substitui essas variáveis no container. Use uma senha PostgreSQL forte formada por letras e números, e um `SESSION_SECRET` aleatório com pelo menos 32 caracteres. `VITE_GOOGLE_CLIENT_ID` deve conter o Client ID OAuth para habilitar login Google. Proteja o arquivo com `chmod 600 .env`. Se já houver um volume PostgreSQL criado pela versão anterior do Compose, mantenha em `POSTGRES_DB`, `POSTGRES_USER` e `POSTGRES_PASSWORD` os valores usados quando esse banco foi criado (a configuração antiga usava o usuário e banco `atech` e a senha `atech_dev`); trocar essas variáveis não altera os dados ou credenciais dentro de um volume existente.

Execute os comandos a partir do diretório do projeto e passe o arquivo explicitamente:

```bash
docker compose --env-file .env up --build -d
```

A stack publica estas portas somente no loopback do host (`127.0.0.1`); elas não devem ser acessíveis diretamente pela rede:

- PostgreSQL: `localhost:5555`
- Backend API: `http://localhost:8003`
- Frontend: `http://localhost:8004`

O backend aplica as migrações ao iniciar. No primeiro deploy, crie a conta administradora:

```bash
docker compose --env-file .env exec backend npm run db:seed
```

Para consultar os logs, use `docker compose --env-file .env logs -f backend`. Se o `.env` estiver ausente ou faltar uma variável obrigatória, o Compose interrompe a inicialização e informa qual variável precisa ser configurada. Não remova o volume `atech_postgres` para corrigir configuração: ele contém os dados do banco.

### Apache2 como proxy HTTPS na VPS

Se o Apache termina o HTTPS e encaminha o tráfego para a porta 8004 do frontend, habilite os módulos `proxy` e `proxy_http` e, dentro do `<VirtualHost *:443>`, use:

```apache
ProxyPreserveHost On
ProxyTimeout 600
ProxyPass / http://127.0.0.1:8004/
ProxyPassReverse / http://127.0.0.1:8004/
```

`ProxyTimeout 600` e o `proxy_read_timeout 600s` do Nginx interno permitem até 10 minutos para a carga inicial paginada do CVCRM. O Nginx do container informa `https` à API, pois o acesso público deve passar pelo VirtualHost HTTPS do Apache. Redirecione HTTP para HTTPS no Apache e acesse a aplicação pelo domínio HTTPS, não diretamente por `http://IP:8004`; as portas publicadas pelo Compose ficam limitadas a `127.0.0.1`, e a API usa um cookie de sessão `Secure` em produção. Mantenha `httpOnly`: essa opção protege o cookie contra leitura por JavaScript e não impede o navegador de enviá-lo. Após atualizar, valide/recarregue o Apache (`sudo apachectl configtest && sudo systemctl reload apache2`) e recrie os containers com `docker compose --env-file .env up -d --build --force-recreate`.

## Primeiro acesso

1. Instale as dependências: `npm install`.
2. Copie `.env.example` para `.env`.
3. Configure `CORPORATE_DOMAIN` e `VITE_CORPORATE_DOMAIN` com o domínio Workspace da empresa, sem `@`.
4. Gere um segredo de sessão com `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` e cole o resultado em `SESSION_SECRET`.
5. No Google Cloud Console, crie um OAuth Client ID do tipo aplicação Web e autorize `http://localhost:5173` como origem JavaScript para desenvolvimento local. Coloque o Client ID em `GOOGLE_CLIENT_ID` e `VITE_GOOGLE_CLIENT_ID`. Para uso por outras pessoas, configure também a origem HTTPS do endereço interno da aplicação; origens HTTP em IP da rede não são adequadas para autenticação Google.
6. Defina `ADMIN_EMAIL` como o e-mail pessoal do administrador, fora do domínio corporativo. O administrador não usa Google SSO.
7. Gere a chave local de criptografia com `npm run security:setup-pii-key`. O comando grava uma chave aleatória de 256 bits no `.env` sem exibi-la. Faça backup seguro dessa chave: sem ela, os campos pessoais criptografados não podem ser recuperados.
8. Inicie o PostgreSQL local seguindo **PostgreSQL local no Windows** abaixo. Docker Compose é apenas uma alternativa se não houver PostgreSQL instalado.
9. Crie as tabelas com `npm run db:migrate`.
10. Crie o administrador único com `npm run db:seed`.
11. Inicie a interface e a API com `npm run dev` e abra `http://localhost:5173`.

## Acesso pela rede interna

Para testes rápidos em uma rede local confiável, o computador que executa a ATech pode servir a interface aos outros computadores. O PostgreSQL e a API continuam no computador host; a porta da API não precisa ser aberta para a rede.

1. Conclua o **Primeiro acesso** no computador host e mantenha o PostgreSQL em execução.
2. Conecte os computadores à mesma rede privada (ou VPN corporativa). Redes Wi-Fi de convidados podem impedir a comunicação entre dispositivos.
3. No computador host, inicie a aplicação com `npm run dev:lan` e mantenha o terminal aberto.
4. Se o Windows Firewall bloquear a conexão, abra o PowerShell como administrador e crie uma regra privada limitada à rede local:

   ```powershell
   New-NetFirewallRule -DisplayName "ATech rede interna" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5173 -Profile Private -RemoteAddress LocalSubnet
   ```

5. No host, execute `ipconfig` e identifique o endereço IPv4 do adaptador conectado à rede da empresa. Nos outros computadores, abra `http://<IP-DO-HOST>:5173`, substituindo o texto entre sinais de menor/maior pelo IPv4 encontrado (por exemplo, `http://192.168.1.25:5173`).
6. Para login Google e uso real com dados da empresa, configure um nome DNS interno e HTTPS com certificado confiável, aponte-o para o host e adicione a origem HTTPS exata (incluindo porta, se não for 443) às origens JavaScript autorizadas do OAuth Client ID no Google Cloud. A configuração de HTTPS/DNS depende da infraestrutura da empresa e não é criada pelo servidor de desenvolvimento.

`npm run dev:lan` expõe o servidor de desenvolvimento Vite na rede, portanto use-o somente para testes em rede confiável. O endereço HTTP não criptografa tráfego: não o use para senhas, sessões ou dados reais. Não crie encaminhamento de portas no roteador e não abra as portas 4000 (API) ou 5432 (PostgreSQL) para os demais computadores; a API fica vinculada a `127.0.0.1` e a interface encaminha as chamadas localmente. A regra do firewall pode ser removida ao encerrar os testes com `Remove-NetFirewallRule -DisplayName "ATech rede interna"`.

## Instalação limpa em VPS Hostinger (Debian 13)

Este procedimento instala a aplicação em uma VPS Debian 13 **sem importar dados do computador atual**. Ele cria um PostgreSQL novo, aplica as migrações e cadastra somente a conta administradora inicial. Nenhum dump de banco é necessário: `npm run db:migrate` cria a estrutura vazia da aplicação. As migrações podem inserir configurações e etapas padrão necessárias ao funcionamento; não são cadastros migrados do ambiente atual.

Os exemplos usam `app.seudominio.com.br`; substitua pelo seu domínio. Execute os comandos de servidor por SSH com uma conta sudo. Configure no painel Hostinger o DNS `A` do domínio para o IP da VPS antes de emitir o certificado HTTPS.

### 1. Atualizar Debian, instalar dependências e abrir o firewall

```bash
sudo apt update
sudo apt full-upgrade -y
sudo apt install -y ca-certificates curl git nginx postgresql postgresql-client certbot python3-certbot-nginx
```

O Debian 13 pode fornecer uma versão do Node.js diferente da versão LTS recomendada. Instale o Node.js 22 LTS pelo repositório oficial NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
less /tmp/nodesource_setup.sh
sudo -E bash /tmp/nodesource_setup.sh
sudo apt install -y nodejs
node --version
npm --version
```

Confirme que o Node está na versão 22.12 ou superior. No firewall da Hostinger e no firewall da VPS, permita somente SSH e tráfego web: portas TCP 22, 80 e 443. Não exponha as portas 4000 (API) ou 5432 (PostgreSQL). Se usar UFW:

```bash
sudo apt install -y ufw
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

Antes de habilitar o UFW, confirme que a regra SSH está ativa para não perder o acesso à VPS.

### 2. Criar usuário de serviço, banco e diretório

Crie uma conta Linux sem login interativo para executar a aplicação:

```bash
sudo adduser --system --group --home /opt/atech --no-create-home atech
sudo install -d -o atech -g atech /opt/atech
```

Crie um banco vazio e um usuário PostgreSQL dedicado. A senha é solicitada interativamente pelo `\password`, não aparece no histórico do shell. No prompt do `psql`, troque os identificadores somente se também os atualizar nos passos seguintes:

```bash
sudo -u postgres psql
```

```sql
CREATE ROLE atech WITH LOGIN;
\password atech
CREATE DATABASE atech OWNER atech;
\q
```

Use uma senha forte gerada por um gerenciador de senhas. Para facilitar o valor de `DATABASE_URL`, prefira uma senha aleatória formada por letras e números, sem caracteres que precisem ser codificados em URL.

### 3. Colocar o código na VPS

Use uma destas opções:

- Clone o repositório privado com uma chave de deploy SSH autorizada: `sudo -u atech git clone <URL-SSH-DO-REPOSITORIO> /opt/atech`.
- Ou envie o código por SFTP para `/opt/atech`, sem enviar `node_modules`, `dist`, `dist-server` ou `.env`.

O repositório precisa conter `package-lock.json`. Entre no diretório e instale as dependências reproduzindo o lockfile:

```bash
cd /opt/atech
sudo -u atech -- npm ci
```

Se o clone for feito por uma conta que não seja `atech`, ajuste o proprietário do código:

```bash
sudo chown -R atech:atech /opt/atech
```

### 4. Configurar segredos e domínio

Crie o arquivo de ambiente na VPS, nunca no repositório:

```bash
cd /opt/atech
cp .env.example .env
nano .env
```

Configure estes valores:

```dotenv
PORT=4000
API_HOST=127.0.0.1
DATABASE_URL=postgresql://atech:SENHA_DO_POSTGRES@127.0.0.1:5432/atech
SESSION_SECRET=COLE_UM_SEGREDO_ALEATORIO_COM_PELO_MENOS_32_CARACTERES
CORPORATE_DOMAIN=empresa.com.br
GOOGLE_CLIENT_ID=ID_DO_CLIENT_OAUTH
VITE_GOOGLE_CLIENT_ID=ID_DO_CLIENT_OAUTH
VITE_CORPORATE_DOMAIN=empresa.com.br
ADMIN_EMAIL=administrador@outro-dominio.com
ADMIN_INITIAL_PASSWORD=DEFINA_UMA_SENHA_FORTE_COM_12_CARACTERES_OU_MAIS
CVCRM_SUBDOMAIN=
CVCRM_API_EMAIL=
CVCRM_API_TOKEN=
CVCRM_SYNC_INTERVAL_SECONDS=3600
PII_ENCRYPTION_KEY=
```

Use o domínio Workspace real, sem `@`, em `CORPORATE_DOMAIN` e `VITE_CORPORATE_DOMAIN`. `ADMIN_EMAIL` deve ser o e-mail pessoal do administrador e ficar fora desse domínio. O Client ID do Google precisa ser do tipo aplicação Web; autorize `https://app.seudominio.com.br` como origem JavaScript. Se a integração CVCRM for necessária, configure suas credenciais no `.env` somente depois da instalação. Não coloque tokens em variáveis `VITE_*`.

Gere um segredo de sessão e cole-o em `SESSION_SECRET`:

```bash
node -p "require('node:crypto').randomBytes(48).toString('base64url')"
```

Proteja o arquivo e gere a chave de criptografia de dados pessoais:

```bash
sudo chown atech:atech /opt/atech/.env
sudo chmod 600 /opt/atech/.env
cd /opt/atech
sudo -u atech -- npm run security:setup-pii-key
```

O comando grava `PII_ENCRYPTION_KEY` no `.env` sem imprimir a chave. Faça cópia de segurança segura dela: os dados pessoais cadastrados no futuro não poderão ser descriptografados sem essa chave. Não a regenere em atualizações.

### 5. Criar o esquema vazio e a conta administradora

Execute as migrações no banco novo e crie a conta de administrador:

```bash
cd /opt/atech
sudo -u atech -- npm run db:migrate
sudo -u atech -- npm run db:seed
```

O seed cria apenas a conta indicada em `ADMIN_EMAIL`; não importa colaboradores, chamados ou processos do computador antigo. Guarde a senha administrativa configurada e depois remova `ADMIN_INITIAL_PASSWORD` do `.env`, pois o seed não altera a senha de uma conta que já exista. A senha inicial não substitui a senha do PostgreSQL.

Compile o site **depois** de configurar as variáveis `VITE_*`, pois elas são incorporadas aos arquivos estáticos durante o build:

```bash
cd /opt/atech
sudo -u atech -- npm run build
```

### 6. Registrar a API como serviço systemd

Crie `/etc/systemd/system/atech.service`:

```ini
[Unit]
Description=ATech API
After=network.target postgresql.service

[Service]
Type=simple
User=atech
Group=atech
WorkingDirectory=/opt/atech
Environment=NODE_ENV=production
EnvironmentFile=/opt/atech/.env
ExecStart=/usr/bin/node /opt/atech/dist-server/index.js
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

Se `command -v node` retornar um caminho diferente de `/usr/bin/node`, use o caminho retornado em `ExecStart`. Habilite e inicie o serviço:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now atech
sudo systemctl status atech --no-pager
sudo journalctl -u atech -n 100 --no-pager
```

### 7. Configurar Nginx e HTTPS

Crie `/etc/nginx/sites-available/atech` substituindo o nome de domínio:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name app.seudominio.com.br;
    root /opt/atech/dist;
    index index.html;
    client_max_body_size 10m;

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Ative o site, valide o Nginx e obtenha o certificado:

```bash
sudo ln -s /etc/nginx/sites-available/atech /etc/nginx/sites-enabled/atech
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d app.seudominio.com.br
```

O DNS precisa apontar para a VPS e as portas 80/443 precisam estar liberadas. Siga as perguntas do Certbot para redirecionar HTTP para HTTPS.

### 8. Validar e iniciar os cadastros

Abra `https://app.seudominio.com.br` e confira o endpoint de saúde em `https://app.seudominio.com.br/api/health`; ele deve responder com `status: ok` e `database: connected`. Faça login com a conta administrativa, convide os usuários na página **Acessos** e cadastre os colaboradores e demais informações na aplicação. Autorize o endereço HTTPS real nas configurações OAuth do Google Cloud.

Como a base inicia vazia, não haverá chamados locais até que sejam importados. Para usar o CVCRM, configure as variáveis de integração no `.env`, reinicie `atech`, valide a conexão na tela **Validação da API** e faça a importação inicial dos chamados ativos. A sincronização automática só deve ser habilitada depois da validação/importação.

### Atualizações futuras

Faça backup antes de atualizar. Depois de obter o código novo:

```bash
cd /opt/atech
sudo -u atech -- git pull
sudo -u atech -- npm ci
sudo -u atech -- npm run build
sudo systemctl restart atech
sudo systemctl status atech --no-pager
```

O Nginx serve os arquivos diretamente de `/opt/atech/dist`, portanto não é necessário copiar o frontend para outro diretório. Verifique a aplicação após cada atualização. Não sobrescreva `.env` e não regenere `SESSION_SECRET` ou `PII_ENCRYPTION_KEY`.

### Backups depois de começar a usar

Não há dump inicial para gerar ou restaurar nesta instalação limpa. Após começar a cadastrar dados, faça backups regulares do PostgreSQL e guarde-os criptografados fora da VPS, junto de uma cópia protegida da `PII_ENCRYPTION_KEY`. Exemplo de dump PostgreSQL compactado:

```bash
sudo -u postgres pg_dump -Fc atech -f /caminho/seguro/atech-$(date +%F).dump
```

Teste periodicamente a restauração em uma base separada. Um dump sem a chave de criptografia não permite recuperar os dados pessoais protegidos.

## Integração CVCRM

No `.env` do backend, configure as variáveis abaixo. Use o subdomínio do endereço do Construtor de Vendas, sem `.cvcrm.com.br`. O e-mail/token são enviados somente como headers servidor-servidor e nunca para o frontend.

```dotenv
CVCRM_SUBDOMAIN=seu-subdominio
CVCRM_API_EMAIL=usuario-administrativo@empresa.com.br
CVCRM_API_TOKEN=token-gerado-no-cvcrm
CVCRM_SYNC_INTERVAL_SECONDS=3600
```

O valor de `CVCRM_SUBDOMAIN` pode ser apenas o subdomínio ou o endereço completo do CVCRM; a API normaliza a entrada para o subdomínio. O usuário administrativo do CVCRM precisa de permissão para consultar atendimentos e workflows. Reinicie a API depois de salvar o `.env`. A integração usa somente chamadas de leitura à API padrão v1 (`GET`), sem enviar alterações de situação ou outros dados ao CVCRM. Não usa o CVDW.

O endpoint paginado é `GET /api/v1/relacionamento/atendimentos/listar`, com `pagina` e `registros_por_pagina=500`; os totais são lidos dos headers `X-Total-Registros` e `X-Total-Paginas`. A validação testa as duas primeiras páginas e interrompe importações/sincronizações se os IDs se repetirem, faltarem metadados de total ou a quantidade recebida não corresponder à informada, para evitar uma base incompleta. Na tela **Validação da API**, valide a conexão e use **Importar todos os chamados ativos** para percorrer toda a paginação e importar atendimentos em todas as situações exceto cancelados e finalizados. Somente depois da carga inicial é possível ativar a sincronização periódica. As etapas são lidas por `GET /api/v1/configuracoes/workflows/atendimentos`; somente etapas com nome não vazio são exibidas.

## Chamados e programação

Chamados têm visualização Kanban e lista; na lista, a paginação mostra 50 chamados por página. Há filtros recolhíveis por empreendimento, bloco, unidade, assunto, subassunto e nome do cliente. Os filtros de seleção permitem pesquisar digitando e selecionar vários valores; blocos e unidades são limitados pelos empreendimentos escolhidos, e unidades também pelo bloco escolhido. Cada usuário mantém os próprios filtros em cookies separados. No Kanban, cada coluna rola verticalmente de forma independente e apresenta cinco cartões por vez; role até **Carregar mais** para exibir os próximos cinco. O quadro mantém a altura da tela. As etapas seguem a ordem numérica configurada no CVCRM, inclusive valores decimais como `0`, `0.1`, `1`, `1.1` e `1.2`. Cada cartão mostra ID e protocolo, permite escolher os campos exibidos e traz tags automáticas de **Cliente** ou **Condomínio**, além de várias tags personalizadas gerenciáveis pela administração. O detalhamento completo do chamado e suas informações relacionadas são carregados ao abrir o cartão. IDs e protocolos são únicos na base; páginas repetidas ou protocolos duplicados recebidos do CVCRM interrompem a sincronização para evitar duplicidades. Nome e telefone do cliente aparecem desfocados nos cartões e detalhes e são revelados ao passar o cursor ou ao focar o dado pelo teclado. A descrição retornada pelo campo `descricao` da API v1 aparece como mensagem informada na abertura. Respostas e metadados de anexos retornados pela consulta de atendimentos são atualizados na sincronização e exibidos no detalhe do chamado; os links de arquivo são abertos diretamente no CVCRM. Comentários podem mencionar pessoas com `@`, receber respostas e ser editados ou excluídos pelo autor e pela administração; menções e respostas geram notificações pessoais. Histórico local registra mudanças de etapa observadas nas sincronizações CVCRM, além de comentários, subtarefas, anexos e programações. Anexos locais são privados, guardados no PostgreSQL e limitados a 5 MiB por arquivo. Comentários, menções, subtarefas, custos, prazo local, anexos e programação ficam no PostgreSQL da ATech. O telefone do cliente é armazenado criptografado.

No detalhamento de cada chamado é possível gerar um termo de finalização em PDF com modelo próprio, campos de atividades que se ajustam ao texto e paginação automática. Empreendimento, bloco, unidade e protocolo são preenchidos a partir do chamado; nome e RG/CPF do cliente são informados no início do formulário e aparecem no início do documento. **Baixar Termo** gera uma cópia com os campos de assinatura em branco para impressão. **Assinar documento** pede o PIN pessoal antes de usar a assinatura protegida do perfil no campo **AC Engenharia** e coleta a assinatura do cliente; o PDF assinado fica como anexo privado do chamado, podendo ser baixado ou excluído no detalhamento por quem o salvou ou pela administração. Clique no nome ou avatar no menu lateral para editar nome, cargo e assinatura e cadastrar um PIN numérico de 6 a 12 dígitos. O PIN também é exigido para ver ou alterar a assinatura; após cinco tentativas incorretas, fica bloqueado por 15 minutos. A assinatura é cifrada com `PII_ENCRYPTION_KEY` e o PIN é salvo somente como hash. A cópia em branco para impressão não é armazenada.

A administração tem a página **Prazos de garantia**, que carrega os subassuntos do assunto **Assistência técnica (ID 16)** pelo endpoint somente de leitura `GET /api/v1/cvbot/assuntos/16/sub-assuntos` do CVCRM ([documentação oficial](https://desenvolvedor.cvcrm.com.br/docs/criando-um-chatbot-para-abrir-atendimentos-no-cv-crm.md)) e permite definir um prazo inteiro de 1 a 100 anos para cada item. A situação de garantia de cada chamado usa o subassunto e assunto do CVCRM, a data de abertura do chamado e a data de entrega cadastrada em **Informações**. O período é contado em anos corridos e inclui o dia do aniversário de vencimento. O cartão e o detalhe mostram se está dentro ou fora do prazo; sem prazo cadastrado, data de entrega ou data de abertura, mostram **Garantia indeterminada**. Execute `npm run db:migrate` para aplicar a migração `021_subsubject_warranties.sql`. Em bases já existentes, faça também uma sincronização normal dos chamados pelo CVCRM após a carga inicial para preencher os novos identificadores de assunto/subassunto; os dados importados daqui em diante já os armazenam automaticamente.

**Processos Jurídicos** oferece quadro Kanban e lista (50 processos por página), filtros recolhíveis, fases configuráveis, processos principais e filhos, pagamentos e comprovantes, além de comentários com respostas, edição e menções (`@nome`). A seção **Importar cartões do ClickUp** aceita CSV com as colunas `Task ID`, `Task Name` e `Status`. A prévia é lida no navegador; ao confirmar a importação, cada tarefa vira um cartão persistido no PostgreSQL, com descrição, último comentário, responsável, prioridade, prazo e contagem de comentários no texto do cartão. Descrição e último comentário juntos podem ocupar até 20.000 caracteres por cartão; o CSV pode ter até 10 MiB e a solicitação de importação até 7 MB. O arquivo CSV original não é guardado. As fases do ClickUp são usadas no quadro e criadas quando ainda não existem. Reimportações ignoram Task IDs já importados para evitar duplicação e não sobrescrevem cartões existentes. A migração `027_legal_process_csv_imports.sql` registra a relação entre Task IDs e cartões; execute `npm run db:migrate` em instalações existentes antes de importar. Se a tela informar que falta a estrutura de importação, aplique essa migração no banco usado pelo servidor. No Kanban, cada coluna tem rolagem vertical independente e exibe cinco cartões por vez; role até **Carregar mais** para exibir os próximos cinco. O quadro mantém a altura da tela e o detalhamento completo do processo é carregado ao abrir um cartão. Cada processo filho registra número, descrição, status, data de movimentação e conclusão. Links do Drive e Notebook podem ser abertos ou editados no detalhe do processo. Em bases existentes, execute `npm run db:migrate` para aplicar também `023_legal_process_collaboration.sql`; a migração `026_decimal_ticket_workflow_order.sql` permite armazenar a ordem fracionária das etapas do workflow de chamados.
**Processos Jurídicos** oferece quadro Kanban e lista (50 processos por página), filtros recolhíveis, fases configuráveis, processos principais e filhos, pagamentos e comprovantes, além de comentários com respostas, edição e menções (`@nome`). A seleção de responsáveis é pesquisável e aceita múltiplas pessoas sem exigir teclas modificadoras. A seção **Importar cartões do ClickUp** aceita CSV com as colunas `Task ID`, `Task Name` e `Status`. A prévia é lida no navegador; ao confirmar a importação, cada tarefa vira um cartão persistido no PostgreSQL, com descrição, último comentário, responsável, prioridade, prazo e contagem de comentários no texto do cartão. Descrição e último comentário juntos podem ocupar até 20.000 caracteres por cartão; o CSV pode ter até 10 MiB e a solicitação de importação até 7 MB. O arquivo CSV original não é guardado. As fases do ClickUp são usadas no quadro e criadas quando ainda não existem. Reimportações ignoram Task IDs já importados para evitar duplicação e não sobrescrevem cartões existentes. A migração `027_legal_process_csv_imports.sql` registra a relação entre Task IDs e cartões; execute `npm run db:migrate` em instalações existentes antes de importar. Se a tela informar que falta a estrutura de importação, aplique essa migração no banco usado pelo servidor. No Kanban, cada coluna tem rolagem vertical independente e exibe cinco cartões por vez; role até **Carregar mais** para exibir os próximos cinco. O quadro mantém a altura da tela e o detalhamento completo do processo é carregado ao abrir um cartão. Cada processo filho registra número, descrição, status, data de movimentação e conclusão. Links do Drive e Notebook podem ser abertos ou editados no detalhe do processo. Em bases existentes, execute `npm run db:migrate` para aplicar também `023_legal_process_collaboration.sql`; a migração `026_decimal_ticket_workflow_order.sql` permite armazenar a ordem fracionária das etapas do workflow de chamados.

**Atividades pessoais** fornece a cada usuário um kanban privado sem paginação, inicialmente com as colunas **Novo**, **Em andamento**, **Pendente Validação** e **Concluído**; é possível criar, renomear, reordenar e remover colunas vazias, além de cadastrar, editar, mover e excluir atividades. Colunas, atividades, descrições, datas de início e prazo, tags, comentários e anexos são gravados no PostgreSQL; ao reabrir ou atualizar o quadro, os dados são carregados do banco. Cada cartão pode ter anexos PDF, imagens JPEG/PNG/WebP e texto/CSV de até 5 MiB. A administração pode conceder a permissão **Selecionar quadro de outra pessoa** na página **Acessos**; quem a possui pode consultar cartões, comentários e anexos de outros quadros em modo somente leitura. As migrações `028_personal_activities.sql`, `029_personal_activity_default_columns.sql`, `030_seed_personal_activity_boards.sql` e `031_personal_activity_details.sql` criam a estrutura, atualizam quadros padrão vazios existentes, garantem colunas iniciais e adicionam os recursos de data, tags, comentários e anexos. Depois de publicar a versão, execute `npm run db:migrate` no servidor Debian para criar/atualizar as tabelas e colunas necessárias; sem aplicar as migrações, as operações da tela não poderão ser persistidas.

Na tela **Programação**, as agendas **Programação Geral** e **Encarregados** são separadas. Selecione o dia para ver atividades em cartões verticais por colaborador, agrupados por função. Os filtros por função permitem mostrar ou ocultar cada grupo na agenda e no PDF; a configuração é compartilhada e salva no PostgreSQL, e alterações feitas por qualquer usuário autenticado são refletidas para os demais usuários e nos formulários de programação abertos dentro dos chamados. As preferências são atualizadas automaticamente enquanto as telas estão abertas. **Baixar relatório PDF** gera e baixa um documento A4 de lista, agrupado por função, com nome e função, horário, protocolo quando aplicável, empreendimento, local, serviço, materiais, equipamentos e ferramentas; apelidos não são incluídos. Cadastros de colaborador aceitam foto JPEG, PNG ou WebP até 2 MiB; as imagens ficam privadas no PostgreSQL. Cada atividade pode ser atribuída a vários colaboradores e replicada nos dias úteis entre as datas inicial e final (intervalo máximo de 90 dias). Ao programar a partir de um chamado, todos os colaboradores ativos, inclusive encarregados, aparecem na mesma lista; a agenda separada é definida automaticamente pelo cargo do colaborador e só é visualizada separadamente na tela **Programação**. Na página da agenda, a busca em menu suspenso filtra chamados ativos por protocolo, assunto, empreendimento, bloco ou unidade; chamados inativos/finalizados não são oferecidos. Também é possível escolher **Atividade avulsa**, que abre um campo para descrever o local com referências úteis para a equipe. Para chamados, informe empreendimento e bloco/unidade ou um local de área comum, junto à descrição do serviço; materiais, equipamentos e ferramentas são opcionais e aparecem no roteiro do colaborador. Horários livres em comum são verificados em todas as datas, e cada reserva é criada numa transação PostgreSQL; sobreposições são rejeitadas e colaboradores afastados/desligados não podem ser programados. As programações existentes podem ser editadas ou excluídas pela agenda ou pelo detalhe do chamado; mudanças em programações ligadas a chamados são registradas no histórico do protocolo.

A tela **Informações** agrega os empreendimentos únicos identificados nos chamados e exibe síndico e supervisor atuais, telefones e e-mails, e-mail do condomínio, data de emissão do habite-se, data de entrega e tempo desde a entrega. Qualquer usuário autenticado pode atualizar essas informações ou cadastrar manualmente empreendimentos antigos, que também passam a aparecer na lista.

O seed gera uma senha aleatória de uso inicial e a mostra uma única vez no terminal, junto ao e-mail configurado. Guarde-a e entre pela opção **Acesso do administrador**. Se preferir definir a senha antes, configure `ADMIN_INITIAL_PASSWORD` no `.env` com pelo menos 12 caracteres. Rodar o seed novamente não troca a senha e nunca cria um segundo administrador.

Senhas existentes não podem ser recuperadas: o banco armazena apenas o hash. Para invalidar a senha atual e gerar outra, execute `npm run db:reset-admin-password`. O comando mostra a nova senha uma única vez no terminal; o seed normal não altera uma conta que já existe.

Para PostgreSQL instalado fora do Docker, ajuste `DATABASE_URL` no `.env`. No Docker Compose, configure as credenciais do serviço com `POSTGRES_DB`, `POSTGRES_USER` e `POSTGRES_PASSWORD`; altere os valores de exemplo antes de qualquer implantação compartilhada.

### PostgreSQL local no Windows

Como o serviço PostgreSQL já está instalado, você pode criar um usuário exclusivo para a ATech:

1. Abra **SQL Shell (psql)** pelo menu Iniciar. Pressione Enter para aceitar `localhost`, banco `postgres`, porta `5432` e usuário `postgres`.
2. Quando solicitado, digite a senha definida ao instalar o PostgreSQL. Essa senha é apenas para o administrador local do banco; não a compartilhe.
3. No prompt `postgres=#`, crie um usuário e um banco separados para a aplicação. Troque o valor de exemplo por uma senha forte com letras e números:

	```sql
	CREATE ROLE atech WITH LOGIN PASSWORD 'SUA_SENHA_LOCAL_FORTE';
	CREATE DATABASE atech OWNER atech;
	```

4. Digite `\q` para fechar o psql. Copie `.env.example` para `.env` e atualize `DATABASE_URL`, usando a senha que acabou de definir:

	```text
	DATABASE_URL=postgres://atech:SUA_SENHA_LOCAL_FORTE@localhost:5432/atech
	```

5. Siga os passos 3 a 6 de **Primeiro acesso** para configurar domínio, segredo de sessão, OAuth e `ADMIN_EMAIL`.
6. No terminal do projeto, execute `npm run db:migrate`, depois `npm run db:seed` e, por fim, `npm run dev`.

O PostgreSQL exige a senha de administrador para criar o usuário e o banco. Ela é definida durante a instalação do PostgreSQL e é diferente da senha da conta administradora da ATech, criada pelo seed.

## Acesso corporativo

O administrador cadastra endereços do domínio Workspace na tela **Gestão de usuários**. O convite fica registrado no PostgreSQL; a pessoa acessa usando **Continuar com Google** e só entra se o e-mail estiver convidado, verificado e vier do domínio Workspace indicado no token Google. Convites são cadastros de acesso; o projeto não envia e-mail de notificação.

Suspender um usuário bloqueia novos acessos. O administrador é protegido contra suspensão e uma restrição/índice parcial no PostgreSQL permite apenas uma conta administrativa.

## Colaboradores

O menu **Colaboradores** mantém fichas profissionais separadas das contas de login, com pesquisa por nome/apelido, filtros por função e situação, matrícula opcional e única, envio de foto JPEG, PNG ou WebP de até 2 MiB e exclusão permanente de cadastros. Usuários autenticados podem adicionar funções diretamente no formulário de cadastro; as funções adicionadas ficam disponíveis para todos os colaboradores e para a programação. CPF e telefone são opcionais; quando preenchidos, o CPF continua sujeito à validação e unicidade. Ao excluir um colaborador, seus dados pessoais e foto são removidos, suas programações da agenda são apagadas e registradas no histórico dos chamados, e os registros de acesso a dados sensíveis preservam o nome do colaborador para auditoria. A lista inicial inclui pedreiro, ajudante, pintor, eletricista, encanador, fornecedor terceirizado, analista, assistente, gestor, gerente e encarregado. A lista mostra foto (ou iniciais), nome, apelido, matrícula, função, idade em anos/meses/dias e situação; não retorna CPF, telefone ou data de nascimento.

CPF, telefone, data de nascimento e dados dos filhos são criptografados com AES-256-GCM usando `PII_ENCRYPTION_KEY`. A chave é criada localmente por `npm run security:setup-pii-key`; mantenha backup seguro e não a troque sem recriptografar os dados. O relatório individual exige confirmação, exibe aviso de dados pessoais e registra quem acessou e quando. A página inicial mostra três quadros: aniversários pessoais dos meses anterior, atual e próximo (datas em dia/mês, sem ano de nascimento), aniversários de empresa deste mês e aniversários de empresa do mês anterior e do próximo. Nos aniversários de empresa, são exibidos a data do marco no formato dia/mês/ano, a data de admissão e o tempo de empresa decorrido em anos, meses e dias.

## Estrutura

- `src/`: telas React e estilos da aplicação.
- `server/routes/`: endpoints HTTP de autenticação e gestão de usuários.
- `server/domain/`: tipos de domínio compartilhados pela API.
- `server/migrations/`: esquema PostgreSQL versionado.
- `server/scripts/`: migração e criação segura do administrador inicial.

## Comandos

- `npm run dev`: interface Vite e API Express em modo de desenvolvimento, acessível somente no computador local.
- `npm run dev:lan`: modo de desenvolvimento para testes na rede interna; veja os avisos de segurança acima.
- `npm run build`: valida e compila o frontend e o backend.
- `npm run lint`: executa Oxlint.
- `npm run db:migrate`: aplica a migração do banco.
- `npm run db:seed`: inicializa o administrador se ainda não existir.
- `npm run db:reset-admin-password`: substitui a senha do administrador por uma nova senha aleatória.
- `npm run security:setup-pii-key`: cria a chave local de criptografia de dados pessoais se ela ainda não existir.

As situações e atendimentos ativos são consultados no CVCRM; os campos de gestão diária descritos acima pertencem à ATech. Mantenha `CVCRM_API_TOKEN` apenas no ambiente do backend e renove-o conforme a validade definida no CVCRM.

Em produção, use HTTPS, segredos fortes fora do repositório, um PostgreSQL gerenciado e configure a origem permitida do Google para o domínio real. O cookie de sessão é `HttpOnly`, `SameSite=Lax` e `Secure` em produção.
