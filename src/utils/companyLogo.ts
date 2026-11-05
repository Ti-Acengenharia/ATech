let cachedLogoDataUrl: string | null = null
let cachedLogoBytes: Uint8Array | null = null

export async function getCompanyLogoDataUrl(): Promise<string | null> {
  if (cachedLogoDataUrl) return cachedLogoDataUrl
  try {
    const response = await fetch('/logo-ac.png', { credentials: 'same-origin' })
    if (!response.ok) return null
    const blob = await response.blob()
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Falha ao ler logo')))
      reader.onerror = () => reject(new Error('Falha ao ler logo'))
      reader.readAsDataURL(blob)
    })
    cachedLogoDataUrl = dataUrl
    return dataUrl
  } catch {
    return null
  }
}

export async function getCompanyLogoBytes(): Promise<Uint8Array | null> {
  if (cachedLogoBytes) return cachedLogoBytes
  try {
    const response = await fetch('/logo-ac.png', { credentials: 'same-origin' })
    if (!response.ok) return null
    const arrayBuffer = await response.arrayBuffer()
    cachedLogoBytes = new Uint8Array(arrayBuffer)
    return cachedLogoBytes
  } catch {
    return null
  }
}

export async function compressImageFileToDataUrl(
  file: File,
  maxDimension = 1400,
  quality = 0.85,
): Promise<{ contentType: string; contentBase64: string; dataUrl: string }> {
  const isImage = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type.toLowerCase())
  if (!isImage || file.size <= 350 * 1024) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Não foi possível ler o arquivo.')))
      reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'))
      reader.readAsDataURL(file)
    })
    return {
      contentType: file.type || 'application/octet-stream',
      contentBase64: dataUrl.split(',')[1] ?? '',
      dataUrl,
    }
  }

  try {
    const bitmap = await createImageBitmap(file)
    let { width, height } = bitmap
    if (width > maxDimension || height > maxDimension) {
      const ratio = Math.min(maxDimension / width, maxDimension / height)
      width = Math.max(1, Math.round(width * ratio))
      height = Math.max(1, Math.round(height * ratio))
    }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      throw new Error('Contexto 2D indisponível')
    }
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()

    const targetType = 'image/webp'
    const dataUrl = canvas.toDataURL(targetType, quality)
    if (dataUrl.startsWith('data:image/webp;base64,')) {
      return {
        contentType: 'image/webp',
        contentBase64: dataUrl.split(',')[1] ?? '',
        dataUrl,
      }
    }
    const jpegUrl = canvas.toDataURL('image/jpeg', quality)
    return {
      contentType: 'image/jpeg',
      contentBase64: jpegUrl.split(',')[1] ?? '',
      dataUrl: jpegUrl,
    }
  } catch {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Não foi possível ler o arquivo.')))
      reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'))
      reader.readAsDataURL(file)
    })
    return {
      contentType: file.type,
      contentBase64: dataUrl.split(',')[1] ?? '',
      dataUrl,
    }
  }
}

