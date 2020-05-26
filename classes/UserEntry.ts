import * as moment from "moment-timezone";
import client from "../functions/Client";
import { MessageEmbed } from "discord.js";

export class UserEntry {
    readonly id: string;
    timezone: string | null;
    friendcode: string | null;
    weekUpdated: number | null;
    lastWeekPattern: number | null;
    #_weekPrices: Array<string | number> | null;
    optInPatternDM: boolean;

    constructor(id: string, timezone: string | null, friendcode: string | null, weekUpdated: number | null, lastWeekPattern: number | null, _weekPrices: Array<string | number> | null, optInPatternDM: boolean) {
        this.id = id;
        this.timezone = timezone;
        this.friendcode = friendcode;
        this.weekUpdated = weekUpdated;
        this.lastWeekPattern = lastWeekPattern; // Fluctuating: 0, Large Spike: 1, Decreasing: 2, Small Spike: 3, I don't know: any
        this.#_weekPrices = _weekPrices;
        this.optInPatternDM = optInPatternDM;
    }

    get weekPrices(): Array<string | number> | null {
        const currWeek = moment().tz(this.timezone).week();
        if (this.weekUpdated != currWeek) {
            console.log(`Cleared week price data for ${this.id}.`);
            this.lastWeekPattern = undefined;
            if (this.optInPatternDM) { // Asking for the previous pattern
                client.users.fetch(this.id)
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
                        const askForLastPatternEmbed = new MessageEmbed({
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
                                    if (reason == "time" || collected.size < 1) return;
                                    this.lastWeekPattern = patternNumbers[Object.keys(patternEmoji).find(key => patternEmoji[key] == collected.first().emoji.name)];
                                });
                            })
                            .catch(err => console.log("Failed to message user to ask about last week's pattern: " + err));
                    })
                    .catch(err => console.log("Failed to lookup user to ask about last week's pattern: " + err));
            }
            this.#_weekPrices = Array(13).fill("");
        }
        this.weekUpdated = currWeek;
        return this.#_weekPrices;
    }

    get filledWeekPrices(): Array<string | number> {
        const lastFilledIndex = this.weekPrices.map((k) => Boolean(k)).lastIndexOf(true) + 1;
        return this.weekPrices.slice(0, lastFilledIndex);
    }

    get turnipProphetURL(): string {
        const pricesString = this.filledWeekPrices.join(".");
        if (pricesString.length > 0) return `https://turnipprophet.io?prices=${pricesString}${this.lastWeekPattern !== undefined ? "&pattern=" + this.lastWeekPattern : ""}`;
        else return `https://turnipprophet.io${this.lastWeekPattern !== undefined ? "?pattern=" + this.lastWeekPattern : ""}`;
    }

    static fromDatabase(id, obj): UserEntry {
        return new UserEntry(
            id,
            obj.timezone,
            obj.friendcode,
            obj.hasOwnProperty("weekUpdated") ? obj.weekUpdated : moment().tz(obj.timezone).week(),
            obj.hasOwnProperty("lastWeekPattern") ? obj.lastWeekPattern : undefined,
            obj.hasOwnProperty("_weekPrices") ? obj._weekPrices : Array(13).fill(""),
            obj.hasOwnProperty("optInPatternDM") ? obj.optInPatternDM : true
        );
    }
}