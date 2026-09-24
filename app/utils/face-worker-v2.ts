/* eslint-disable @typescript-eslint/no-explicit-any */
import type * as FaceApi from 'face-api.js'
import onnxruntime from 'onnxruntime-web'
onnxruntime.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';

// Environment configuration
const MODELS_URL = '/models'
const MIN_CONFIDENCE = 0.45

let faceapi: typeof FaceApi
let isLoaded = false
let placesSession: onnxruntime.InferenceSession | null = null
let placesCategories: (string|undefined)[] = []

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
  if (isLoaded) return
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

    console.log('Worker: Loading SSD MobileNet V1...')
    postMessage({
      type: 'LOADING_PROGRESS',
      payload: { message: '顔検出モデルをダウンロード中...' },
    })
    await faceapi.nets.ssdMobilenetv1.loadFromUri(MODELS_URL)

    if (!isLoaded) {
      postMessage({
        type: 'LOADING_PROGRESS',
        payload: { message: '顔認識モデルをダウンロード中...' },
      })
      await faceapi.nets.faceLandmark68Net.loadFromUri(MODELS_URL)
      await faceapi.nets.faceRecognitionNet.loadFromUri(MODELS_URL)
      // Load Expression Net
      await faceapi.nets.faceExpressionNet.loadFromUri(MODELS_URL)
      // Place365 Load
      const modelPath = '/models/place365_resnet18_fp32.onnx'
      const dataPath = '/models/place365_resnet18_fp32.onnx.data'
      
      const [modelRes, dataRes] = await Promise.all([
        fetch(modelPath),
        fetch(dataPath)
      ])
      
      const modelBuffer = await modelRes.arrayBuffer()
      const dataBuffer = new Uint8Array(await dataRes.arrayBuffer())

      placesSession = await onnxruntime.InferenceSession.create(modelBuffer, {
        executionProviders: ['wasm'],
        externalData: [
          {
            path: 'place365_resnet18_fp32.onnx.data',
            data: dataBuffer
          }
        ]
      })
      
      const response = await fetch('/categories_places365.txt')
      const text = await response.text()
      placesCategories = text.trim().split('\n').map(line => line.split(' ')[0])
    }

    isLoaded = true
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
// Scene Detection (Places365)
// ----------------------------------------------------------------------
async function detectScene(imageData: ImageData): Promise<string | undefined> {
  if (!placesSession || placesCategories.length === 0) return undefined

  try {
    // 1. Resize to 244x244
    // We can draw imageData to a canvas to resize it
    const offCanvas = new OffscreenCanvas(244, 244)
    const offCtx = offCanvas.getContext('2d')
    if (!offCtx) return undefined
    
    // Create a temporary canvas with original dimensions to hold imageData
    const origCanvas = new OffscreenCanvas(imageData.width, imageData.height)
    const origCtx = origCanvas.getContext('2d')
    if (!origCtx) return undefined
    origCtx.putImageData(imageData, 0, 0)
    
    // Draw scaled down to 244x244
    offCtx.drawImage(origCanvas, 0, 0, 244, 244)
    const resizedData = offCtx.getImageData(0, 0, 244, 244)

    // 2. Preprocess: RGB, normalize (ImageNet stats)
    const floatData = new Float32Array(3 * 244 * 244)
    const mean = [0.485, 0.456, 0.406]
    const std = [0.229, 0.224, 0.225]
    
    for (let i = 0; i < 244 * 244; i++) {
      const r = resizedData.data[i * 4]! / 255.0
      const g = resizedData.data[i * 4 + 1]! / 255.0
      const b = resizedData.data[i * 4 + 2]! / 255.0
      
      floatData[i] = (r - mean[0]!) / std[0]!
      floatData[i + 244 * 244] = (g - mean[1]!) / std[1]!
      floatData[i + 2 * 244 * 244] = (b - mean[2]!) / std[2]!
    }

    // 3. Inference
    const inputName = placesSession.inputNames[0]!
    const tensor = new onnxruntime.Tensor('float32', floatData, [1, 3, 244, 244])
    const feeds: Record<string, onnxruntime.Tensor> = {}
    feeds[inputName] = tensor
    
    const results = await placesSession.run(feeds)
    
    // 4. Postprocess
    const outputName = placesSession.outputNames[0]!
    const output = results[outputName]!.data as Float32Array
    
    let maxIdx = 0
    let maxVal = -Infinity
    for (let i = 0; i < output.length; i++) {
      if (output[i]! > maxVal) {
        maxVal = output[i]!
        maxIdx = i
      }
    }
    
    return placesCategories[maxIdx]
  } catch (error) {
    console.error('Scene detection failed:', error)
    return undefined
  }
}

// ----------------------------------------------------------------------
// Message Handling
// ----------------------------------------------------------------------

let isProcessingQueue = false
const messageQueue: MessageEvent[] = []

async function processMessage(e: MessageEvent) {
  const { type, payload, id } = e.data

  try {
    if (type === 'INIT') {
      await loadModels()
      postMessage({ type: 'INIT_SUCCESS', id })
    } else if (type === 'DETECT') {
      if (!isLoaded) await loadModels()

      const { imageBitmap } = payload
      console.time(`FaceDetection-${id}`)

      let input: any = imageBitmap
      const width = imageBitmap.width
      const height = imageBitmap.height
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
          } catch (e) {
            console.warn('Failed to get ImageData', e)
          }
        }
      }

      const options = new faceapi.SsdMobilenetv1Options({ minConfidence: MIN_CONFIDENCE })

      // Detect with Expressions
      const detections = await faceapi
        .detectAllFaces(input, options)
        .withFaceLandmarks()
        .withFaceDescriptors()
        .withFaceExpressions()

      console.timeEnd(`FaceDetection-${id}`)
      console.log(
        `Worker: Detected ${detections.length} faces for ${id} using SSD`,
      )

      // Calculate blur score
      const blurScore = imageData ? detectBlur(imageData) : 0
      
      // Calculate scene category
      const sceneCategory = imageData ? await detectScene(imageData) : undefined

      const results = detections.map((d) => {
        // Calculate Pose (Pan/Tilt)
        const nose = d.landmarks.positions[30]
        const leftJaw = d.landmarks.positions[0]
        const rightJaw = d.landmarks.positions[16]

        // Pan: deviations of nose from center of jaws
        const jawWidth = Math.abs(rightJaw!.x - leftJaw!.x)
        const noseX = nose!.x
        const centerX = (leftJaw!.x + rightJaw!.x) / 2
        const pan = (noseX - centerX) / (jawWidth / 2)
        const tilt = 0

        return {
          detection: d.detection.box,
          descriptor: d.descriptor,
          score: d.detection.score,
          smileScore: d.expressions.happy, // 0-1
          panScore: pan,
          tiltScore: tilt,
        }
      })

      postMessage({
        type: 'DETECT_SUCCESS',
        id,
        payload: {
          faces: results,
          blurScore: blurScore,
          sceneCategory: sceneCategory,
          width,
          height,
        },
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

self.onmessage = async (e: MessageEvent) => {
  messageQueue.push(e)
  if (!isProcessingQueue) {
    isProcessingQueue = true
    while (messageQueue.length > 0) {
      const nextEvent = messageQueue.shift()
      if (nextEvent) {
        await processMessage(nextEvent)
      }
    }
    isProcessingQueue = false
  }
}
