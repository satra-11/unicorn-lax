<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';

const logs = ref<string[]>([]);
const status = ref('Idle');
const testImageSrc = '/images/child1.png'; // Assuming this exists from previous step
let worker: Worker | null = null;
const isWorkerReady = ref(false);

const addLog = (msg: string) => {
    logs.value.push(`${new Date().toISOString().slice(11, 23)} - ${msg}`);
};

const initWorker = () => {
    if (worker) {
        worker.terminate();
        worker = null;
        isWorkerReady.value = false;
    }
    
    status.value = 'Initializing Worker...';
    addLog('Creating new Worker instance...');

    try {
        // Correctly reference the worker file. 
        // In Nuxt/Vite, we can often import workers directly with ?worker suffix or use new Worker() with URL.
        // Let's try the URL constructor method which is standard.
        // We'll point to the exact same file usePhotoProcessor uses to replicate environment.
        worker = new Worker(new URL('../utils/face-worker-v2.ts', import.meta.url), { type: 'module' });
        
        worker.onmessage = (e) => {
            const { type, payload, error, id } = e.data;
            if (type === 'INIT_SUCCESS') {
                status.value = 'Worker Ready';
                isWorkerReady.value = true;
                addLog(`[Worker] Initialization success (id: ${id})`);
            } else if (type === 'DETECT_SUCCESS') {
                status.value = 'Detection Complete';
                addLog(`[Worker] Detection success! Found ${payload.length} faces.`);
                if (payload.length > 0) {
                     addLog(`Face 1 Box: ${JSON.stringify(payload[0].detection)}`);
                } else {
                     addLog('No faces found in image.');
                }
            } else if (type === 'ERROR') {
                status.value = 'Worker Error';
                addLog(`[Worker] Error: ${error}`);
                console.error('Worker error details:', e.data);
            } else {
                addLog(`[Worker] Unknown message: ${type}`);
            }
        };

        worker.onerror = (e) => {
            status.value = 'Worker Script Error';
            addLog(`[System] Worker script error: ${e.message}`);
            console.error('Worker script error:', e);
        };
        
        addLog('Sending INIT message...');
        worker.postMessage({ type: 'INIT', id: 'debug-init' });

    } catch (e: any) {
        status.value = 'Setup Failed';
        addLog(`[System] Exception creating worker: ${e.message}`);
    }
};

const runDetection = async () => {
    if (!worker || !isWorkerReady.value) {
        addLog('[System] Worker not ready. Click Init first.');
        return;
    }
    
    status.value = 'Loading Image...';
    addLog(`Loading image from ${testImageSrc}...`);
    
    try {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.src = testImageSrc;
        
        await new Promise((resolve, reject) => {
            img.onload = () => resolve(img);
            img.onerror = (e) => reject(new Error(`Failed to load image: ${e}`));
        });
        
        addLog(`Image loaded: ${img.width}x${img.height}`);
        status.value = 'Creating Bitmap...';
        
        // Create ImageBitmap (mimicking usePhotoProcessor)
        const bitmap = await createImageBitmap(img);
        addLog('ImageBitmap created successfully.');
        
        status.value = 'Sending to Worker...';
        addLog('Posting DETECT message with bitmap...');
        
        worker.postMessage({ 
            type: 'DETECT', 
            id: 'debug-detect-' + Date.now(), 
            payload: { imageBitmap: bitmap } 
        }, [bitmap]); // Transfer consistency
        
        status.value = 'Processing...';

    } catch (e: any) {
        status.value = 'Image Error';
        addLog(`[System] Error preparing image: ${e.message}`);
    }
};

const testMainThread = async () => {
    status.value = 'Main Thread Test...';
    addLog('[Main] Importing face-api.js...');
    try {
        const faceapi = await import('face-api.js');
        addLog('[Main] face-api.js imported. Loading SSD model...');
        await faceapi.nets.ssdMobilenetv1.loadFromUri('/models');
        addLog('[Main] SSD Model loaded!');
        await faceapi.nets.faceLandmark68Net.loadFromUri('/models');
        addLog('[Main] Landmark Model loaded!');
        
        addLog('[Main] Loading image...');
        const img = await faceapi.fetchImage(testImageSrc);
        addLog('[Main] Detecting faces...');
        const detections = await faceapi.detectAllFaces(img).withFaceLandmarks();
        addLog(`[Main] Success! Found ${detections.length} faces.`);
    } catch (e: any) {
        addLog(`[Main] Error: ${e.message}`);
        console.error(e);
    }
};

const testShardFetch = async () => {
    status.value = 'Fetching Shard...';
    try {
        const response = await fetch('/models/ssd_mobilenetv1_model-shard1');
        addLog(`[Fetch] Status: ${response.status}`);
        addLog(`[Fetch] Content-Type: ${response.headers.get('content-type')}`);
        const buffer = await response.arrayBuffer();
        addLog(`[Fetch] Size: ${buffer.byteLength} bytes`);
        if (buffer.byteLength > 0) {
            const view = new Uint8Array(buffer.slice(0, 20));
            addLog(`[Fetch] First 20 bytes: ${view.join(',')}`);
        }
    } catch (e) {
        addLog(`[Fetch] Error: ${e}`);
    }
};

onUnmounted(() => {
    if (worker) {
        worker.terminate();
    }
});
</script>

<template>
  <div class="p-8 max-w-4xl mx-auto">
    <h1 class="text-2xl font-bold mb-6">Face Worker Debugger</h1>
    
    <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
        <!-- Controls -->
        <div class="space-y-4">
            <div class="flex gap-2">
                <button 
                    @click="initWorker" 
                    class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
                >
                    1. Init Worker
                </button>
                <button 
                    @click="runDetection" 
                    :disabled="!isWorkerReady"
                    class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    2. Run Detection
                </button>
                <button 
                    @click="testMainThread" 
                    class="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 transition"
                >
                    3. Test Main Thread
                </button>
                 <button 
                    @click="testShardFetch" 
                    class="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 transition"
                >
                    4. Test Shard
                </button>
            </div>
            
            <div class="p-4 bg-gray-100 rounded border">
                <h3 class="font-bold text-gray-700">Status: <span class="text-blue-600">{{ status }}</span></h3>
            </div>
            
             <div>
                <h3 class="font-bold mb-2">Test Image Preview</h3>
                <div class="border rounded p-2 bg-gray-50">
                    <img :src="testImageSrc" class="max-w-full h-auto max-h-64 object-contain" />
                </div>
            </div>
        </div>
        
        <!-- Logs -->
        <div class="h-[500px] flex flex-col">
            <h3 class="font-bold mb-2">Logs</h3>
            <div class="flex-1 bg-black text-green-400 p-4 rounded font-mono text-sm overflow-y-auto whitespace-pre-wrap">
                <div v-for="(log, i) in logs" :key="i" class="mb-1 border-b border-gray-800 pb-1 last:border-0">
                    {{ log }}
                </div>
                <div v-if="logs.length === 0" class="text-gray-500 italic">No logs yet...</div>
            </div>
        </div>
    </div>
  </div>
</template>
