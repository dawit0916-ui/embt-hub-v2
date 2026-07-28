function getUTCDayStart(date = new Date()) {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    return d;
}

function getNextResetTime(taskType) {
    const now = new Date();

    if (taskType === 'daily') {
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        return tomorrow;
    }
    return now;
}

function getResetPeriodStart(resetIntervalHours) {
    const now = new Date();
    const periodStartHour = Math.floor(now.getUTCHours() / resetIntervalHours) * resetIntervalHours;
    const start = new Date(now);
    start.setUTCHours(periodStartHour, 0, 0, 0);
    return start;
}

module.exports = { getUTCDayStart, getNextResetTime, getResetPeriodStart };
