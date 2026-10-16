# Riscos de segurança identificados

Esta revisão foi focada no fluxo de autenticação e nas portas publicadas pelo Docker Compose. A correção no Compose limita os serviços a `127.0.0.1`, de modo que o acesso externo deve passar por um proxy HTTPS configurado no host.

| Severidade | Risco | Evidência e impacto | Mitigação |
|---|---|---|---|
| Alta, condicionada à exposição da porta | A interface e o proxy interno usam HTTP sem TLS. Se acessíveis diretamente por uma rede não confiável, um invasor no caminho pode interceptar ou alterar o tráfego, incluindo credenciais de login e dados de sessão. | A interface publica a porta `8004`; o Nginx do container escuta na porta 80 e encaminha `/api/` ao backend por HTTP. O cookie `Secure` não criptografa a requisição de login. | A porta `8004` agora é publicada apenas em `127.0.0.1`. Para acesso externo, use o VirtualHost HTTPS do Apache; redirecione HTTP para HTTPS e não exponha a porta do container à Internet. |
| Alta, condicionada à exposição da porta | A API HTTP publicada diretamente pode expor requisições e respostas a interceptação ou alteração de tráfego, inclusive credenciais e dados de sessão. | A porta `8003` estava publicada no host sem restrição de endereço. | A porta `8003` agora é publicada apenas em `127.0.0.1`. Em produção, a API deve ser acessada pelo proxy interno da rede Docker e pelo domínio HTTPS público. |
| Alta, condicionada à exposição da porta | A porta do PostgreSQL publicada diretamente permite tentativas de conexão ao banco; se alcançável e as credenciais forem obtidas ou fracas, pode haver leitura, alteração ou exclusão de dados. | A porta `5555` estava publicada no host sem restrição de endereço. | A porta `5555` agora é publicada apenas em `127.0.0.1`. Não encaminhe essa porta no roteador/firewall nem a exponha à rede pública. |

## Validação do login

- O login administrativo (`POST /api/auth/admin/login`) exige e-mail válido e senha. O backend busca uma conta ativa com papel `admin` e compara a senha recebida com o hash armazenado usando bcrypt. O e-mail isolado não autentica.
- O login Google (`POST /api/auth/google`) recebe uma credencial de identidade Google. O backend verifica a assinatura, o público destinatário, o domínio Workspace e o estado de verificação do e-mail com a biblioteca oficial `google-auth-library`; depois exige que a conta convidada/ativa exista no banco.
- Nenhum desses fluxos emite JWT da aplicação: após validar a identidade, o backend cria uma sessão no servidor e a identifica pelo cookie `atech.sid`.
- Uma credencial Google legítima é uma credencial bearer: quem obtiver uma cópia utilizável pode tentar reproduzi-la enquanto válida. A verificação no backend impede que um e-mail arbitrário, sem uma credencial Google válida, seja usado para obter sessão. HTTPS é necessário para proteger a credencial durante o transporte.
- A aplicação define `HttpOnly`, `SameSite=Lax` e `Secure` em produção para o cookie. A proteção de transporte depende também da configuração externa de HTTPS, do firewall e do acesso real às portas do host; esses componentes não são verificáveis somente pelo código deste repositório.

## Estado após a correção

As portas publicadas para PostgreSQL (`5555`), API (`8003`) e frontend (`8004`) estão vinculadas ao loopback IPv4 do host. Isso reduz a exposição pela rede, mas não substitui o HTTPS no ponto de entrada público, nem protege contra processos locais comprometidos ou uma configuração de proxy/firewall que volte a expor as portas. Após atualizar a implantação, recrie os containers com `docker compose --env-file .env up -d --build --force-recreate` e confirme no host que o Apache atende o domínio por HTTPS.
