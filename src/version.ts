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

export const APP_CURRENT_VERSION = 'v2.4.4'

export const APP_VERSION_HISTORY: VersionRelease[] = [
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

