import { FileText, Lock, ShieldCheck, UserCheck, X } from 'lucide-react'
import './PrivacyPolicyModal.css'

export interface PrivacyPolicyModalProps {
  onClose: () => void
}

export default function PrivacyPolicyModal({ onClose }: PrivacyPolicyModalProps) {
  return (
    <div
      className="privacy-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-modal-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="privacy-modal-card">
        <header className="privacy-modal-header">
          <div className="privacy-header-brand">
            <span className="privacy-shield-icon">
              <ShieldCheck size={22} />
            </span>
            <div>
              <span className="eyebrow">CONFORMIDADE LGPD · LEI 13.709/2018</span>
              <h2 id="privacy-modal-title">Política de Privacidade & Proteção de Dados</h2>
            </div>
          </div>
          <button type="button" className="icon-button privacy-close-btn" onClick={onClose} aria-label="Fechar política de privacidade">
            <X size={18} />
          </button>
        </header>

        <div className="privacy-modal-body">
          <section className="privacy-section">
            <div className="privacy-badge-pill">
              <Lock size={13} />
              <span>Ambiente Seguro Corporativo · AC Engenharia & ATech</span>
            </div>
            <p>
              A <strong>AC Engenharia</strong> compromete-se com a privacidade, confidencialidade e segurança
              dos dados pessoais tratados na plataforma operacional <strong>ATech</strong>, em estrita conformidade com a
              <strong> Lei Geral de Proteção de Dados Pessoais (LGPD - Lei nº 13.709/2018)</strong> e o Marco Civil da Internet.
            </p>
          </section>

          <section className="privacy-section">
            <h3>1. Controlador dos Dados</h3>
            <p>
              O controlador dos dados pessoais tratados nesta plataforma é a <strong>AC Engenharia</strong>, responsável pelas
              decisões referentes ao tratamento de dados no âmbito das operações de construção civil, assistência técnica e gestão de equipe.
            </p>
          </section>

          <section className="privacy-section">
            <h3>2. Dados Coletados e Finalidades do Tratamento</h3>
            <div className="privacy-grid">
              <article className="privacy-item-card">
                <h4><UserCheck size={16} /> Colaboradores e Equipe Técnica</h4>
                <ul>
                  <li><strong>Dados cadastrais:</strong> Nome, cargo, matrícula, data de nascimento e telefone funcional.</li>
                  <li><strong>Finalidade:</strong> Execução do contrato de trabalho, comunicação operacional e escala de vistorias técnicas.</li>
                  <li><strong>Tamanhos de uniforme e EPIs:</strong> Gestão de estoque, fornecimento obrigatório e segurança do trabalho.</li>
                  <li><strong>Dependentes/Filhos:</strong> Administração de benefícios corporativos e cumprimento de obrigações legais.</li>
                </ul>
              </article>

              <article className="privacy-item-card">
                <h4><FileText size={16} /> Clientes e Empreendimentos</h4>
                <ul>
                  <li><strong>Dados de atendimento (CVCRM):</strong> Nome do adquirente, e-mail, telefone, empreendimento, bloco e unidade.</li>
                  <li><strong>Finalidade:</strong> Agendamento de vistorias, execução de reparos contratuais de garantia e comunicação com o cliente.</li>
                  <li><strong>Histórico de chamados:</strong> Registro técnico do histórico do imóvel para controle de garantia quinquenal.</li>
                </ul>
              </article>
            </div>
          </section>

          <section className="privacy-section">
            <h3>3. Tratamento de Dados Pessoais Sensíveis</h3>
            <p>
              O sistema trata dados sensíveis sob rigoroso controle de acesso e bases legais específicas (Art. 11 da LGPD):
            </p>
            <ul>
              <li><strong>Atestados Médicos e CIDs:</strong> Utilizados exclusivamente para cumprimento de obrigação legal e regulatória trabalhista/previdenciária (abono de faltas, e-Social e afastamentos). O acesso é restrito ao departamento de Recursos Humanos e Administração.</li>
              <li><strong>Assinaturas Digitais em Tela:</strong> Coletadas para comprovação de entrega de materiais, EPIs e termos de encerramento de chamado técnico, constituindo evidência jurídica de execução.</li>
            </ul>
          </section>

          <section className="privacy-section">
            <h3>4. Medidas de Segurança da Informação</h3>
            <ul>
              <li><strong>Criptografia em Repouso (AES-256-GCM):</strong> Dados confidenciais de pessoas físicas (CPF, telefone, datas de nascimento e assinaturas) são gravados com chave criptográfica robusta no banco de dados.</li>
              <li><strong>Comunicação Criptografada (HTTPS/TLS):</strong> Todo o tráfego de dados entre o navegador e o servidor é protegido com criptografia de ponta a ponta e certificados digitais seguros.</li>
              <li><strong>Autenticação Segura & Sessões:</strong> Acesso autenticado via Google Workspace corporativo (@acengenharia.com.br) ou credenciais administrativas com proteção contra força bruta e tempo de expiração automática.</li>
              <li><strong>Trilha de Auditoria (Logs):</strong> Acessos a relatórios com dados pessoais e modificações cadastrais são registrados com identificação do usuário e data/hora.</li>
            </ul>
          </section>

          <section className="privacy-section">
            <h3>5. Compartilhamento de Dados</h3>
            <p>
              A AC Engenharia <strong>não comercializa nem compartilha</strong> dados pessoais com terceiros para fins de marketing.
              O acesso aos dados é restrito a colaboradores autorizados com base em perfis de permissão estritamente necessários para o desempenho de suas funções operacionais.
            </p>
          </section>

          <section className="privacy-section">
            <h3>6. Direitos do Titular (Art. 18 da LGPD)</h3>
            <p>
              Os titulares de dados pessoais possuem o direito de solicitar a qualquer momento:
            </p>
            <ol>
              <li>Confirmação da existência de tratamento dos seus dados;</li>
              <li>Acesso aos dados pessoais armazenados;</li>
              <li>Correção de dados incompletos, inexatos ou desatualizados;</li>
              <li>Informações sobre as entidades públicas e privadas com as quais o controlador compartilhou dados.</li>
            </ol>
          </section>

          <section className="privacy-section">
            <h3>7. Canal de Contato com o Encarregado (DPO)</h3>
            <p>
              Para esclarecer dúvidas sobre esta política ou exercer seus direitos de titular, entre em contato com a equipe de Administração e Segurança da Informação pelo e-mail institucional corporativo da <strong>AC Engenharia</strong>.
            </p>
          </section>
        </div>

        <footer className="privacy-modal-footer">
          <span className="privacy-footer-note">Última atualização: Novembro de 2026 · Versão 1.0</span>
          <button type="button" className="primary-button" onClick={onClose}>
            Entendido e concordo
          </button>
        </footer>
      </div>
    </div>
  )
}

