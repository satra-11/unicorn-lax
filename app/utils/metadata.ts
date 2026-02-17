import ExifReader from 'exifreader'

export interface ImageMetadata {
  timestamp: number
  dateStr: string
}

export async function extractMetadata(file: File): Promise<ImageMetadata> {
  try {
    const tags = await ExifReader.load(file)
    // Standard Exif Date
    let dateStr = tags['DateTimeOriginal']?.description
    if (!dateStr) {
      dateStr = tags['DateTime']?.description
    }

    let timestamp = 0
    if (dateStr) {
      // Exif date format is usually "YYYY:MM:DD HH:MM:SS"
      // Convert to "YYYY-MM-DD HH:MM:SS" for Date.parse
      const isoStr = dateStr.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')
      timestamp = Date.parse(isoStr)
    }

    // Fallback to file last modified if no EXIF
    if (isNaN(timestamp) || timestamp === 0) {
      timestamp = file.lastModified
      dateStr = new Date(file.lastModified).toISOString()
    }

    return {
      timestamp,
      dateStr: dateStr || new Date(timestamp).toISOString(),
    }
  } catch (e) {
    console.warn('Failed to read EXIF', e)
    return {
      timestamp: file.lastModified,
      dateStr: new Date(file.lastModified).toISOString(),
    }
  }
}

export async function calculateHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  return hashHex
}
