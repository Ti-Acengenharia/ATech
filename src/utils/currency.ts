/**
 * Utilitários universais de formatação, máscara em tempo real e conversão de valores monetários (BRL - pt-BR).
 */

/**
 * Converte qualquer valor (string formatada com BRL, número, nulo ou indefinido)
 * em um número finito de ponto flutuante em JavaScript, ou null se vazio/inválido.
 *
 * Exemplos:
 *  "1.500,50" -> 1500.5
 *  "1.500"    -> 1500
 *  "1500"     -> 1500
 *  "1500.50"  -> 1500.5
 *  "0,50"     -> 0.5
 *  ""         -> null
 */
export function parseCurrencyToNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null

  const str = String(value).trim().replace(/^R\$\s*/, '')
  if (!str) return null

  // Se contém vírgula, a vírgula é o separador decimal oficial brasileiro
  if (str.includes(',')) {
    const normalized = str.replace(/\./g, '').replace(',', '.')
    const num = parseFloat(normalized)
    return Number.isFinite(num) ? num : null
  }

  // Se não contém vírgula mas contém ponto(s)
  const dotParts = str.split('.')
  if (dotParts.length > 1) {
    const lastPart = dotParts[dotParts.length - 1]
    // Se possui apenas 1 ponto e a última parte tem 1 ou 2 dígitos (ex: 1500.5 ou 1500.50), veio de float
    if (dotParts.length === 2 && lastPart.length > 0 && lastPart.length <= 2) {
      const num = parseFloat(str)
      return Number.isFinite(num) ? num : null
    }
    // Caso contrário são pontos de milhar brasileiros (ex: 1.500 ou 1.500.000)
    const normalized = str.replace(/\./g, '')
    const num = parseFloat(normalized)
    return Number.isFinite(num) ? num : null
  }

  const num = parseFloat(str)
  return Number.isFinite(num) ? num : null
}

/**
 * Máscara dinâmica em tempo real para digitação de moeda.
 * Formata os dígitos inteiros com separadores de milhar (.) progressivamente
 * e permite que o usuário digite vírgula ou ponto para centavos (,xx).
 */
export function formatCurrencyRealtime(raw: string): string {
  if (!raw) return ''
  let trimmed = raw.trim().replace(/^R\$\s*/, '')
  if (!trimmed) return ''

  // Se o usuário digitou ponto no final (ex: numpad), converte para vírgula se não houver vírgula
  if (trimmed.endsWith('.') && !trimmed.includes(',')) {
    trimmed = trimmed.slice(0, -1) + ','
  }

  // Possui vírgula (parte decimal ativa)
  const commaIndex = trimmed.indexOf(',')
  if (commaIndex !== -1) {
    const intRaw = trimmed.slice(0, commaIndex).replace(/\D/g, '')
    const decRaw = trimmed.slice(commaIndex + 1).replace(/\D/g, '').slice(0, 2)
    const intFormatted = intRaw ? Number(intRaw).toLocaleString('pt-BR') : '0'
    return intFormatted + ',' + decRaw
  }

  // Sem vírgula: apenas dígitos inteiros (pontos anteriores são descartados e recalculados)
  const intRaw = trimmed.replace(/\D/g, '')
  if (!intRaw) return ''
  return Number(intRaw).toLocaleString('pt-BR')
}

/**
 * Ao sair do campo (blur), garante que o valor termine com 2 casas decimais formatadas (ex: 1.500 -> 1.500,00).
 */
export function formatCurrencyOnBlur(raw: string): string {
  if (!raw) return ''
  const num = parseCurrencyToNumber(raw)
  if (num === null) return ''
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Formata qualquer valor numérico ou textual para exibição em formato BRL (ex: 15000.00 -> 15.000,00).
 */
export function formatToBrl(value: string | number | null | undefined): string {
  const num = parseCurrencyToNumber(value)
  if (num === null) return ''
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Normaliza valores colados (Ctrl+V) de outras fontes (planilhas, PDFs, CNJ, sites bancários).
 */
export function normalizePastedCurrency(pasted: string): string {
  if (!pasted) return ''
  const num = parseCurrencyToNumber(pasted)
  if (num === null) return ''
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

