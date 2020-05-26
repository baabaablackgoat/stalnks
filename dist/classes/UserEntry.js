"use strict";
var __classPrivateFieldSet = (this && this.__classPrivateFieldSet) || function (receiver, privateMap, value) {
    if (!privateMap.has(receiver)) {
        throw new TypeError("attempted to set private field on non-instance");
    }
    privateMap.set(receiver, value);
    return value;
};
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, privateMap) {
    if (!privateMap.has(receiver)) {
        throw new TypeError("attempted to get private field on non-instance");
    }
    return privateMap.get(receiver);
};
var __weekPrices;
Object.defineProperty(exports, "__esModule", { value: true });
const moment = require("moment-timezone");
const Client_1 = require("../functions/Client");
const discord_js_1 = require("discord.js");
class UserEntry {
    constructor(id, timezone, friendcode, weekUpdated, lastWeekPattern, _weekPrices, optInPatternDM) {
        __weekPrices.set(this, void 0);
        this.id = id;
        this.timezone = timezone;
        this.friendcode = friendcode;
        this.weekUpdated = weekUpdated;
        this.lastWeekPattern = lastWeekPattern; // Fluctuating: 0, Large Spike: 1, Decreasing: 2, Small Spike: 3, I don't know: any
        __classPrivateFieldSet(// Fluctuating: 0, Large Spike: 1, Decreasing: 2, Small Spike: 3, I don't know: any
        this, __weekPrices, _weekPrices);
        this.optInPatternDM = optInPatternDM;
    }
    get weekPrices() {
        const currWeek = moment().tz(this.timezone).week();
        if (this.weekUpdated != currWeek) {
            console.log(`Cleared week price data for ${this.id}.`);
            this.lastWeekPattern = undefined;
            if (this.optInPatternDM) { // Asking for the previous pattern
                Client_1.default.users.fetch(this.id)
                    .then(user => {
                    const patternEmoji = {
                        largeSpike: "💸",
                        smallSpike: "📈",
                        fluctuating: "📊",
                        decreasing: "📉",
                    };
                    const patternNumbers = {
                        fluctuating: 0,
                        largeSpike: 1,
                        decreasing: 2,
                        smallSpike: 3
                    };
                    const askForLastPatternEmbed = new discord_js_1.MessageEmbed({
                        description: `It seems like you've entered turnip prices last week that have now run their course!\nDo you know which pattern your turnip prices were following **last week?**\nPlease use the reactions below to enter your pattern. If you don't know your pattern, you can ignore this message.\n\n${patternEmoji.largeSpike} Large spike \n${patternEmoji.smallSpike} Small spike \n${patternEmoji.fluctuating} Fluctuating \n${patternEmoji.decreasing} Decreasing`,
                        color: "LUMINOUS_VIVID_PINK",
                    });
                    user.send(askForLastPatternEmbed)
                        .then(sentMessage => {
                        for (const key in patternEmoji) {
                            sentMessage.react(patternEmoji[key]).catch(err => console.error(err));
                        }
                        const patternCollector = sentMessage.createReactionCollector((r, u) => !u.bot && Object.values(patternEmoji).includes(r.emoji.name), {
                            time: 5 * 60 * 1000,
                            max: 1
                        });
                        patternCollector.on("end", (collected, reason) => {
                            if (reason == "time" || collected.size < 1)
                                return;
                            this.lastWeekPattern = patternNumbers[Object.keys(patternEmoji).find(key => patternEmoji[key] == collected.first().emoji.name)];
                        });
                    })
                        .catch(err => console.log("Failed to message user to ask about last week's pattern: " + err));
                })
                    .catch(err => console.log("Failed to lookup user to ask about last week's pattern: " + err));
            }
            __classPrivateFieldSet(this, __weekPrices, Array(13).fill(""));
        }
        this.weekUpdated = currWeek;
        return __classPrivateFieldGet(this, __weekPrices);
    }
    get filledWeekPrices() {
        const lastFilledIndex = this.weekPrices.map((k) => Boolean(k)).lastIndexOf(true) + 1;
        return this.weekPrices.slice(0, lastFilledIndex);
    }
    get turnipProphetURL() {
        const pricesString = this.filledWeekPrices.join(".");
        if (pricesString.length > 0)
            return `https://turnipprophet.io?prices=${pricesString}${this.lastWeekPattern !== undefined ? "&pattern=" + this.lastWeekPattern : ""}`;
        else
            return `https://turnipprophet.io${this.lastWeekPattern !== undefined ? "?pattern=" + this.lastWeekPattern : ""}`;
    }
    static fromRaw(id, obj) {
        return new UserEntry(id, obj.timezone, obj.friendcode, obj.hasOwnProperty("weekUpdated") ? obj.weekUpdated : moment().tz(obj.timezone).week(), obj.hasOwnProperty("lastWeekPattern") ? obj.lastWeekPattern : undefined, obj.hasOwnProperty("_weekPrices") ? obj._weekPrices : Array(13).fill(""), obj.hasOwnProperty("optInPatternDM") ? obj.optInPatternDM : true);
    }
}
exports.UserEntry = UserEntry;
__weekPrices = new WeakMap();
//# sourceMappingURL=UserEntry.js.map