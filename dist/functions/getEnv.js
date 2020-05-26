"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function getEnv(varName, otherwise = undefined) {
    if (process.env[varName]) {
        return process.env[varName];
    }
    else if (otherwise !== undefined) {
        return otherwise;
    }
    else {
        throw new Error(`${varName} not set in environment`);
    }
}
exports.default = getEnv;
//# sourceMappingURL=getEnv.js.map