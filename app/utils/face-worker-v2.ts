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
      if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height)
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(imageBitmap, 0, 0)
          input = canvas
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

      const detections = await faceapi
        .detectAllFaces(input, options)
        .withFaceLandmarks()
        .withFaceDescriptors()

      console.timeEnd(`FaceDetection-${id}`)
      console.log(
        `Worker: Detected ${detections.length} faces for ${id} using ${useSsdMobilenetv1 ? 'SSD' : 'Tiny'}`,
      )

      const results = detections.map((d) => ({
        detection: d.detection.box,
        descriptor: d.descriptor,
      }))

      postMessage({ type: 'DETECT_SUCCESS', id, payload: results })

      if (imageBitmap && typeof (imageBitmap as any).close === 'function') {
        ;(imageBitmap as ImageBitmap).close()
      }
    }
  } catch (err: any) {
    console.error('Worker Error:', err)
    postMessage({ type: 'ERROR', id, error: err.message || err.toString() })
  }
}
