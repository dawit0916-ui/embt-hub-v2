// Shared, mutable "current active daily task" state.
//
// IMPORTANT: updateDailyConfig() *reassigns* this (not just mutates a
// property), so it can't be exported as a bare variable — a plain variable
// reassignment inside one CommonJS module is NOT visible to other files
// that required it earlier. Wrapping it in an object and always doing
// `taskState.activeTask = {...}` (property reassignment on the shared
// object) instead of `activeTask = {...}` is what makes the update visible
// everywhere else that also required this same object.
const taskState = {
    activeTask: {
        type: null,        // "comment" | "reaction"
        word: null,
        emoji: null,
        messageId: null
    }
};

module.exports = taskState;
