// Shared, mutable "today's task pool" state for Secret Word + Emoji
// Reaction. Multiple tasks now live in one pinned CMS message (parsed by
// bot/dailyConfig.js), and each user gets served a random not-yet-done
// task from this pool, up to their level's daily_task_limit.
//
// IMPORTANT: updateDailyConfig() *reassigns* this (not just mutates a
// property), so it can't be exported as a bare variable — a plain variable
// reassignment inside one CommonJS module is NOT visible to other files
// that required it earlier. Wrapping it in an object and always doing
// `taskState.tasks = [...]` (property reassignment on the shared object)
// instead of `tasks = [...]` is what makes the update visible everywhere
// else that also required this same object.
const taskState = {
    tasks: [
        // { taskKey, type: 'comment'|'reaction', word, emoji, messageId }
    ]
};

module.exports = taskState;
