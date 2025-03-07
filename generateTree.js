const fs = require("fs");
const path = require("path");

const EXCLUDE_DIRS = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    "coverage",
    ".next",
    ".env",
    "static",
]);

const EXCLUDE_FILES = /\.(map|json)$/; // Exclude .map and .json files

/**
 * Recursively generates a clean directory tree structure.
 * @param {string} dir - The directory path.
 * @param {string} prefix - The prefix for tree formatting.
 */
function generateTree(dir, prefix = "") {
    if (!fs.existsSync(dir)) return;

    const items = fs.readdirSync(dir).filter(item => {
        const fullPath = path.join(dir, item);
        return !EXCLUDE_DIRS.has(item) && !EXCLUDE_FILES.test(item) && fs.existsSync(fullPath);
    });

    items.forEach((item, index) => {
        const isLast = index === items.length - 1;
        const newPrefix = prefix + (isLast ? "└── " : "├── ");
        console.log(newPrefix + item);

        const fullPath = path.join(dir, item);
        if (fs.statSync(fullPath).isDirectory()) {
            generateTree(fullPath, prefix + (isLast ? "    " : "│   "));
        }
    });
}

// Root directory
console.log("bangbangan-copra-trading/");

// Generate tree for backend & frontend if they exist
generateTree(path.join(__dirname, "backend"));
generateTree(path.join(__dirname, "frontend"));
