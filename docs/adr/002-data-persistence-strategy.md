# ADR 001: Face Recognition Model Selection

## Status

Accepted

## Date

2026-02-16

## Context

The application is a client-side photo selection tool that helps users select photos of their children from a large set (up to 10,000 photos).
The key requirements are:

1.  **Privacy**: Photos must not be uploaded to a server. Processing must happen locally.
2.  **Performance**: Must be able to process thousands of photos in a reasonable time.
3.  **Functionality**: Needs to detect faces and finding "similar" faces to group them (Clustering) without prior training data (Unsupervised / Semi-supervised).
4.  **Cost**: Should be free to operate (no per-API-call costs).

## Decision

We have decided to use **face-api.js** running in a Web Worker.

### Specific Models

- **Detector**: `TinyFaceDetector` (MobileNetV1 based)
  - Chosen for speed and smaller memory footprint compared to SSD MobileNet V1, which allows for faster processing of large batches of images in the browser.
- **Landmarks**: `FaceLandmark68Net` (or `FaceLandmark68TinyNet`)
  - Required for alignment before recognition.
- **Recognition**: `FaceRecognitionNet` (ResNet-34 based)
  - Outputs a 128-dimensional feature vector (descriptor) for each face.

## Rationale

1.  **Client-Side Execution**: face-api.js is built on top of TensorFlow.js and is optimized for running in the browser. It supports WebGL acceleration and WebAssembly (WASM) backends, making it viable for heavy client-side processing.
2.  **All-in-One Solution**: It provides a unified API for Detection -> Alignment -> Feature Extraction -> Recognition. Alternatives often require piecing together different libraries for these steps.
3.  **Accuracy vs. Speed Balance**: The `TinyFaceDetector` offers a good trade-off. While less accurate than heavy server-side models, it is sufficient for "grouping" photos of clearly visible faces in a personal album context.
4.  **Ease of Use**: The API is high-level and easy to integrate into a Vue/Nuxt application.
5.  **Offline Capability**: Once models are loaded, no internet connection is required.

## Alternatives Considered

### 1. Cloud APIs (Google Cloud Vision, AWS Rekognition, Azure Face)

- **Pros**: Extremely high accuracy, no burden on client device.
- **Cons**:
  - **Privacy concerns**: Users are uncomfortable uploading all personal photos.
  - **Cost**: expensive for 10,000+ photos.
  - **Latency**: Uploading gigabytes of photos takes too long.
- **Verdict**: Rejected due to privacy and bandwidth constraints.

### 2. OpenCV.js (Haar Cascades / LBP)

- **Pros**: Lightweight, standard library.
- **Cons**:
  - Traditional methods (Haar/LBP) are significantly less robust to lighting and angles than Deep Learning models.
  - Does not provide a high-quality 128d face descriptor for clustering out-of-the-box.
- **Verdict**: Rejected due to lower accuracy and lack of modern recognition features.

### 3. MediaPipe Face Detection (Google)

- **Pros**: Very fast, lightweight, modern.
- **Cons**:
  - Originally focused more on landmarks (Face Mesh) and detection.
  - Getting a robust "Face Recognition" descriptor (for identity matching) is less straightforward than face-api.js which has a dedicated ResNet-34 model for it.
- **Verdict**: Rejected for now, but valid as a future optimization candidate if face-api.js performance becomes a bottleneck.

## Consequences

- **Initial Load**: The user must download model weights (~10MB) on first load.
- **Device Dependency**: Processing speed depends heavily on the user's GPU/CPU. Old phones/laptops may be slow.
- **Memory Usage**: Loading models and processing images consumes significant RAM. We must use a Web Worker and manage memory (disposing tensors) carefully to prevent browser crashes.
