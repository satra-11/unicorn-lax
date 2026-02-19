/* eslint-disable @typescript-eslint/no-explicit-any */
import type * as FaceApi from 'face-api.js'

// Environment configuration
const MODELS_URL = '/models'
const MIN_CONFIDENCE = 0.45

// NEW: Configuration to easily switch between models
let useSsdMobilenetv1 = true
let currentModelLoaded = false

let faceapi: typeof FaceApi
let isLoaded = false

// ----------------------------------------------------------------------
// Polyfill Environment BEFORE importing face-api.js
// ----------------------------------------------------------------------
// face-api.js (tfjs-core) strict checks for 'window', 'document', 'screen'
// to determine browser environment. in WebWorker, these are partial or missing.

const canvasPolyfill = typeof OffscreenCanvas !== 'undefined' ? OffscreenCanvas : class {}

// CanvasRenderingContext2D check is REQUIRED by face-api.js isBrowser().
// In workers, OffscreenCanvasRenderingContext2D exists but not CanvasRenderingContext2D.
if (typeof (self as any).CanvasRenderingContext2D === 'undefined') {
  // Use OffscreenCanvasRenderingContext2D if available, otherwise a dummy class
  ;(self as any).CanvasRenderingContext2D =
    typeof OffscreenCanvasRenderingContext2D !== 'undefined'
      ? OffscreenCanvasRenderingContext2D
      : class {}
}

// 0. Nullify process to prevent Node.js detection
if (typeof (self as any).process !== 'undefined') {
  ;(self as any).process = undefined
}

// 0.1 Polyfill global (critical for some libraries checking global vs self)
if (typeof (self as any).global === 'undefined') {
  ;(self as any).global = self
}

// 1. Basic Globals
if (typeof (self as any).window === 'undefined') {
  ;(self as any).window = self
}
if (typeof (self as any).document === 'undefined') {
  ;(self as any).document = {
    createElement: (tag: string) => {
      if (tag === 'canvas') return new (canvasPolyfill as any)(1, 1)
      if (tag === 'img') return new (self as any).Image()
      return { style: {}, setAttribute: () => {} }
    },
    documentElement: { style: {} },
    head: { appendChild: () => {}, removeChild: () => {} },
    body: { style: {} },
    location: self.location,
  }
}
if (typeof (self as any).HTMLImageElement === 'undefined') {
  ;(self as any).HTMLImageElement = (self as any).Image || class {}
}
if (typeof (self as any).HTMLCanvasElement === 'undefined') {
  ;(self as any).HTMLCanvasElement = canvasPolyfill
}
if (typeof (self as any).HTMLVideoElement === 'undefined') {
  ;(self as any).HTMLVideoElement = class {}
}
if (typeof (self as any).HTMLElement === 'undefined') {
  ;(self as any).HTMLElement = class {}
}
if (typeof (self as any).screen === 'undefined') {
  ;(self as any).screen = { width: 1920, height: 1080 }
}
// Model Loading & Initialization
// ----------------------------------------------------------------------

