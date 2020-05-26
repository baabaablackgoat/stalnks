"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
const getEnv_1 = require("./../functions/getEnv");
const DISCORD_STONKS_TOKEN = getEnv_1.default('DISCORD_STONKS_TOKEN');
const client = new discord_js_1.Client();
client.login(DISCORD_STONKS_TOKEN).catch(err => console.error("Couldn't log in: " + err));
exports.default = client;
//# sourceMappingURL=Client.js.map