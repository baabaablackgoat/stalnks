"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const moment = require("moment-timezone");
const Discord = require("discord.js");
const Client_1 = require("../functions/Client");
const getEnv_1 = require("../functions/getEnv");
const QUEUE_ACCEPTING_MINUTES = parseInt(getEnv_1.default('DISCORD_STONKS_QUEUEACCEPTINGMINUTES', '30'));
const QUEUE_MULTI_GROUP_SIZE = parseInt(getEnv_1.default('DISCORD_STONKS_QUEUEMULTIGROUPSIZE', '3'));
const MINIMUM_TURNS_BEFORE_FREEZE = parseInt(getEnv_1.default('DISCORD_STONKS_QUEUEMINIMUMTURNSBEFOREFREEZE', '9'));
const QUEUE_TO_SELL_MINUTES = parseInt(getEnv_1.default('DISCORD_STONKS_QUEUETOSELLMINUTES', '7'));
const TIME_MULTIPLIER_IF_HERE_BEFORE = parseFloat(getEnv_1.default('DISCORD_STONKS_TIMEMULTIPLIERIFHEREBEFORE', '1.5'));
class QueueUserEntry {
    constructor(userObject, queue, type) {
        this.user = userObject;
        this.queue = queue;
        switch (type) {
            case "single":
                this.maxVisits = 1;
                break;
            case "some":
                this.maxVisits = 3;
                break;
            case "multi":
                this.maxVisits = Infinity;
                break;
            default:
                throw new RangeError("Attempted to create an invalid queue user entry - supplied type " + type + " is invalid");
        }
        this.type = type;
        this.grantedVisits = 0;
        this.fulfilled = false;
    }
    get subQueuePosition() {
        return this.queue._rawQueues[this.type].findIndex(q => q.user.id == this.user.id);
    }
    sendUpNextMessage() {
        const userUpNextEmbed = new Discord.MessageEmbed({
            title: `Your turn #${this.grantedVisits + 1} will be starting soon!`,
            color: 16312092,
            description: `The user in front of you in the queue has just started their turn.\nYour turn will commence in at most ${QUEUE_TO_SELL_MINUTES} minutes. \nPlease prepare yourself to enter the Dodo-Code™, and don't forget your turnips!`
        });
        this.user.send(userUpNextEmbed);
    }
    initiateTurn() {
        if (this.queue.getCurrentQueuePosition(this.type, true) === -1)
            this.queue.queuePositions[this.type] = 0; // Change the current queue position internally to 0 once a subqueue has started. Might have to move to the queue class itself
        if (this.grantedVisits >= this.maxVisits) {
            console.error(`${this.user.tag} had initiateTurn() called, but has reached it's maximum visit amount (${this.grantedVisits}/${this.maxVisits}). Double check the program flow. Skipping user and initiating next turn`);
            this.queue.update();
            return;
        }
        const userWasHereLastTurn = this.queue.previousUserProcessed === this;
        const isLastVisit = this.grantedVisits + 1 >= this.maxVisits;
        const yourTurnEmbed = new Discord.MessageEmbed({
            title: "⏰ It's your turn!",
            color: 16312092,
            description: `You have **${QUEUE_TO_SELL_MINUTES * (userWasHereLastTurn ? TIME_MULTIPLIER_IF_HERE_BEFORE : 1)} minutes** to connect, sell your turnips, and leave the island.\nOnce your timeslot expires, the next user in the queue will be automatically messaged.\nShould you be done early, please click 👍 to notify that you're done.${isLastVisit ? "" : "\nIf you wish to reconnect later to sell more, click 🔁 to be added to the queue again. *Please note that this also ends your turn!*"}`,
            fields: [
                { name: "Dodo Code™", inline: false, value: `**${this.queue.dodoCode}**` },
                { name: "Additional information:", inline: false, value: this.queue.addlInformation },
                { name: "Visit #", inline: true, value: this.grantedVisits + 1 },
                { name: "Remaining visits", inline: true, value: this.maxVisits - (this.grantedVisits + 1) }
            ]
        });
        this.user.send(yourTurnEmbed).then(turnMessage => {
            this.grantedVisits++;
            if (this.queue.nextUserEntry) { // attempt to send message to next user in queue
                if (this.queue.nextUserEntry.user.id === this.user.id) {
                    yourTurnEmbed.fields.push({
                        name: "By the way...",
                        value: "**Your next turn will be immediately after the current one!**",
                        inline: false
                    });
                    turnMessage.edit(yourTurnEmbed);
                }
                else
                    this.queue.nextUserEntry.sendUpNextMessage();
            }
            const reactionCollectorFilter = isLastVisit ? (r, u) => !u.bot && r.emoji.name == '👍' : (r, u) => !u.bot && ['👍', '🔁'].includes(r.emoji.name);
            turnMessage.react('👍');
            if (!isLastVisit)
                turnMessage.react('🔁');
            const doneCollector = turnMessage.createReactionCollector(reactionCollectorFilter, {
                time: (userWasHereLastTurn ? TIME_MULTIPLIER_IF_HERE_BEFORE : 1) * QUEUE_TO_SELL_MINUTES * 60 * 1000,
                max: 1
            });
            doneCollector.on('end', (collected, reason) => {
                if (reason != 'time' && !isLastVisit && collected.size != 0 && collected.first().emoji.name == '🔁') {
                    turnMessage.channel.send({
                        embed: {
                            color: 16711907,
                            description: `🔁 You have been added back into the queue.\nYour turn is over for now, but will continue soon! **Please prepare for your next visit immediately.**`
                        }
                    });
                }
                else {
                    this.fulfilled = true;
                    this.queue.queuePositions[this.type]++;
                    turnMessage.channel.send({
                        embed: {
                            color: 4886754,
                            description: `🤚 Your turn is now over. Thanks for joining the queue!`
                        }
                    });
                }
                this.queue.previousUserProcessed = this.queue.currentUserProcessed;
                this.queue.currentUserProcessed = null;
                this.queue.update();
            });
        }).catch(err => {
            console.log("Failed to message a user the dodo code, skipping user: " + err);
            this.currentUserProcessed = null;
            this.queue.update();
        });
    }
    estimatedWaitTime() {
        const worstRepeatAssumptions = { some: 3, multi: 7 };
        const avgEstimateMultiplier = 0.66;
        let worstEstimate = 0;
        let userAmtInProcessingGroup = 0;
        if (this.queue.processingGroup.type) { // There's currently a processing group active - calculate these times first.
            // TODO: Maybe adjust this to be slightly more accurate depending on the users' subgroup position
            if (this.type == this.queue.processingGroup.type && this.subQueuePosition < this.queue.processingGroup.firstIndex + userAmtInProcessingGroup) {
                worstEstimate = 2 * QUEUE_TO_SELL_MINUTES;
                return `${Math.floor(worstEstimate * avgEstimateMultiplier)} - ${worstEstimate}`;
            }
            // User isn't in this subgroup - assume they'll have to wait for it to pass
            if (this.queue.processingGroup.type === 'some') {
                userAmtInProcessingGroup = this.queue.processingGroup.firstIndex + QUEUE_MULTI_GROUP_SIZE > this.queue._rawQueues.some.length ? this.queue._rawQueues.some.length - this.queue.processingGroup.firstIndex : 3;
                worstEstimate += worstRepeatAssumptions.some * QUEUE_TO_SELL_MINUTES * userAmtInProcessingGroup;
            }
            else if (this.queue.processingGroup.type === 'multi') {
                let turnsBeforeFreeze = MINIMUM_TURNS_BEFORE_FREEZE - this.queue.processingGroup.processedThisTurn;
                if (turnsBeforeFreeze < 0)
                    turnsBeforeFreeze = 0;
                worstEstimate += turnsBeforeFreeze * QUEUE_TO_SELL_MINUTES;
            }
        }
        // Depending on this users type and position, calculate all remaining users inbetween, also subtract the users in the current processing group!
        worstEstimate += (this.queue.remainingUsersInSubqueue('single') - (this.type == 'single' ? this.queue._rawQueues.single.length - this.subQueuePosition : 0)) * QUEUE_TO_SELL_MINUTES;
        if (this.type == 'single')
            return `${Math.floor(worstEstimate * avgEstimateMultiplier)} - ${worstEstimate}`;
        worstEstimate += (this.queue.remainingUsersInSubqueue('some') - (this.queue.processingGroup.type == 'some' ? userAmtInProcessingGroup : 0) - (this.type == 'some' ? this.queue._rawQueues.some.length - this.subQueuePosition : 0)) * QUEUE_TO_SELL_MINUTES * worstRepeatAssumptions.some;
        if (this.type == 'some')
            return `${Math.floor(worstEstimate * avgEstimateMultiplier)} - ${worstEstimate}`;
        worstEstimate += (this.queue.remainingUsersInSubqueue('multi') - (this.queue.processingGroup.type == 'multi' ? userAmtInProcessingGroup : 0) - (this.type == 'multi' ? this.queue._rawQueues.multi.length - this.subQueuePosition : 0)) * QUEUE_TO_SELL_MINUTES * worstRepeatAssumptions.multi;
        return `${Math.floor(worstEstimate * avgEstimateMultiplier)} - ${worstEstimate}`;
    }
}
class QueueEntry {
    constructor(userId) {
        this.id = userId; // to allow for self-deletion
        this.dodoCode = null;
        this.addlInformation = "No additional information specified.";
        this.currentUserProcessed = null;
        this.acceptingEntries = true;
        this._rawQueues = {
            single: [],
            some: [],
            multi: [],
        };
        this.queuePositions = { single: -1, some: -1, multi: -1 };
        this.processingGroup = this.emptyProcessingGroup();
        this.frozenProcessingGroup = null;
        this.previousUserProcessed = null;
        this.joinReactionCollector = null;
        this.minimumAcceptanceExpiresAt = moment().add(QUEUE_ACCEPTING_MINUTES, 'minutes');
        this.entryCloseInterval = setInterval(this.closeOnExpiryAndEmpty.bind(this), 60 * 1000);
        this.flaggedForDeletion = false;
    }
    /*
    get userQueue() { // TODO/DEPRECATED might be deprecated / not needed
        return this._rawQueues.single.concat(this._rawQueues.some).concat(this._rawQueues.multi);
    }

    userQueuePosition(userId) { // TODO - must be updated to reflect the new queue position using *ALL KNOWN STUFF*!
        return this.userQueue.findIndex(q => q.id == userId);
    }
    */
    emptyProcessingGroup() {
        return {
            groupType: false,
            firstIndex: -1,
            currentIndex: -1,
            processedThisTurn: 0
        };
    }
    addUserToQueue(userObject, type) {
        if (!userObject)
            throw new Error("No user object specified: Userobject was " + userObject);
        if (!['single', 'some', 'multi'].includes(type))
            return; // Double check for valid type
        // Prevent users from queueing up multiple times (also across queues! that would be dumb.)
        // ISSUE This line can probably be replaced with a simple "position check" for -1, once implemented.
        if (this._rawQueues.single.filter(e => e.user.id == userObject.id).length > 0 || this._rawQueues.some.filter(e => e.user.id == userObject.id).length > 0 || this._rawQueues.multi.filter(e => e.user.id == userObject.id).length > 0)
            return;
        // Make sure the user is DM-able, and send confirmation message.
        const addedToQueueEmbed = new Discord.MessageEmbed({
            color: 16711907,
            description: `You have been added to the queue for a maximum of ${type == 'single' ? '1' : type == 'some' ? "3" : "unlimited"} visit(s).\nYour estimated wait time is **⏳ minutes**.\n${type === 'multi' ? "\n⚠ **Because you signed up for potentially infinitely many visits, please keep in mind that your visiting streak might be interrupted for people with less visits.**\n\n" : ""}If you wish to leave the queue, click 👋.`
        });
        userObject.send(addedToQueueEmbed)
            .then(confirmationMsg => {
            // Add the user to the respective raw queue, and fire an update on the queue (in case it is empty to immediately allow the user to join)
            this._rawQueues[type].push(new QueueUserEntry(userObject, this, type));
            this.update();
            // Get the estimated wait-time and put it in the message
            addedToQueueEmbed.description = addedToQueueEmbed.description.replace("⏳", this._rawQueues[type].find(e => e.user.id == userObject.id).estimatedWaitTime());
            confirmationMsg.edit(addedToQueueEmbed);
            // Allow user to un-queue
            confirmationMsg.react('👋');
            const leaveQueueCollector = confirmationMsg.createReactionCollector((r, u) => !u.bot && r.emoji.name == '👋', {
                time: QUEUE_ACCEPTING_MINUTES * 60 * 1000,
                max: 1
            });
            leaveQueueCollector.on('collect', (leaveR, leavingUser) => {
                if (!this)
                    return; // just in case the queue was already deleted
                const foundUserIndex = this._rawQueues[type].findIndex(e => e.user.id == leavingUser.id);
                if (foundUserIndex >= 0 && foundUserIndex > this.getCurrentQueuePosition(type, true)) {
                    this._rawQueues[type].splice(foundUserIndex, 1);
                    leavingUser.send({
                        embed: {
                            color: 16711907,
                            description: `You have been removed from the queue.`
                        }
                    });
                }
            });
        }).catch(err => console.log("Couldn't add " + userObject.tag + " to queue - most likely has DMs disabled. Details: " + err));
    }
    remainingUsersInSubqueue(type) {
        return this._rawQueues[type].length - this.getCurrentQueuePosition(type);
    }
    get nextUserIndexFromProcessingGroup() {
        if (!this.processingGroup.type)
            throw new ReferenceError("No processing group exists, but the next user in the group was requested");
        let loopedOver = false;
        let searchingIndex = this.processingGroup.currentIndex;
        for (let _ = 0; _ < 10; _++) { // limited to 10 to prevent accidental infinite loops like with while(true)
            searchingIndex++;
            if (this._rawQueues[this.processingGroup.type].length <= searchingIndex || this.processingGroup.firstIndex + (QUEUE_MULTI_GROUP_SIZE - 1) < searchingIndex) {
                if (loopedOver)
                    return -1; // This processing group is done - no further entries need to be processed
                searchingIndex = this.processingGroup.firstIndex - 1; // loop back once to check the previous users in the group (-1 because of searchingIndex++)
                loopedOver = true;
                continue;
            }
            // Check if the user is on his last turn;
            if (this._rawQueues[this.processingGroup.type][searchingIndex].grantedVisits >= this._rawQueues[this.processingGroup.type][searchingIndex].maxVisits)
                continue;
            if (!this._rawQueues[this.processingGroup.type][searchingIndex].fulfilled)
                return searchingIndex;
        }
        throw new Error("Something went wrong while attempting to find the next user in the current processing group.");
    }
    checkForGroupFreeze(nextTurn = false) {
        if (this.processingGroup.type !== 'multi')
            return false;
        if (this.processingGroup.processedThisTurn + (nextTurn ? 1 : 0) < MINIMUM_TURNS_BEFORE_FREEZE)
            return false;
        if (this.remainingUsersInSubqueue('single') === 0 && this.remainingUsersInSubqueue('some') === 0)
            return false;
        return true;
    }
    attemptProcessingGroupFreeze() {
        if (!this.checkForGroupFreeze())
            return false;
        if (this.frozenProcessingGroup !== null)
            throw new Error("Processing group was about to be frozen, but a frozen group already exists!");
        this.frozenProcessingGroup = this.processingGroup;
        this.processingGroup = this.emptyProcessingGroup();
        return true;
    }
    attemptThawingFrozenGroup() {
        if (!this.frozenProcessingGroup)
            return false;
        this.processingGroup = this.frozenProcessingGroup;
        this.frozenProcessingGroup = null;
        this.currentUserProcessed = this._rawQueues.multi[this.processingGroup.currentIndex];
        this.processingGroup.processedThisTurn = 0;
        return true;
    }
    get nextUserEntry() {
        if (this.processingGroup.type) {
            if (this.checkForGroupFreeze(true)) {
                if (this.remainingUsersInSubqueue('single') >= 1)
                    return this._rawQueues.single[this.getCurrentQueuePosition('single')];
                if (this.remainingUsersInSubqueue('some') >= 1)
                    return this._rawQueues.some[this.getCurrentQueuePosition('some')];
                throw new Error("Error in nextUserEntry - Group freeze was determined to be imminent, but no high priority users that could've invoked this freeze were present!");
            }
            else if (this.nextUserIndexFromProcessingGroup > -1)
                return this._rawQueues[this.processingGroup.type][this.nextUserIndexFromProcessingGroup];
        }
        const singleActive = this.currentUserProcessed && this.currentUserProcessed.type == 'single';
        if (this.remainingUsersInSubqueue('single') >= (singleActive ? 2 : 1))
            return this._rawQueues.single[this.getCurrentQueuePosition('single') + (singleActive ? 1 : 0)];
        if (this.processingGroup.type == 'some' && this.processingGroup.firstIndex + QUEUE_MULTI_GROUP_SIZE >= this._rawQueues.some.length)
            return this._rawQueues.some[this.processingGroup.firstIndex + QUEUE_MULTI_GROUP_SIZE];
        if (this.remainingUsersInSubqueue('some') >= 1)
            return this._rawQueues.some[this.getCurrentQueuePosition('some')]; //usually only if single users were called before
        if (this.processingGroup.type == 'multi' && this.processingGroup.firstIndex + QUEUE_MULTI_GROUP_SIZE >= this._rawQueues.multi.length)
            return this._rawQueues.multi[this.processingGroup.firstIndex + QUEUE_MULTI_GROUP_SIZE];
        if (this.remainingUsersInSubqueue('multi') >= 1)
            return this._rawQueues.multi[this.getCurrentQueuePosition('multi')];
        return false;
    }
    closeOnExpiryAndEmpty() {
        if (!this.acceptingEntries)
            return; // In case it was already closed
        if (this.remainingUsersInSubqueue('single') != 0 || this.remainingUsersInSubqueue('some') != 0 || this.remainingUsersInSubqueue('multi') != 0)
            return;
        if (this.minimumAcceptanceExpiresAt.diff(moment()) > 0)
            return;
        // actual closure
        if (this.joinReactionCollector && !this.joinReactionCollector.ended)
            this.joinReactionCollector.stop("No more entries and minimum time has expired");
        if (this.entryCloseInterval)
            clearInterval(this.entryCloseInterval);
    }
    getCurrentQueuePosition(type, doNotIgnoreInit = false) {
        if (!type || !['single', 'some', 'multi'].includes(type))
            throw new ReferenceError("Attempted to get a queue position, but an invalid type was specified");
        if (doNotIgnoreInit)
            return this.queuePositions[type];
        return (this.queuePositions[type] >= 0 ? this.queuePositions[type] : 0);
    }
    update() {
        if (this.currentUserProcessed)
            return;
        if (!this.remainingUsersInSubqueue('single') && !this.remainingUsersInSubqueue('some') && !this.remainingUsersInSubqueue('multi')) {
            if (!this.acceptingEntries) { // Queue is now closed and finished, too
                const queueIsClosedEmbed = new Discord.MessageEmbed({
                    color: 16711907,
                    description: `Thank you for sharing your turnip prices with everyone! It looks like the queue you started has come to an end. If you like, you can:`,
                    fields: [
                        {
                            name: "1)",
                            value: "Leave everything as it is, and let folks come and go in a free-for-all fashion.\n(Consider sharing the code with your friends or in a text channel)"
                        },
                        {
                            name: "2)",
                            value: "Close your island and create a new Dodo Code to get a sense of privacy again, and distribute it among friends, or start a new queue if lots of folks are still asking!"
                        },
                        { name: "3)", value: "Close your island and let us know you're done!" }
                    ],
                    footer: { text: "📈 STONKS" }
                });
                Client_1.default.users.fetch(this.id)
                    .then(user => user.send(queueIsClosedEmbed))
                    .catch(err => console.log("Couldn't message queue creating user about the queue being closed: " + err));
                this.flaggedForDeletion = true;
            }
            return;
        }
        if (!this.dodoCode)
            return;
        if (this.processingGroup.type) { // currently in a subgroup
            this.processingGroup.processedThisTurn++;
            const freezeSuccessful = this.attemptProcessingGroupFreeze();
            if (!freezeSuccessful) {
                if (this.nextUserIndexFromProcessingGroup > -1) { // Was an unfulfilled user in the current processing group found?
                    this.currentUserProcessed = this._rawQueues[this.processingGroup.type][this.nextUserIndexFromProcessingGroup];
                    this.processingGroup.currentIndex = this.nextUserIndexFromProcessingGroup;
                    this.currentUserProcessed.initiateTurn();
                    return;
                }
                else { // Processing group is done - reset it
                    this.processingGroup = this.emptyProcessingGroup();
                }
            }
        }
        if (this.remainingUsersInSubqueue('single') > 0) {
            this.currentUserProcessed = this._rawQueues.single[this.getCurrentQueuePosition('single')];
            this.currentUserProcessed.initiateTurn();
            return;
        }
        if (this.remainingUsersInSubqueue('some') > 0) {
            this.processingGroup.type = 'some';
            this.processingGroup.firstIndex = this.processingGroup.currentIndex = this.getCurrentQueuePosition('some');
            this.currentUserProcessed = this._rawQueues.some[this.getCurrentQueuePosition('some')];
            this.currentUserProcessed.initiateTurn();
            return;
        }
        if (this.remainingUsersInSubqueue('multi') > 0) {
            const thawSuccessful = this.attemptThawingFrozenGroup();
            if (!thawSuccessful) {
                this.processingGroup.type = 'multi';
                this.processingGroup.firstIndex = this.processingGroup.currentIndex = this.getCurrentQueuePosition('multi');
                this.currentUserProcessed = this._rawQueues.multi[this.getCurrentQueuePosition('multi')];
            }
            this.currentUserProcessed.initiateTurn();
            return;
        }
    }
}
exports.QueueEntry = QueueEntry;
//# sourceMappingURL=Queue.js.map