async function loadModels() {
  if (isLoaded && currentModelLoaded) return
  console.log('Worker: Loading face-api.js...')

  try {
    if (!faceapi) {
      // Import face-api.js only AFTER polyfills are set
      postMessage({
        type: 'LOADING_PROGRESS',
        payload: { message: 'AIエンジンを読み込んでいます...' },
      })
      faceapi = await import('face-api.js')
      console.log('Worker: face-api.js imported. Loading models...')

      // Environment setup (same as before)
      try {
        const testEnv = faceapi.env.getEnv()
        console.log('Worker: Environment already initialized:', !!testEnv)
      } catch {
        console.log('Worker: Environment not initialized, calling setEnv() directly...')
        const CanvasClass = canvasPolyfill as any
        const ImageClass = (self as any).HTMLImageElement
        faceapi.env.setEnv({
          Canvas: CanvasClass,
          CanvasRenderingContext2D: (self as any).CanvasRenderingContext2D,
          Image: ImageClass,
          ImageData: ImageData,
          Video: (self as any).HTMLVideoElement,
          createCanvasElement: () => new CanvasClass(1, 1),
          createImageElement: () => new ImageClass(),
          fetch: self.fetch.bind(self),
          readFile: () => {
            throw new Error('readFile not available in worker')
          },
        } as any)
      }
    }

    if (useSsdMobilenetv1) {
      console.log('Worker: Loading SSD MobileNet V1...')
      postMessage({
        type: 'LOADING_PROGRESS',
        payload: { message: '顔検出モデルをダウンロード中...' },
      })
      await faceapi.nets.ssdMobilenetv1.loadFromUri(MODELS_URL)
    } else {
      console.log('Worker: Loading TinyFaceDetector...')
      postMessage({
        type: 'LOADING_PROGRESS',
        payload: { message: '顔検出モデルをダウンロード中...' },
      })
      await faceapi.nets.tinyFaceDetector.loadFromUri(MODELS_URL + '/tiny_face_detector')
    }

    if (!isLoaded) {
      postMessage({
        type: 'LOADING_PROGRESS',
        payload: { message: '顔認識モデルをダウンロード中...' },
      })
      await faceapi.nets.faceLandmark68Net.loadFromUri(MODELS_URL)
      await faceapi.nets.faceRecognitionNet.loadFromUri(MODELS_URL)
      // Load Expression Net
      await faceapi.nets.faceExpressionNet.loadFromUri(MODELS_URL)
    }

    isLoaded = true
    currentModelLoaded = true
    postMessage({ type: 'LOADING_PROGRESS', payload: { message: '' } })
    console.log('Worker: Models loaded successfully.')
  } catch (error) {
    console.error('Worker: Failed to load models:', error)
    throw error
  }
}

// ----------------------------------------------------------------------
// Blur Detection (Laplacian Variance)
// ----------------------------------------------------------------------
function detectBlur(imageData: ImageData): number {
  try {
    const { data, width, height } = imageData
    // Grayscale
    const gray = new Uint8Array(width * height)
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!
      const g = data[i + 1]!
      const b = data[i + 2]!
      gray[i / 4] = 0.299 * r + 0.587 * g + 0.114 * b
    }

    // Laplacian Kernel
    // [0,  1, 0]
    // [1, -4, 1]
    // [0,  1, 0]
    let mean = 0
    let count = 0
    const laplacian = new Float32Array(width * height)

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x
        const val =
          gray[idx - width]! + // top
          gray[idx - 1]! + // left
          gray[idx + 1]! + // right
          gray[idx + width]! + // bottom
          -4 * gray[idx]! // center

        laplacian[idx] = val
        mean += val
        count++
      }
    }
    mean /= count

    let variance = 0
    for (let i = 0; i < laplacian.length; i++) {
        // Only count inner pixels to match mean calculation context
        // Simplified: iterate all, edge effect is minimal for large images
        // For strict correctness we should iterate same loop, but this is fast approx
        const diff = laplacian[i]! - mean
        variance += diff * diff
    }
    variance /= count

    // Normalize: Variance usually ranges 0-500+ for sharp images.
    // Heuristic: < 100 is blurry, > 300 is sharp.
    // Map to 0-1 score.
    const score = Math.min(Math.max((variance - 50) / 300, 0), 1)
    return score
  } catch (e) {
    console.error('Blur detection failed', e)
    return 0.5 // Default to neutral
  }
}

// ----------------------------------------------------------------------
// Message Handling
// ----------------------------------------------------------------------

