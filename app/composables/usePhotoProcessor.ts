import { ref } from 'vue';
import type { Photo, ProcessingSession } from '~/utils/types';
import { extractMetadata, calculateHash } from '~/utils/metadata';
import { savePhoto, saveSession, getPhotoByHash } from '~/utils/db';

// Singleton State
const isProcessing = ref(false);
const progress = ref(0);
const total = ref(0);
const currentSession = ref<ProcessingSession | null>(null);

let worker: Worker | null = null;
const pendingRequests = new Map<string, { resolve: (val: any) => void, reject: (err: any) => void }>();

const initWorker = () => {
    if (worker) return;
    try {
        console.log('Initializing worker...');
        // Use relative path for worker to avoid alias issues in some environments,
        // or rely on Vite's efficient handling.
        // Assuming utils is alias '~', but specific to build setup.
        // Best to use relative path if possible: '../utils/face-worker.ts'
        worker = new Worker(new URL('../utils/face-worker-v2.ts', import.meta.url), { type: 'module' });

        worker.onmessage = (e) => {
            console.log('Worker message received:', e.data.type);
            const { type, id, payload, error } = e.data;
            if (type === 'INIT_SUCCESS') {
                console.log('Worker initialized successfully');
            } else if (type === 'DETECT_SUCCESS') {
                const req = pendingRequests.get(id);
                if (req) {
                    req.resolve(payload);
                    pendingRequests.delete(id);
                }
            } else if (type === 'ERROR') {
                console.error('Worker reported error:', error);
                const req = pendingRequests.get(id);
                if (req) {
                    req.reject(error);
                    pendingRequests.delete(id);
                } else {
                    console.error('Worker error (unhandled request):', error);
                }
            }
        };

        worker.onerror = (e) => {
            console.error('Worker error event:', e);
        };

        console.log('Sending INIT message to worker');
        worker.postMessage({ type: 'INIT', id: 'init' });
    } catch (e) {
        console.error('Failed to init worker', e);
    }
};

const detectFacesInWorker = async (photoId: string, imageBitmap: ImageBitmap) => {
    if (!worker) return [];
    return new Promise<any>((resolve, reject) => {
        pendingRequests.set(photoId, { resolve, reject });
        worker!.postMessage({ type: 'DETECT', id: photoId, payload: { imageBitmap } }, [imageBitmap]);
    });
};

