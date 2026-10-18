export const mediaMaxBytes = 5 * 1024 * 1024
export const mediaMaxItems = 8
export const mediaUploadUrlSeconds = 300
export const mediaPendingTtlHours = 24
export const mediaHotRetirementGraceHours = 24
export const imageContentTypes = ['image/jpeg', 'image/png', 'image/webp'] as const
export type ImageContentType = (typeof imageContentTypes)[number]

export function isImageContentType(value: unknown): value is ImageContentType {
  return typeof value === 'string' && imageContentTypes.includes(value as ImageContentType)
}

export function validateImageBytes(bytes: Buffer, contentType: ImageContentType): boolean {
  if (bytes.length < 12 || bytes.length > mediaMaxBytes) return false
  switch (contentType) {
    case 'image/jpeg':
      return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 &&
        bytes[2] === 0xff && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9
    case 'image/png':
      return bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    case 'image/webp':
      return bytes.toString('ascii', 0, 4) === 'RIFF' &&
        bytes.toString('ascii', 8, 12) === 'WEBP' &&
        bytes.readUInt32LE(4) + 8 === bytes.length
  }
}