self.onmessage = async (e: MessageEvent) => {
  const { type, payload, id } = e.data

  try {
    if (type === 'INIT') {
      if (payload && typeof payload.useSsd !== 'undefined') {
        useSsdMobilenetv1 = payload.useSsd
      }
      await loadModels()
      postMessage({ type: 'INIT_SUCCESS', id })
    } else if (type === 'SET_MODEL') {
      const newUseSsd = payload.useSsd
      if (newUseSsd !== useSsdMobilenetv1) {
        useSsdMobilenetv1 = newUseSsd
        currentModelLoaded = false // Force reload of detector
        await loadModels()
      }
      postMessage({ type: 'SET_MODEL_SUCCESS', id })
    } else if (type === 'DETECT') {
      if (!isLoaded || !currentModelLoaded) await loadModels()

      const { imageBitmap } = payload
      console.time(`FaceDetection-${id}`)

      let input: any = imageBitmap
      let width = imageBitmap.width
      let height = imageBitmap.height
      let imageData: ImageData | null = null

      if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height)
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(imageBitmap, 0, 0)
          input = canvas
          // Get ImageData for blur detection
          try {
             imageData = ctx.getImageData(0, 0, width, height)
          } catch(e) {
             console.warn('Failed to get ImageData', e)
          }
        }
      }

      let options: FaceApi.SsdMobilenetv1Options | FaceApi.TinyFaceDetectorOptions

      if (useSsdMobilenetv1) {
        options = new faceapi.SsdMobilenetv1Options({ minConfidence: MIN_CONFIDENCE })
      } else {
        options = new faceapi.TinyFaceDetectorOptions({
          inputSize: 512,
          scoreThreshold: MIN_CONFIDENCE,
        })
      }

      // Detect with Expressions
      const detections = await faceapi
        .detectAllFaces(input, options)
        .withFaceLandmarks()
        .withFaceDescriptors()
        .withFaceExpressions()

      console.timeEnd(`FaceDetection-${id}`)
      console.log(
        `Worker: Detected ${detections.length} faces for ${id} using ${useSsdMobilenetv1 ? 'SSD' : 'Tiny'}`,
      )

      // Calculate blur score
      const blurScore = imageData ? detectBlur(imageData) : 0

      const results = detections.map((d) => {
        // Calculate Pose (Pan/Tilt)
        // Simple heuristic using nose and eye/jaw landmarks
        // Not perfect but sufficient for "looking at camera" check
        // Ideally use PnP algorithm but that requires 3D model reference
        
        // face-api.js returns 68 points
        // 30: Nose tip
        // 0: Left jaw (actually right side of image)
        // 16: Right jaw (left side of image)
        // 27: Nose root (between eyes)
        // 8: Chin
        
        const nose = d.landmarks.positions[30]
        const leftJaw = d.landmarks.positions[0]
        const rightJaw = d.landmarks.positions[16]
        
        // Pan: deviations of nose from center of jaws
        const jawWidth = Math.abs(rightJaw!.x - leftJaw!.x)
        const noseX = nose!.x
        const centerX = (leftJaw!.x + rightJaw!.x) / 2
        // If nose is to the right of center (in image), they are looking right
        // Normalize by jaw width/2
        const pan = (noseX - centerX) / (jawWidth / 2) 
        // pan 0 = front, -1 = left, 1 = right (approx)
        
        // Tilt: nose length ratio? Or simple "is nose explicitly high/low"
        // Just return 0 for now or simple heuristic if needed. 
        // Let's rely on Pan mostly for "looking away".
        const tilt = 0 

        return {
          detection: d.detection.box,
          descriptor: d.descriptor,
          score: d.detection.score,
          smileScore: d.expressions.happy, // 0-1
          panScore: pan,
          tiltScore: tilt
        } 
      })

      postMessage({ 
          type: 'DETECT_SUCCESS', 
          id, 
          payload: {
              faces: results,
              blurScore: blurScore,
              width,
              height
          }
      })

      if (imageBitmap && typeof (imageBitmap as any).close === 'function') {
        ;(imageBitmap as ImageBitmap).close()
      }
    }
  } catch (err: any) {
    console.error('Worker Error:', err)
    postMessage({ type: 'ERROR', id, error: err.message || err.toString() })
  }
}
