'use strict';
/**
 * Kết nối MongoDB dùng chung giữa các lần gọi (Vercel giữ lại tiến trình "ấm"),
 * tránh mở kết nối mới mỗi request.
 */
const { MongoClient } = require('mongodb');

let cached = global.__gubMongo;
if (!cached) cached = global.__gubMongo = { client: null, promise: null, indexed: false };

async function getDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Chưa cấu hình MONGODB_URI trên Vercel (Settings → Environment Variables).');
  if (!cached.promise) {
    cached.promise = MongoClient.connect(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 8000 })
      .then(c => { cached.client = c; return c; })
      .catch(e => { cached.promise = null; throw e; });
  }
  const client = await cached.promise;
  const db = client.db(process.env.MONGODB_DB || 'gubilliard');
  if (!cached.indexed) {
    cached.indexed = true;
    await Promise.all([
      db.collection('registrations').createIndex({ week: 1, staffId: 1 }),
      db.collection('assignments').createIndex({ week: 1 })
    ]).catch(() => { cached.indexed = false; });
  }
  return db;
}

module.exports = { getDb };
