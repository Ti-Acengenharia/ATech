export interface VersionRelease {
  version: string
  date: string
  title: string
  tagline: string
  changes: {
    category: 'Segurança' | 'Funcionalidade' | 'Design & UX' | 'Infraestrutura & VPS'
    items: string[]
  }[]
}

export const APP_CURRENT_VERSION = 'v2.5.1'

export const APP_VERSION_HISTORY: VersionRelease[] = [
  {
    version: 'v2.5.1',
    date: '26/11/2026',
    title: 'Cadastro de Visita Técnica (AT001/AT002), Integração CVCRM, PDFs da Programação, Performance e Responsividade Mobile',
    tagline: 'Novo fluxo completo de Cadastro de Visita Técnica com geração automática de Declaração (AT001) e Relatório de Vistoria (AT002) integrados ao CVCRM, aprimoramentos nos PDFs da programação (sem atividades canceladas e com campo Equipe), otimizações de desempenho no frontend/backend e correção da responsividade mobile.',
    changes: [
      {
        category: 'Funcionalidade',
        items: [
          'Novo fluxo de Cadastro de Visita Técnica na aba Documentos & Termos dos chamados: formulário dedicado com 9 campos obrigatórios, fotos opcionais por campo com compressão automática no navegador, salvamento automático de rascunho único no banco de dados e coleta de nome, documento e assinatura digital do cliente na tela.',
          'Geração automática de 2 PDFs padronizados com controle de versão (Revisão 03, Data 26/11/2026): Declaração de Visita Técnica (AT001) com assinatura centralizada do cliente e Relatório de Vistoria (AT002) com registro fotográfico e assinatura digital do responsável interno (consultada do Perfil).',
          'Botão "Emitir Modelo em Branco (AT001)" para impressão da Declaração de Visita Técnica sem dados de cliente quando houver necessidade de coleta de assinatura física.',
          'Envio automático dos 2 PDFs da visita em comentários separados para o Construtor de Vendas (CVCRM) via API de mensagens com anexos em Base64, validação de retorno lógico da API e botão "Reenviar ao CVCRM" no histórico da visita.',
          'Novo card na tela de Administração para ativar/desativar o envio automático de visitas ao CVCRM e definir individualmente a visibilidade (Privado ou Público) da Declaração (AT001) e do Relatório (AT002).',
          'PDFs da Programação de Colaboradores e Encarregados (WhatsApp e Download): atividades canceladas não são mais exibidas no PDF enviado à equipe de campo (mantendo o histórico apenas no ATech) e chamados compartilhados passam a exibir automaticamente a linha "EQUIPE" listando os colegas no formato Nome (Função).',
        ],
      },
      {
        category: 'Design & UX',
        items: [
          'Aumento confortável da tipografia nos cartões do Kanban e em todas as seções internas da tela de detalhes dos chamados.',
          'Altura fixa do Kanban na versão web (desktop) calibrada para exibir ~3 chamados por coluna com rolagem interna independente, isolada exclusivamente para telas desktop.',
          'Correção completa do Kanban na versão mobile (<= 768px), restaurando o fluxo vertical natural das colunas, eliminando o corte de cartões e compactando a sub-barra de visualização.',
        ],
      },
      {
        category: 'Infraestrutura & VPS',
        items: [
          'Ativação de compressão HTTP (gzip) no servidor Express com exclusão explícita do stream SSE (/api/sync/events) para respostas de API mais rápidas sem afetar o sincronismo em tempo real.',
          'Otimizações de desempenho no frontend: carregamento sob demanda (React.lazy + Suspense) para modais e subpáginas pesadas dos Chamados, memoização de TicketCard (React.memo), content-visibility: auto nos cartões do Kanban e redução de custos de composição/transição CSS.',
          'Migrações 067 e 068 aplicadas: tabela ticket_visits para rascunhos, finalização e rastreabilidade de envio ao CVCRM (067) e índice único parcial garantindo no máximo 1 rascunho ativo por chamado (068).',
        ],
      },
    ],
  },
  {
    version: 'v2.5',
    date: '23/11/2026',
    title: 'Visualizador de Mídia Fullscreen, Repositório de Empreendimentos, Cancelamento Drilldown, Programação Semanal por Colaborador, Estoque Sienge e Tarefas Unificadas',
    tagline: 'Lançamento da versão 2.5 com galeria e visualizador fullscreen de fotos/vídeos/PDFs (desktop e mobile com gestos de toque), repositório de manuais e projetos por empreendimento, cancelamento e remanejamento inteligente de atividades via drilldown, visualização semanal por colaborador na programação, integração completa de Estoque Sienge e tarefas unificadas.',
    changes: [
      {
        category: 'Funcionalidade',
        items: [
          'Filtro por Protocolo, Palavras-chave e Colaborador na Programação (Visão Diária e Semanal): busca unificada por número de protocolo, descrição de serviço, empreendimento, unidade, área comum ou colaborador tanto na agenda diária quanto na programação semanal por colaborador, com painel integrado de histórico que lista todas as programações já registradas para aquele chamado em qualquer data e permite saltar diretamente para o dia ou semana correspondente.',
          'Integração Automática e Manual de Comentários Internos da Programação com o CVCRM: consolidação diária no fechamento do expediente (padrão às 17h40, configurável pelos administradores com botão de ativar/desativar e disparo manual na tela de Programação) que publica em cada chamado do CVCRM uma nota estritamente interna (invisível ao cliente) agrupando todas as novas programações do atendimento (mesmo em dias não seguidos), colaboradores escalados no mesmo dia/horário, ajustes realizados em programações existentes e cancelamentos/reagendamentos.',
          'Cancelamento Inteligente, Reagendamento e Remanejamento de Atividades da Programação: fluxo com seletor drilldown para reagendamento direto (para outro dia ou outro horário do mesmo dia, copiando todas as especificações da atividade antiga e exibindo janelas livres ao vivo com prevenção de conflitos), cancelamento por parte do cliente, cancelamento pela AC Engenharia (com justificativa obrigatória) e remanejamento para outro profissional, mantendo o registro original na programação e no chamado com destaque em vermelho, sinalização "[CANCELADA]" no título e liberação imediata do horário antigo para novos agendamentos.',
          'Novo Visualizador e Galeria Integrada de Mídia em Tela Cheia (MediaViewerModal) para Chamados e Empreendimentos: abertura direta no navegador de fotos, vídeos e documentos PDF sem a necessidade de baixar previamente, com renderização em tela cheia real via React Portal, foco automático, navegação sequencial ("passear pelos arquivos" com setas na tela, teclado ou gestos de swipe no celular), zoom interativo (incluindo toque duplo no mobile), rotação e botão dedicado para download.',
          'Proxy de Mídia e Visualização Segura de Anexos do CVCRM: suporte a carregamento e exibição contínua de anexos de conversas e arquivos sincronizados do CVCRM, contornando bloqueios de iframe/CORS e garantindo exibição inline sem forçar downloads indesejados.',
          'Repositório de Manuais e Projetos em PDF nas Informações dos Empreendimentos: espaço dedicado por condomínio para anexar projetos arquitetônicos, estruturais, elétricos/hidráulicos e manuais de proprietário/áreas comuns em PDF (até 30 MB), com visualização imediata no navegador, download individual, filtros por categoria e contadores integrados sem sobrecarregar o desempenho da plataforma.',
          'Nova Visualização Semanal por Colaborador na tela de Programação: acompanhamento completo de todas as atividades agendadas de um ou múltiplos colaboradores ao longo da semana, com seleção por busca ou atalhos por função, navegação semanal, alternância entre Grade por Dia e Painel por Colaborador, exibição de horários, locais, kits de ferramentas, alertas de ausências/atestados e atualização interativa de realização de serviço e entrega de termos.',
          'Módulo completo de Estoque Sienge integrado via API Bulk-Data e REST: sincronização de saldos por centro de custo e local de armazenamento, baixas de estoque, transferências entre obras, movimentações em lote, consulta automática de apropriações e reconciliação de movimentos pendentes.',
          'Entregas de EPI e uniformes aos colaboradores integradas diretamente ao saldo do Estoque Sienge, com baixa automática, validação por PIN e assinatura digital.',
          'Unificação de Tarefas entre Chamados, Processos Jurídicos e Minhas Atividades: toda tarefa criada em um chamado ou processo jurídico é vinculada automaticamente ao quadro "Minhas Atividades" do autor (com migração das tarefas existentes de chamados para seus respectivos criadores).',
          'Modal único e compartilhado de tarefas em todas as telas (Chamados, Processos Jurídicos e Minhas Atividades), permitindo visualizar e editar a mesma descrição, prioridade, prazo, coluna do Kanban, tags, checklist interno, anexos e comentários em tempo real.',
          'Busca inteligente por palavras-chave e nome do cliente nos Chamados e Dashboard: pesquisa todas as palavras digitadas de forma independente da ordem e sem diferenciar acentos (ex.: buscar "ventilador azul" ou "Fábio Santos" encontra registros mesmo com outras palavras ou nomes do meio intercalados).',
          'Filtro de blocos vinculado dinamicamente aos empreendimentos selecionados em todas as telas (Chamados, Dashboard de Chamados e Preenchimento de Cartas), exibindo ao lado de cada bloco, em cinza e entre parênteses, a qual empreendimento ele pertence.',
          'Botão "Abrir no CVCRM" no topo de cada chamado para acesso direto ao atendimento correspondente no Construtor de Vendas.',
          'Suporte a abertura direta em nova guia (clique com botão do scroll do mouse, Ctrl+Clique ou botão direito -> "Abrir link em uma nova guia") nos IDs e cartões de Chamados e Processos Jurídicos (tanto no Kanban quanto na Lista).',
          'Quadro dinâmico "Equipe em Campo Hoje" na tela de Início agrupado por centro de custo/obra, exibindo o número do chamado (ou processo jurídico/atividade avulsa) ao lado do nome de cada colaborador, com filtros por turno (Agora, Manhã, Tarde e Dia todo), sinalização de transições de rota e substituição automática em tempo real caso uma programação seja cancelada e outra entre no mesmo horário e localidade.',
          'Gestão de atestados e faltas de colaboradores com suporte a horários parciais, edição de registros, alerta automático de conflitos com agendamentos e atalhos para reagendamento.',
          'Inclusão de chamados internos e opção "Sem empreendimento" nos filtros e indicadores do Dashboard de Chamados.',
        ],
      },
      {
        category: 'Design & UX',
        items: [
          'Redesign Compacto do Quadro Kanban de Chamados e Modal Animado de Filtros: transformação do painel de filtros em botão dedicado ao lado de "Novo chamado por protocolo", cartões enxutos com destaque para Empreendimento/Bloco/Unidade e nome do cliente visível sem desfoque (mantendo apenas o telefone protegido), cabeçalhos de coluna fixos (sticky) com identidade de cor da etapa ao rolar a página, nivelamento uniforme da altura das colunas, barra de rolagem horizontal fixa no rodapé e rolagem direta dentro da coluna ao clicar em "Carregar mais".',
          'Otimização Multi-Abas do LiveSync (Web Locks API + BroadcastChannel): compartilhamento de uma única conexão SSE entre todas as guias abertas do navegador, eliminando o bloqueio de carregamento ao abrir múltiplos chamados em novas abas.',
          'Destaque visual padronizado em vermelho para atividades canceladas na Programação (Visão Diária e Visão Semanal), dentro dos Chamados e na exportação de relatórios PDF, exibindo badge "[CANCELADA]", categoria e justificativa do cancelamento.',
          'Experiência de visualização de mídia responsiva e adaptada para smartphones e tablets: enquadramento maximizado automático ao tamanho da tela, travamento de scroll de fundo, navegação por arraste horizontal (swipe) e zoom por duplo toque.',
          'Alternador de modo de visualização na barra superior da Programação (Visão Diária vs. Visão Semanal por Colaborador) com barra de chips dos colaboradores selecionados e layout responsivo adaptado para desktop e dispositivos móveis.',
          'Aprimoramento tipográfico e de espaçamento no seletor multi-escolha pesquisável (SearchableMultiSelect), exibindo nome e cargo/meta de colaboradores com quebra de linha fluida sem sobreposição.',
          'Renomeação da seção "Subtarefas & Checklist" para "Tarefas" dentro dos chamados, padronizando a nomenclatura com o restante da plataforma.',
          'Correção definitiva do fluxo de navegação do botão "Voltar ao Kanban" dentro dos chamados, garantindo retorno consistente ao quadro ou lista de chamados sem redirecionamentos indevidos.',
          'Ajuste de layout e responsividade na caixa de opções de filtros da tela de Chamados e nos menus suspensos de seleção múltipla, impedindo que checkboxes e popovers ultrapassem os limites da caixa ou da tela.',
          'Nova tela de carregamento padronizada com identidade visual ATech e pré-visualização aprimorada antes da assinatura do Termo de Finalização.',
        ],
      },
      {
        category: 'Segurança',
        items: [
          'Modal institucional de Política de Privacidade e Conformidade LGPD acessível diretamente na tela de login e no painel.',
          'Controle de cota diária de requisições à API Bulk-Data do Sienge com bloqueio preventivo e rastreabilidade por usuário.',
          'Higienização automática de permissões legadas da página de validação de API.',
        ],
      },
      {
        category: 'Infraestrutura & VPS',
        items: [
          'Migrações 056 a 066 aplicadas: horários parciais em ausências (057), controle de uso diário e snapshots/movimentações Sienge (058–062), arquitetura relacional de tarefas unificadas (063), repositório de documentos de empreendimentos (064), rastreabilidade de cancelamento/remanejamento de programações (065) e controle de snapshots/hashes para sincronização de comentários internos de programação com o CVCRM (066).',
          'Sincronização bidirecional instantânea via Server-Sent Events (LiveSync) ao concluir, editar ou excluir tarefas em qualquer um dos módulos integrados.',
        ],
      },
    ],
  },
  {
    version: 'v2.4.5',
    date: '12/11/2026',
    title: 'Reformulação Completa da UX Mobile & Tablet, Otimização de Kanbans, Filtro por Situação e Reset Administrativo de PIN',
    tagline: 'Experiência mobile reestruturada com Bottom Navigation, visualização de cartões garantida sem cortes, alinhamentos desktop refinados, filtro por situação de chamados e gestão de recuperação de assinatura/PIN.',
    changes: [
      {
        category: 'Design & UX',
        items: [
          'Reformulação completa da arquitetura visual para smartphones e tablets: introdução de Bottom Navigation Bar corporativa, cabeçalhos compactados e eliminação de barras duplas e botões redundantes de menu.',
          'Otimização vertical severa dos quadros Kanban no mobile: painéis de filtros colapsáveis ultracompactos, seletores de etapas deslizáveis com navegação rápida (< / >) e garantia de visibilidade imediata de múltiplos cartões.',
          'Correção definitiva da rolagem e alinhamento do menu lateral no Desktop: tela configurada em altura 100dvh fixa com rolagem interna independente, impedindo vãos brancos ou subida da barra lateral em páginas extensas (Minhas Atividades, Programação, Colaboradores, etc.).',
          'Alinhamento perfeito da barra de filtros da tela de Chamados na Web: controles de ordenação, campos visíveis e exibição de inativos unificados na mesma linha horizontal do botão de filtros.',
          'Eliminação de espaços excessivos e vãos verticais em dispositivos móveis na aba de Processos Jurídicos.',
          'Padronização da nomenclatura do módulo de agenda para "Programação" em todos os pontos da aplicação (menu, barra de navegação e botões).',
          'Quebra de linha e responsividade ajustadas na tela de Início (Equipe em Campo Hoje e Mural & Pessoas) prevenindo descolamento lateral em telas menores.',
        ],
      },
      {
        category: 'Funcionalidade',
        items: [
          'Novo filtro avançado por "Situação" na tela de Chamados: seletor de múltipla escolha pesquisável no frontend integrado com filtragem SQL no backend por ID ou descrição da situação.',
          'Atalhos e módulos restritos por permissão: a vitrine de áreas de trabalho na tela de Início e as buscas rápidas exibem estritamente as páginas autorizadas para o usuário logado, ocultando categorias e cabeçalhos vazios.',
          'Correção na conclusão de programação de encarregados e disponibilidade imediata do download de relatórios em PDF sem necessidade de recarregar a página.',
          'Aprimoramento no upload de imagens em chamados via mobile e permissão de exclusão de anexos.',
        ],
      },
      {
        category: 'Segurança',
        items: [
          'Reset administrativo de PIN e assinatura: recurso exclusivo para administradores na gestão de acessos para recuperação de credenciais de assinatura esquecidas.',
          'Descarte automático e seguro da assinatura prévia e remoção de bloqueios por tentativas incorretas ao executar o reset de PIN.',
          'Registro de log de auditoria automático para cada redefinição de assinatura e PIN realizada (user_signature_pin_reset).',
          'Indicadores visuais de status da credencial ("Cadastrado", "PIN Bloqueado" ou "Não configurado") na tabela de colaboradores.',
        ],
      },
    ],
  },
  {
    version: 'v2.4.4',
    date: '10/11/2026',
    title: 'Submenus, Deep Linking de Dashboards, Blindagem de Alta Concorrência e Máscara Monetária',
    tagline: 'Menu lateral reestruturado em submenus, URLs dedicadas persistentes, proteção contra sobrecarga em VPS, concorrência robusta no backend e formatação financeira inteligente.',
    changes: [
      {
        category: 'Design & UX',
        items: [
          'Reestruturação completa do menu lateral em submenus agrupados (Início, Minhas atividades, Chamados, Processos Jurídicos, Administração e Configurações), com recolhimento animado e persistência no navegador.',
          'Renomeação da seção "Informações" para "Informações de empreendimentos".',
          'Barra de rolagem horizontal personalizada e suave no menu de abas internas dos Processos Jurídicos, com suporte a mouse wheel e flex-shrink, mantendo acesso a todas as seções mesmo com o menu lateral expandido.',
          'Formatação monetária progressiva em tempo real nos campos "Valor da causa" e "Lançamentos financeiros": pontuação automática de milhares, suporte a centavos com vírgula ou teclado numérico (ponto), auto-completar de casas decimais ao sair do campo e sanitização de Ctrl+V.',
          'Atalhos de teclado e seleção automática do valor monetário ao focar no campo para digitação ágil.',
        ],
      },
      {
        category: 'Funcionalidade',
        items: [
          'URLs dedicadas e persistência de navegação (Deep Linking) para o Dashboard de Chamados (?page=tickets&view=dashboard) e Dashboard Jurídico (?page=legal-processes&view=dashboard ou alias ?page=legal-dashboard), preservando a visualização ao recarregar a página e integrando com o histórico do navegador.',
          'Acompanhamento dinâmico de filtros no indicador de Prazo Médio de Finalização do Dashboard de Chamados.',
          'Tabelas de Resumo por Empreendimento e Situações do CVCRM com percentuais relativos calculados automaticamente (peso de clientes/condomínio e representatividade em relação ao total da construtora).',
          'Gráfico de Evolução Mensal exibindo por padrão o ano corrente com recurso interativo de drilldown para seleção e comparação de anos anteriores.',
          'Correção na seleção de permissões de usuários para a tela de "Unidades em estoque" na gestão de acessos.',
          'Controle de visualização de botões sensíveis: botões de "Validação API" e "Sincronizar CV" agora ficam ocultos para usuários não-administradores, prevenindo requisições excessivas ao CVCRM sem bloquear a consulta de chamados.',
        ],
      },
      {
        category: 'Infraestrutura & VPS',
        items: [
          'Resolução definitiva de quedas do backend sob requisições simultâneas: eliminação de chamadas concorrentes client.query em uma mesma conexão física no módulo de atividades pessoais (DeprecationWarning / Unexpected EOF corrigidos).',
          'Remoção de transações e bloqueios de linha exclusivos (BEGIN / SELECT FOR UPDATE) em rotas puramente de consulta, liberando o banco de dados para leituras paralelas sem fila de espera.',
          'Dimensionamento do pool de conexões do PostgreSQL expandido para 40 conexões simultâneas com timeout ampliado para 10 segundos.',
          'Descarte seguro de sockets em erros de streaming SSE (listenerClient.release(true)), garantindo que conexões mortas não retornem ao pool.',
          'Blindagem contra encerramento inesperado do Node.js: registro de listeners globais de uncaughtException, unhandledRejection, pool.on("error") e sessionStore.on("error").',
          'Rate Limiter inteligente por usuário autenticado (resolveClientKey): colaboradores na mesma rede corporativa não consomem mais a cota uns dos outros; cota geral expandida para 5.000 requisições/15min com isenção para rotas de tempo real (SSE) e health check.',
        ],
      },
      {
        category: 'Segurança',
        items: [
          'Priorização rigorosa de credenciais e chaves de API sensíveis via variáveis de ambiente (.env), sem armazenamento indevido de senhas de integração em tabelas do banco.',
          'Controle de ativação/desativação do disparo automático diário de mensagens às 17h.',
        ],
      },
    ],
  },
  {
    version: 'v2.4.3',
    date: '09/11/2026',
    title: 'Integração WhatsApp · Evolution API para Envio de Programações',
    tagline: 'Disparo automático às 17h para o próximo dia útil e botão de envio manual de relatórios em PDF para grupos e encarregados.',
    changes: [
      {
        category: 'Funcionalidade',
        items: [
          'Integração oficial com a Evolution API instalada na VPS como gateway WhatsApp para a Assistência Técnica.',
          'Disparo automático diário às 17h00 (horário de Maceió): envia a programação do próximo dia útil (calculado dinamicamente respeitando feriados e compensações de sábados trabalhados).',
          'Envio da Programação Geral no grupo de WhatsApp de campo através do JID configurado.',
          'Envio da Programação de Encarregados para o número específico de WhatsApp do encarregado.',
          'Botão direto "Gerar e enviar no grupo" / "Gerar e enviar ao encarregado" na barra de ferramentas da agenda diária, permitindo disparo imediato.',
          'Geração do relatório em PDF idêntico no backend anexado como documento com resumo executivo na legenda (total de atividades e colaboradores escalados).',
        ],
      },
      {
        category: 'Design & UX',
        items: [
          'Painel de Configuração do WhatsApp na tela de Administração (Acessos e configurações gerais) com gestão de URL, chave de API, nome da instância, JID do grupo e telefone do encarregado.',
          'Botão "Testar conexão" para verificar em tempo real se a instância do WhatsApp está conectada no Evolution API.',
          'Recurso "Mensagem de teste" para validar entrega em números individuais ou grupos.',
          'Botão com destaque visual e ícones contextuais na barra de agenda para disparo rápido sem sair da tela.',
          'Alertas visuais de feedback com confirmação do destino e relatório gerado.',
        ],
      },
      {
        category: 'Infraestrutura & VPS',
        items: [
          'Suporte a variáveis de ambiente no .env.example (EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE_NAME, EVOLUTION_PROGRAMMING_GROUP_JID, EVOLUTION_FOREMAN_PHONE_NUMBER) com fallback bidirecional com o banco de dados.',
          'Higienização automática de números telefônicos (DDI 55 + DDD) e IDs de grupos (@g.us).',
          'Rotina agendada no backend com trava diária para evitar disparos duplicados.',
          'Registro de log de auditoria detalhado a cada disparo manual ou automático.',
          'Migração 055 para inicialização de configurações do WhatsApp na tabela application_settings.',
        ],
      },
    ],
  },
  {
    version: 'v2.4.2',
    date: '09/11/2026',
    title: 'Módulo de Unidades em Estoque e Checklist de Vistorias',
    tagline: 'Integração completa com API CV CRM para unidades não vendidas, controle de vistorias com fotos e apontamento técnico.',
    changes: [
      {
        category: 'Funcionalidade',
        items: [
          'Nova tela "Unidades em estoque" com sincronização direta via API do Construtor de Vendas (CV CRM) para visualização de apartamentos não vendidos divididos por empreendimento.',
          'Sincronização automática semanal: atualização agendada todas as segundas-feiras às 07h00 da manhã com detecção de alterações de status comercial.',
          'Página e URL vinculadas por unidade (?page=stock-units&unitId=...): ao abrir um apartamento, a visualização foca exclusivamente na página da unidade, atualiza o link da URL (suportando compartilhamento direto e botão Voltar) e oferece botão de cópia rápida do link.',
          'Otimização de recursos nas vistorias: compressão automática de fotos no cliente antes do envio (reduzindo em até 95% o consumo de memória e rede), expansão sob demanda do histórico de laudos e cache imutável de fotos.',
          'Seleção múltipla de obras: seletor com pesquisa, seleção em lote ("Apenas entregues", "Todas") e tags de obras ativas (removido filtro duplicado de abas para manter a interface limpa e focada).',
          'Controle de Situação da Obra ("Obra Finalizada / Concluída" vs "Em Andamento") diretamente na tela de Informações dos Empreendimentos, refletindo instantaneamente como base para identificação de obras entregues no estoque.',
          'Foco em obras entregues: identificação clara de empreendimentos concluídos e filtro rápido para a assistência técnica acompanhar unidades entregues.',
          'Notificações no sistema quando a situação comercial de uma unidade em obra concluída for alterada no CV CRM, permitindo agendar vistorias preventivas com um clique.',
          'Controle e atualização rápida da data da próxima vistoria periódica com predefinições (+30, +60, +90 dias).',
          'Formulário de Cadastro de Vistorias em tela cheia (fullscreen) com barra de rolagem explícita, cobrindo os 8 itens obrigatórios: Esquadrias de madeira, Esquadrias de alumínio, Pisos e Revestimentos, Metais, Louças, Pedras e Granitos, Elétrica e Hidráulica.',
          'Botões deslizantes (switch toggles) para Aprovado / Reprovado em cada item técnico.',
          'Exigência obrigatória de envio de foto(s) e descrição da não conformidade sempre que qualquer item for Reprovado.',
          'Campo geral de anotações "Outros" e identificação do técnico responsável pela inspeção.',
          'Histórico de vistorias com visualizador de fotos em lightbox e exibição do laudo consolidado.',
          'Remoção de dados dispensáveis (valor de avaliação e área total), mantendo o foco exclusivo nas especificações técnicas relevantes.',
        ],
      },
      {
        category: 'Design & UX',
        items: [
          'Tela de vistoria em tela cheia (fullscreen) com cabeçalho e rodapé fixos, contadores ao vivo e rolagem vertical contínua.',
          'Painel moderno e responsivo com KPIs técnicos e destaque visual para obras concluídas.',
          'Badges de situação e cadência de vistoria (em dia, atrasada, pendente, com apontamentos).',
        ],
      },
      {
        category: 'Infraestrutura & VPS',
        items: [
          'Migrações 052 e 053 com tabelas dedicadas: stock_units, unit_inspections, unit_inspection_photos e stock_unit_notifications.',
          'Integração de notificações de estoque com a central de alertas da equipe (sino do topo) e SSE em tempo real.',
        ],
      },
    ],
  },
  {
    version: 'v2.4.1',
    date: '05/11/2026',
    title: 'Expediente & Feriados, Ergonomia em Kanbans e Otimizações',
    tagline: 'Gestão completa de jornada e feriados, bloqueios inteligentes na agenda e navegação responsiva.',
    changes: [
      {
        category: 'Funcionalidade',
        items: [
          'Módulo de Expediente e Calendário no menu de Administração para controle da jornada técnica, feriados e compensações.',
          'Configuração de horas úteis da assistência técnica com expediente diferenciado às sextas-feiras (até às 17h) e sábados compensados.',
          'Importação de feriados em lote por modelo CSV oficial (download de modelo, drag & drop, validação e preview de duplicidades) e cadastro manual rápido.',
          'Cadastro e gestão de sábados trabalhados (compensações) com validação de dias e status Programado/Concluído.',
          'Bloqueio estrito de agendamentos em feriados, domingos e sábados não compensados no backend e no formulário de programação.',
          'Cálculo dinâmico da janela livre compartilhada entre colaboradores considerando horários úteis específicos do dia e exclusão de feriados.',
          'Paginação e enriquecimento de dados no resumo de agendamentos de equipes em campo da Homepage (bloco e unidade exibidos).',
          'Ocultação automática de colunas vazias durante a filtragem de processos jurídicos no Workflow Kanban.',
        ],
      },
      {
        category: 'Design & UX',
        items: [
          'Ergonomia aprimorada dos Kanbans (Chamados, Jurídico e Atividades): visualização garantida de pelo menos um cartão inteiro com filtros abertos e sob diferentes níveis de zoom.',
          'Adaptação vertical fluida dos quadros Kanban ao recolher filtros, eliminando espaços em branco e barras de rolagem desnecessárias.',
          'Destaque visual na régua semanal de Programação para feriados (em vermelho) e sábados de compensação (em verde), acompanhados de avisos explicativos.',
          'Correção de rolagem no modal de controle de versões para telas com nível de zoom elevado.',
        ],
      },
      {
        category: 'Infraestrutura & VPS',
        items: [
          'Migração de banco de dados 051_calendar_and_working_hours.sql com tabelas dedicadas e sincronização de eventos LiveSync via SSE.',
          'Otimização de consultas e índices no banco de dados (050_dashboard_performance_indexes.sql), acelerando o carregamento da Homepage de ~5s para tempos sub-segundo.',
        ],
      },
    ],
  },
  {
    version: 'v2.4.0',
    date: '04/11/2026',
    title: 'Repaginação em Abas, Busca Profunda e Alta Performance',
    tagline: 'Experiência unificada, ergonomia inspirada no Jurídico e controle otimizado para a equipe.',
    changes: [
      {
        category: 'Funcionalidade',
        items: [
          'Design do chamado em abas: Dados & Atendimento, Programação & Tarefas, Comentários & Histórico, Documentos & Termos e Central CVCRM.',
          'Busca por palavras-chave na descrição: pesquisa instantânea em todo o acervo do banco de dados (ativos e inativos).',
          'Chamados finalizados e cancelados integrados ao Workflow Kanban com paginação sob demanda por coluna.',
          'Kanban de Atividades Pessoais repaginado com prioridades (Urgente, Alta, Média, Baixa), checklist interativo com progresso, visão em lista e métricas no topo.',
        ],
      },
      {
        category: 'Segurança',
        items: [
          'Tela dedicada de Auditoria e Logs do Sistema para administradores com filtros por ação, usuário e período.',
          'Rotina automatizada de limpeza periódica de sessões expiradas a cada 24 horas.',
        ],
      },
      {
        category: 'Infraestrutura & VPS',
        items: [
          'Tabela de controle de migrações (schema_migrations) com hash SHA-256 para boot instantâneo dos containers Docker.',
          'Scripts automatizados de backup diário compactado (pg_dump com gzip) e restauração para a VPS.',
        ],
      },
      {
        category: 'Design & UX',
        items: [
          'Aplicação da nova logo oficial AC Engenharia no cabeçalho, tela de login, relatórios em PDF e favicon.',
          'Unificação cromática no padrão Slate & Azul AC Engenharia em toda a plataforma.',
          'Atalho global Ctrl + K para busca rápida de chamados, processos, colaboradores e páginas.',
        ],
      },
    ],
  },
  {
    version: 'v2.3.0',
    date: '03/11/2026',
    title: 'Governança, Trilha de Auditoria e Segurança de Acesso',
    tagline: 'Proteção contra ataques de força bruta, integridade de uploads e unificação de fusos.',
    changes: [
      {
        category: 'Segurança',
        items: [
          'Bloqueio progressivo de conta (Account Lockout) após tentativas consecutivas incorretas.',
          'Validação binária de assinaturas de arquivo (Magic Bytes) para PDFs, PNGs e JPEGs.',
          'Permissão independente para o módulo Preenchimento de Cartas.',
          'Restrição de edição da visibilidade de cargos na Programação exclusiva para administradores.',
        ],
      },
      {
        category: 'Funcionalidade',
        items: [
          'Unificação do sino de notificações integrando chamados técnicos e processos jurídicos.',
          'Card de aniversariantes e tempo de empresa visível na Homepage para todos os colaboradores.',
          'Compressão inteligente de fotos no cliente antes do envio ao servidor.',
          'Padronização de fuso horário America/Maceio em todas as rotinas e consultas.',
        ],
      },
    ],
  },
  {
    version: 'v2.2.0',
    date: '02/11/2026',
    title: 'Processos Jurídicos e Persistência de Filtros',
    tagline: 'Controle de processos jurídicos com salvamento automático e dashboards customizáveis.',
    changes: [
      {
        category: 'Funcionalidade',
        items: [
          'Módulo de Processos Jurídicos com fases, incidentes, anexos, pagamentos e salvamento contínuo.',
          'Formatação automática do Número Único CNJ com validação instantânea.',
          'Filtros de dashboards configuráveis por administradores para contagem de chamados na Homepage.',
          'Deep linking via URL para acesso direto a chamados, processos e colaboradores.',
        ],
      },
      {
        category: 'Design & UX',
        items: [
          'Barra de ações rápidas na Homepage reformulada com foco operacional em consultas.',
          'Pílula de status de salvamento automático no cabeçalho dos processos jurídicos.',
        ],
      },
    ],
  },
  {
    version: 'v2.1.0',
    date: '25/10/2026',
    title: 'Sincronização CVCRM, Prazos de Garantia e Termos',
    tagline: 'Integração contínua com a central do cliente e emissão de termos técnicos.',
    changes: [
      {
        category: 'Funcionalidade',
        items: [
          'Sincronização automatizada a cada 30 minutos com os chamados do CVCRM.',
          'Avaliação automática de prazos de garantia técnica por subassunto e data de entrega.',
          'Geração e protocolo de Termos de Finalização e Notificação em PDF com duas vias.',
        ],
      },
    ],
  },
  {
    version: 'v2.0.0',
    date: '15/10/2026',
    title: 'Lançamento da Plataforma ATech AC Engenharia',
    tagline: 'Sistema corporativo unificado de assistência técnica, colaboradores e estoque.',
    changes: [
      {
        category: 'Segurança',
        items: [
          'Autenticação corporativa integrada com Google Workspace (@aceng.com.br).',
          'Controle granular de permissões por página e por usuário.',
          'Criptografia de dados sensíveis e pessoais (LGPD).',
        ],
      },
      {
        category: 'Funcionalidade',
        items: [
          'Gestão de colaboradores com registro de EPIs, atestados e dependentes.',
          'Programação semanal e diária da equipe de campo.',
          'Gestão de estoque, ferramentas e insumos.',
        ],
      },
    ],
  },
]

