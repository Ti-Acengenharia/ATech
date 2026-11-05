const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export function detectBinaryMimeType(buffer: Buffer): 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (buffer.length < 4) return null

  // PDF: %PDF- (0x25 0x50 0x44 0x46 0x2D)
  if (
    buffer.length >= 5 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d
  ) {
    return 'application/pdf'
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    PNG_SIGNATURE.every((byte, index) => buffer[index] === byte)
  ) {
    return 'image/png'
  }

  // JPEG: FF D8 FF
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'image/jpeg'
  }

  // WEBP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }

  return null
}

export function validateBinaryFileSignature(
  buffer: Buffer,
  declaredMimeType: string,
  allowedMimeTypes: readonly string[],
): { valid: boolean; detectedMimeType: string | null } {
  const detectedMimeType = detectBinaryMimeType(buffer)
  if (!detectedMimeType) {
    return { valid: false, detectedMimeType: null }
  }
  const normalizedDeclared = declaredMimeType.trim().toLowerCase()
  const isAllowed = allowedMimeTypes.includes(detectedMimeType)
  const matchesDeclared = normalizedDeclared === detectedMimeType
  return {
    valid: isAllowed && matchesDeclared,
    detectedMimeType,
  }
}

