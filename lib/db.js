'use strict';
/**
 * Kết nối MongoDB dùng chung giữa các lần gọi (Vercel giữ lại tiến trình "ấm"),
 * tránh mở kết nối mới mỗi request.
 */
const { MongoClient } = require('mongodb');
const CFG = require('./config');

let cached = global.__gubMongo;
if (!cached) cached = global.__gubMongo = { client: null, promise: null, indexed: false };

async function getDb() {
  const uri = CFG.mongoUri();
  if (!uri) throw new Error('Chưa nhập mật khẩu database: mở file config.js trong repo, sửa dòng DB_PASSWORD rồi push lên GitHub.');
  if (!cached.promise) {
    cached.promise = MongoClient.connect(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 8000 })
      .then(c => { cached.client = c; return c; })
      .catch(e => { cached.promise = null; throw e; });
  }
  const client = await cached.promise;
  const db = client.db(CFG.dbName());
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
