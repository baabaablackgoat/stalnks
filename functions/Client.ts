import {Client} from "discord.js";
import getEnv from "./../functions/getEnv";
const DISCORD_STONKS_TOKEN = getEnv('DISCORD_STONKS_TOKEN');

const client = new Client();
client.login(DISCORD_STONKS_TOKEN).catch(err => console.error("Couldn't log in: "+ err));

export default client;
