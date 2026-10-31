// The only file that touches the bot's balances. Users are keyed by user_id (Telegram id)
// and the balance is the same `balance` field the shop uses. Every change also writes a
// history entry (same shape the bot's shop uses) and a store_ledger row.
import { usersCol, col } from './db.js';
import { AppError } from './util.js';

export function toUserId(v) {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new AppError(400, 'bad_user', 'Invalid user id');
  return n;
}

export const findUser = (userId, session) => usersCol().findOne({ user_id: userId }, { session });
export const balanceOf = (userDoc) => Number(userDoc?.balance ?? 0);

/** Atomically subtracts [amount] only if the balance covers it and the user is not banned. */
export async function debit(userId, amount, title, taskId, session) {
  const r = await usersCol().updateOne(
    { user_id: userId, balance: { $gte: amount }, is_banned: { $ne: true } },
    { $inc: { balance: -amount }, $push: { history: { title, reward: -amount, taskId, date: new Date() } } },
    { session }
  );
  return r.modifiedCount === 1;
}

export async function credit(userId, amount, title, taskId, session) {
  const r = await usersCol().updateOne(
    { user_id: userId },
    { $inc: { balance: amount }, $push: { history: { title, reward: amount, taskId, date: new Date() } } },
    { session }
  );
  return r.modifiedCount === 1;
}

/** Every balance change must have a ledger row written in the same transaction. */
export async function writeLedger(entry, session) {
  await col('ledger').insertOne({ ...entry, at: new Date() }, { session });
}
