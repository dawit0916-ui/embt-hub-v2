// Uses the bot's existing mongoose connection. Store collections are prefixed "store_"
// so they can never collide with the bot's own collections.
import mongoose from 'mongoose';

export const ObjectId = mongoose.mongo.ObjectId;
export const getClient = () => mongoose.connection.getClient();
export const col = (name) => mongoose.connection.db.collection('store_' + name);
/** The bot's User model lives in the "users" collection. */
export const usersCol = () => mongoose.connection.db.collection('users');

export async function ensureIndexes() {
  if (mongoose.connection.readyState !== 1) {
    await new Promise((resolve) => mongoose.connection.once('open', resolve));
  }
  await col('versions').createIndex({ packageId: 1, versionCode: -1 }, { unique: true });
  await col('licenses').createIndex({ userId: 1, packageId: 1 }, { unique: true });
  await col('devices').createIndex({ userId: 1, hash: 1 }, { unique: true });
  await col('linkCodes').createIndex({ codeHash: 1 });
  await col('linkCodes').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await col('purchases').createIndex({ userId: 1, packageId: 1, status: 1 });
  await col('deliveries').createIndex({ userId: 1, packageId: 1 });
  await col('refunds').createIndex({ userId: 1, createdAt: -1 });
  await col('refunds').createIndex({ status: 1, createdAt: 1 });
  await col('ledger').createIndex({ userId: 1, at: -1 });
  await col('scans').createIndex({ userId: 1, deviceHash: 1, packageId: 1 }, { unique: true });
}
