import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Photo, ProcessingSession, FaceCluster } from './types';

interface AppDB extends DBSchema {
  photos: {
    key: string; // photo id
    value: Photo;
    indexes: { 'by-session': string; 'by-timestamp': number };
  };
  sessions: {
    key: string; // session id
    value: ProcessingSession;
  };
  clusters: {
    key: string; // cluster id
    value: FaceCluster;
  };
}

const DB_NAME = 'photo-selector-db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<AppDB>>;

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<AppDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('photos')) {
          const store = db.createObjectStore('photos', { keyPath: 'id' });
          store.createIndex('by-session', 'sessionId'); // Make sure Photo has sessionId
          store.createIndex('by-timestamp', 'timestamp');
        }
        if (!db.objectStoreNames.contains('sessions')) {
          db.createObjectStore('sessions', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('clusters')) {
          db.createObjectStore('clusters', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

export async function savePhoto(photo: Photo) {
  const db = await getDB();
  return db.put('photos', photo);
}

export async function getPhotosBySession(sessionId: string) {
  const db = await getDB();
  // We need to add sessionId to Photo interface in types.ts first if we want to index by it.
  // Assuming we filter manually or add index.
  // For now, let's just get all and filter or use cursor.
  // Actually, let's update Photo interface later or now.
  // But wait, getAllFromIndex is better.
  // We will assume Photo has a sessionId field.
  return db.getAllFromIndex('photos', 'by-session', sessionId);
}

export async function saveSession(session: ProcessingSession) {
  const db = await getDB();
  return db.put('sessions', session);
}

export async function getSession(id: string) {
  const db = await getDB();
  return db.get('sessions', id);
}

export async function clearExisitingData() {
  const db = await getDB();
  await db.clear('photos');
  await db.clear('sessions');
  await db.clear('clusters');
}
