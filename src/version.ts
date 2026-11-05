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

export const APP_CURRENT_VERSION = 'v2.4.1'

export const APP_VERSION_HISTORY: VersionRelease[] = [
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

