// utils/logger.js

// ANSI color codes for terminal output
const colors = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
    gray: "\x1b[90m"
};

// Helper to get a clean HH:MM:SS timestamp
function getTimestamp() {
    return new Date().toISOString().split('T')[1].replace('Z', '');
}

export const logger = {
    info: (msg) => console.log(`${colors.cyan}[INFO ${getTimestamp()}]${colors.reset} ${msg}`),
    success: (msg) => console.log(`${colors.green}[SUCCESS ${getTimestamp()}]${colors.reset} ${msg}`),
    warn: (msg) => console.warn(`${colors.yellow}[WARN ${getTimestamp()}]${colors.reset} ${msg}`),
    error: (msg) => console.error(`${colors.red}[ERROR ${getTimestamp()}]${colors.reset} ${msg}`),
    data: (msg) => console.log(`${colors.gray}[DATA ${getTimestamp()}]${colors.reset} ${msg}`)
};