export const usePhotoProcessor = () => {
  const processFiles = async (files: FileList | File[]) => {
    if (isProcessing.value) return;
    initWorker();
    
    // ... (rest of logic similar, updated for faces)
    const fileArray = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (fileArray.length === 0) return;

    isProcessing.value = true;
    total.value = fileArray.length;
    progress.value = 0;

    const sessionId = `session-${Date.now()}`;
    const session: ProcessingSession = {
      id: sessionId,
      folderName: (files[0] as any).webkitRelativePath?.split('/')[0] || 'Generic Upload',
      totalFiles: fileArray.length,
      processedCount: 0,
      status: 'processing',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    currentSession.value = session;
    await saveSession(session);

    const BATCH_SIZE = 5;
    
    for (let i = 0; i < fileArray.length; i += BATCH_SIZE) {
        const batch = fileArray.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (file) => {
            try {
                const meta = await extractMetadata(file); // This might consume the file stream?
                const hash = await calculateHash(file);
                
                // Check for duplicates
                const existing = await getPhotoByHash(hash);
                if (existing) {
                    if (existing.sessionId === sessionId) {
                         console.log('Skipping duplicate photo in same session:', file.name);
                         progress.value++; 
                         return; 
                    } else {
                        console.log('Found existing photo from previous session, reusing data:', file.name);
                        // Reuse existing analysis data but create new photo record for this session
                         const reusedPhoto: Photo = {
                            ...existing,
                            id: crypto.randomUUID(),
                            sessionId,
                            name: file.name, // Use current file name just in case
                            relativePath: (file as any).webkitRelativePath || file.name,
                            // Ensure we keep the hash
                            hash,
                        };
                        await savePhoto(reusedPhoto);
                        progress.value++;
                        return;
                    }
                }

                const photo: Photo = {
                    id: crypto.randomUUID(),
                    sessionId,
                    name: file.name,
                    relativePath: (file as any).webkitRelativePath || file.name,
                    timestamp: meta.timestamp,
                    dateStr: meta.dateStr,
                    hash,
                };

                if (worker) {
                    // Create bitmap from the File directly. 
                    // Note: If extractMetadata reads the file, it shouldn't affect subsequent reads if it's a File/Blob (which are immutable/reusable).
                    // However, let's be safe.
                    let bitmap: ImageBitmap | undefined;
                    try {
                         bitmap = await createImageBitmap(file);
                    } catch (err) {
                        console.error('Failed to create bitmap for', file.name, err);
                    }

                    if (bitmap) {
                        const detectionResult = await detectFacesInWorker(photo.id, bitmap);
                        // NOTE: bitmap is now neutered (transferred to worker), cannot be used for drawing.
                    
                        if (detectionResult && detectionResult.length > 0) {
                            // Create a FRESH bitmap from the file for thumbnail cropping
                            let cropBitmap: ImageBitmap | undefined;
                            try {
                                cropBitmap = await createImageBitmap(file);
                            } catch (err) {
                                console.warn('Failed to create crop bitmap for', file.name, err);
                            }

                            photo.faces = await Promise.all(detectionResult.map(async (face: any) => {
                                let blob: Blob | undefined;
                                if (cropBitmap) {
                                    try {
                                        const { _x, _y, _width, _height } = face.detection;
                                        const x = _x ?? face.detection.x ?? 0;
                                        const y = _y ?? face.detection.y ?? 0;
                                        const width = _width ?? face.detection.width ?? 0;
                                        const height = _height ?? face.detection.height ?? 0;
                                        const size = Math.max(width, height);
                                        const canvas = new OffscreenCanvas(size, size);
                                        const ctx = canvas.getContext('2d');
                                        if (ctx) {
                                            ctx.drawImage(cropBitmap, x, y, width, height, 0, 0, size, size);
                                            blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
                                        }
                                    } catch (err) {
                                        console.warn('Failed to create thumbnail', err);
                                    }
                                }
    
                                return {
                                    descriptor: face.descriptor,
                                    box: face.detection,
                                    thumbnail: blob
                                };
                            }));
                            
                            // Close the crop bitmap
                            cropBitmap?.close();
                        }
                    }
                }

                // Generate full-photo thumbnail for preview
                try {
                    const thumbBitmap = await createImageBitmap(file);
                    const MAX_THUMB = 320;
                    const scale = Math.min(MAX_THUMB / thumbBitmap.width, MAX_THUMB / thumbBitmap.height, 1);
                    const tw = Math.round(thumbBitmap.width * scale);
                    const th = Math.round(thumbBitmap.height * scale);
                    const canvas = new OffscreenCanvas(tw, th);
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        ctx.drawImage(thumbBitmap, 0, 0, tw, th);
                        photo.thumbnail = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
                    }
                    thumbBitmap.close();
                } catch (err) {
                    console.warn('Failed to create photo thumbnail for', file.name, err);
                }

                await savePhoto(photo);
                progress.value++;
            } catch (e) {
                console.error('Error processing file', file.name, e);
            }
        }));
        
        session.processedCount = progress.value;
        session.updatedAt = Date.now();
        await saveSession(session);
    }
    
    isProcessing.value = false;
    session.status = 'completed';
    await saveSession(session);
    
    // Explicitly update currentSession to trigger watchers if needed (though nested property change might need deep watch or re-assignment)
    currentSession.value = { ...session };
  };

  return {
    processFiles,
    isProcessing,
    progress,
    total,
    currentSession
  };
};
