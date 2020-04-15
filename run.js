const fs = require('fs');
const moment = require('moment-timezone');
const Discord = require('discord.js');
const client = new Discord.Client();

// ensure data exists
if (!fs.existsSync('./data')){
	fs.mkdirSync('./data');
}

// timezone & friend code data
const userDataPath = './data/userData.json';
let userData = {}; // this shall store the timezones of our users
const priceDataPath = './data/priceData.json';
let priceData = {}; // this will be some form of an ordered list
let queueData = {}; // this object handles queues, and doesn't need to be saved cause queues will break on restarts anyways.

fs.readFile(userDataPath, 'utf8', (err, data) => {
	if (err) {
		if (err.code == 'ENOENT') { // no data found - create new file!
			userData = {};
			fs.writeFileSync(userDataPath, "{}");
			console.log("Created new user data file.");
		} else {
			console.log("Something went wrong while reading user data:\n"+err);
			process.exit(1);
		}
	} else {
		try {
			rawData = JSON.parse(data);
			for (let key in rawData) {
				try {
					userData[key] = userEntry.fromRaw(key, rawData[key]);
				} catch (entryErr) {
					console.log("Non-fatal error raised while reading userData from JSON: "+entryErr);
				}
			}
		} catch (jsonErr) {
			console.log("Something went wrong while parsing user data from JSON:\n"+jsonErr);
			process.exit(1);
		}
	}

	// once userdata has been loaded, read price data.
	fs.readFile(priceDataPath, 'utf8', (err, data)=> {
		if (err) {
			if (err.code == 'ENOENT') {
				priceData = {};
				fs.writeFileSync(priceDataPath, "{}");
				console.log("Created new price data file.");
			} else {
				console.log("Something went wrong while reading price data:\n"+err);
				process.exit(1);
			}
		} else {
			try {
				rawData = JSON.parse(data);
				for (let key in rawData) {
					try {
						priceData[key] = priceEntry.fromRaw(key, rawData[key]);
					} catch (entryerr) {
						console.log("Non-fatal error raised while parsing JSON to priceEntry object: "+entryerr);
					}
				}
			} catch (jsonerr) {
				console.log("Something went wrong while parsing price data from JSON:\n"+jsonerr);
				process.exit(1);
			}
		}
	});
});

function getEnv(var_name, otherwise=undefined) {
	if (process.env[var_name]) {
		return process.env[var_name];
	} else if (otherwise) {
		return otherwise;
	} else {
		throw `${var_name} not set in environment`;
	}
}

// Save data in case of restarts or emergencies so that existing data won't be lost
function saveData() {
	fs.writeFile(userDataPath, JSON.stringify(userData), err => {
		if (err) console.log("Error while saving user data to disk:\n"+err);
	});
	fs.writeFile(priceDataPath, JSON.stringify(priceData), err => {
		if (err) console.log("Error while saving price data to disk:\n"+err);
	});
}
let saveInterval = setInterval(saveData, 60000);

// Removes entries from the priceData
function removeExpiredEntries() {
	let del_counter = 0;
	for (var key in priceData) {
		if (priceData.hasOwnProperty(key)) {
			if (priceData[key].timeLeft() <= 0){
				delete priceData[key];
				del_counter++;
			}
		}
	}
	if (del_counter > 0) {
		console.debug(`Removed ${del_counter} expired entries`);
		sendBestStonksToUpdateChannel();
	}
}
let expiredInterval = setInterval(removeExpiredEntries, 60000);

// get the best stonks
let best_stonks = [null, null, null];
function updateBestStonks() {
	best_stonks = [null, null, null];
	for (var key in priceData) {
		if (priceData.hasOwnProperty(key)) {
			let currentEntry = priceData[key];
			for (let i = 0; i < best_stonks.length; i++) {
				if (currentEntry == null) break; // if it's null it's been swapped, break inner for loop
				if (best_stonks[i] == null || currentEntry.price > best_stonks[i].price) { // swap the entries
					let temp = best_stonks[i];
					best_stonks[i] = currentEntry;
					currentEntry = temp;
				}
			}
		}
	}
	// console.debug(best_stonks);
}

const dismissTimeout = parseInt(getEnv('DISCORD_STONKS_DISMISSMESSAGETIMEOUT', '5'));
const dismissEmoji = "👌";
function sendDismissableMessage(channel, data, invokingUserID) {
	channel.send(data)
		.then(msg => {
			msg.react(dismissEmoji);
			const dismissCollector = msg.createReactionCollector((r,u) => u.id == invokingUserID && r.emoji.name == dismissEmoji, {time: dismissTimeout*60*1000, max: 1});
			dismissCollector.on('collect', (r,u) => {
				msg.delete();
			});
		});
}

const elevatedPermissionList = ["BAN_MEMBERS", "MANAGE_MESSAGES"];
function hasElevatedPermissions(member) {
	if (getEnv('DISCORD_STONKS_BOTOWNERID') == member.id) return true;
	for (let i=0; i < elevatedPermissionList.length; i++){
		if (member.hasPermission(elevatedPermissionList[i])) {
			return true;
		}
	}
	return false;
}


class userEntry { // there doesn't seem to be anything non-experimental for private fields
	constructor(id, timezone, friendcode, weekUpdated, _weekPrices) {
		this.id = id; // probably redundant
		this.timezone = timezone;
		this.friendcode = friendcode;
		this.weekUpdated = weekUpdated;
		this._weekPrices = _weekPrices;
	}
	get weekPrices() {
		let currWeek = moment().tz(this.timezone).week();
		if (this.weekUpdated != currWeek) {
			console.log(`Cleared week price data for ${this.id}`);
			this._weekPrices = Array(13).fill('');
		}
		this.weekUpdated = currWeek;
		return this._weekPrices;
	}
	get filledWeekPrices() {
		let lastFilledIndex = this._weekPrices.map((k) => Boolean(k)).lastIndexOf(true) + 1;
		return this._weekPrices.slice(0, lastFilledIndex);
	}

	static fromRaw(id, obj) {
		return new userEntry(
			id,
			obj.timezone,
			obj.friendcode,
			obj.hasOwnProperty('weekUpdated') ? obj.weekUpdated : moment().tz(obj.timezone).week(),
			obj.hasOwnProperty('_weekPrices') ? obj._weekPrices : Array(13).fill('')
		);
	}
}

class priceEntry {
	constructor(userId, price, expiresAt = null) {
		// sanity checks. these *can* be made redundant, but you can also just handle errors
		if (!(userId in userData)) throw new ReferenceError("userId "+userId+" not registered in userData.");
		// used when loading existing data
		if (expiresAt && moment(expiresAt).diff(moment().utc()) <= 0) throw new RangeError("Supplied entry expires in the past.");
		this.user = userData[userId];
		this.updatePrice(price);
		// updateBestStonks();
	}

	timeLeft(){
		return this.expiresAt.diff(moment().tz(this.user.timezone));
	}

	timeLeftString() {
		let timeLeft = this.timeLeft();
		return `${Math.floor((timeLeft / 3600000) % 24)}h${Math.floor((timeLeft / 60000) % 60)}m`;
	}

	getPriceInterval() {
		// Sunday:      0
		// Monday AM:   1
		// Monday PM:   2
		// Tuesday AM:  3
		// ...
		// Saturday AM: 11
		// Saturday PM: 12
		let user_tz = userData[this.user.id].timezone;
		let m = moment().tz(user_tz);
		if (m.day() == 0) {
			return 0;
		} else {
			return m.day() * 2 - (m.hour() < 12);
		}
	}

	updatePrice(price) {
		if (isNaN(price) || price < 0 || price > 1000 || price % 1 != 0) throw new RangeError("Supplied price "+price+" is invalid");
		let now_tz = moment().tz(userData[this.user.id].timezone); // the current time, adjusted with the timezone of the user.
		if (now_tz.weekday() == 7) throw new RangeError("Cannot create offers on a sunday - turnips arent sold on sundays.");
		this.price = price;
		this.user.weekPrices[this.getPriceInterval()] = price;
		this.expiresAt = now_tz.hour() < 12 ? now_tz.clone().hour(12).minute(0).second(0).millisecond(0) : now_tz.clone().hour(24).minute(0).second(0).millisecond(0);
	}

	static fromRaw(id, obj) {
		return new priceEntry(
			id,
			obj.price,
			obj.expiresAt
		);
	}
}

const queueAcceptingMinutes = parseInt(getEnv('DISCORD_STONKS_QUEUEACCEPTINGMINUTES', '30'));
const queueToSellMinutes = parseInt(getEnv('DISCORD_STONKS_QUEUETOSELLMINUTES', '7'));

class queueEntry {
	constructor(userId) {
		this.id = userId; // to allow for self-deletion
		this.dodoCode = null;
		this.addlInformation = "No additional information specified.";
		this.userQueue = [];
		this.currentUserProcessed = null;
		this.acceptingEntries = true;
	}

	userQueuePosition(userId) {
		return this.userQueue.findIndex(q => q.id == userId);
	}

	update(){
		if (this.currentUserProcessed) return;
		if (this.userQueue.length == 0) {
			if (!this.acceptingEntries) delete queueData[this.id];
			return;
		}
		if (!this.dodoCode) return;
		this.currentUserProcessed = this.userQueue.shift();
		this.currentUserProcessed.send({embed:{
			title: "⏰ It's your turn!",
			color: 16312092,
			description: `The Dodo Code is **${this.dodoCode}**.\nYou have **${queueToSellMinutes} minutes** to connect, sell your turnips, and leave the island.\nOnce your timeslot expires, the next user in the queue will be automatically messaged.\nShould you be done early, please click 👍 to notify that you're done.\nIf you wish to reconnect later to sell more, click 🔁 to be added to the queue again. *Please note that this also ends your turn!*`
		}}).then(msg => {
			msg.react('👍');
			msg.react('🔁');
			const doneCollector = msg.createReactionCollector((r,u) => !u.bot && ['👍','🔁'].includes(r.emoji.name), {time: queueToSellMinutes*60*1000, max: 1});
			doneCollector.on('end', (collected, reason) => {
				if (reason != 'time' && collected.size != 0 && collected.first().emoji.name == '🔁') {
					this.userQueue.push(this.currentUserProcessed);
					msg.channel.send({embed:{
						color: 16711907,
						description: `🔁 You have been added back into the queue at position ${this.userQueuePosition(msg.channel.recipient.id) + 1}. Your turn is over for now.`
					}});
				} else {
					msg.channel.send({embed:{
						color: 4886754,
						description: `🤚 Your turn is now over.`
					}});
				}
				this.currentUserProcessed = null;
				this.update();
			});
		}).catch(err => {
			console.log("Failed to message a user the dodo code, skipping user: "+err);
			this.update();
		});
	}
}

// Variables for the update channel functionality
let updateChannel;
let updateMessage;


function bestStonksEmbed() {
	updateBestStonks();
	embedFields = [];
	for (let i = 0; i < best_stonks.length; i++) {
		if (best_stonks[i] != null) {
			embedFields.push({
				value: `**💰 ${best_stonks[i].price} Bells** for another ${best_stonks[i].timeLeftString()} | <@${best_stonks[i].user.id}>`,
				name: `${moment().tz(best_stonks[i].user.timezone).format("h:mm a")} | ${best_stonks[i].user.friendcode ? best_stonks[i].user.friendcode : "No friendcode specified"}`
			});
		}
	}
	let output = new Discord.MessageEmbed();
	output.author = {name: "📈 current stalnks"};
	output.color = 16711907;
	output.description = "Keep in mind that Nook's Cranny is *usually* open between 8am - 10pm local time.";
	output.fields = embedFields.length > 0 ? embedFields : [{name: "No prices registered so far.", value: "Register your prices with *value"}];
	output.footer = {text: 'Stalnks checked (your local time):'};
	output.timestamp = moment().utc().format();
	return output;
}

function userProfileEmbed(member) {
	if (!userData.hasOwnProperty(member.user.id)) throw new ReferenceError("Profile embed was requested, but user was never registered");
	let output = new Discord.MessageEmbed();
	output.author = {name: member.displayName, icon_url: member.user.avatarURL()};
	output.color = 16711907;
	output.fields = [
		{name: "Friendcode", value: userData[member.user.id].friendcode ? userData[member.user.id].friendcode : "No friendcode registered.", inline: false},
		{name: "Current stonks", value: priceData.hasOwnProperty(member.user.id) ? "**" + priceData[member.user.id].price +" Bells** for another "+ priceData[member.user.id].timeLeftString() : "No active stonks", inline: true},
		{name: "Timezone", value: userData[member.user.id].timezone ? userData[member.user.id].timezone : "No timezone registered.", inline: true},
	];
	output.timestamp = moment().utc().format();
	return output;
}

function sendBestStonksToUpdateChannel() {
	if (!updateChannel) return;
	if (updateMessage) {
		updateMessage.edit(bestStonksEmbed())
			.catch(err => {
				console.log("Error occured while attempting to update the previously sent message: "+err);
			});
	} else {
		updateChannel.send(bestStonksEmbed())
			.catch(err => {
				console.log("Error occured while attempting to send an update message: "+err);
			});
	}
}

const inaccurateTimezones = ['CET', 'EET', 'EST', 'EST5EDT', 'GB', 'HST', 'MET', 'MST', 'PRC', 'ROC', 'ROK', 'UCT','WET', 'Universal', 'Etc/Universal',
	'Etc/GMT', 'Etc/GMT+0', 'Etc/GMT+1', 'Etc/GMT+10','Etc/GMT+11','Etc/GMT+12','Etc/GMT+2','Etc/GMT+3','Etc/GMT+4','Etc/GMT+5','Etc/GMT+6','Etc/GMT+7',
	'Etc/GMT+8','Etc/GMT+9','Etc/GMT-0','Etc/GMT-1','Etc/GMT-10','Etc/GMT-11','Etc/GMT-12','Etc/GMT-13','Etc/GMT-14','Etc/GMT-2','Etc/GMT-3','Etc/GMT-4',
	'Etc/GMT-5','Etc/GMT-6','Etc/GMT-7','Etc/GMT-8','Etc/GMT-9','Etc/GMT0'];

const msgPrefix = '*';
const timezoneInvoker = 'timezone ';
const helpInvoker = 'help';
const fcInvoker = 'friendcode ';
const listInvoker = 'stonks';
const removeInvoker = 'remove';
const profileInvoker = 'profile';
const queueInvoker = 'queue';
const weekInvoker = 'week';
const zoneListURL = "https://gist.github.com/baabaablackgoat/92f7408897f0f7e673d20a1301ca5bea";
const lowercasedTimezones = moment.tz.names().map(tz => tz.toLowerCase());
client.on('message', msg => {
	if (msg.author.bot) return;
	if (msg.channel.type != "text") return;
	if (!msg.content.startsWith(msgPrefix)) return;

	// help i've fallen and I can't get up
	if (msg.content.startsWith(msgPrefix + helpInvoker)) {
		const helpEmbed = new Discord.MessageEmbed({
			author: {name: client.user.username, icon_url: client.user.avatarURL()},
			title: "Hi, I'm stalnks!",
			description: "I try to keep track of ~~stock~~ stalk prices in Animal Crossing.",
			color: 16711907,
			fields: [
				{
					name: "Register",
					value: `To start putting your stalk prices into my database, you have to register your timezone with me first. To do so, use \`${msgPrefix+timezoneInvoker}timeZoneCode\`.\nNote: Avoid using zones like "EST" - these DO NOT account for daylight savings!`
				},
				{
					name: "Adding STONKS",
					value: `To note your current stalk price, just write ${msgPrefix}xxx and I will keep track of your turnip prices. \nYou must be registered to use this!`,
				},
				{
					name: "The queuing system",
					value: `To let you control the flow of players on your island, I can provide you with a simple queuing system! Just type \`${msgPrefix+queueInvoker}\`, and I will talk you through the rest in DMs.\nIf you want to join a queue, just click the reaction I will post beneath it!`
				},
				{
					name: "All commands",
					value: `\`${msgPrefix + timezoneInvoker}\`\t Change your timezone, or show all timezones with \`${msgPrefix + timezoneInvoker}list\`\n\`${msgPrefix + fcInvoker}SW-XXXX-XXXX-XXXX\`\t Set your Switch friendcode on your profile \n\`${msgPrefix + listInvoker}\`\t Show the best current stonks\n\`${msgPrefix + queueInvoker}\`\t Create a queue!\n\`${msgPrefix + removeInvoker}\`\t Remove your price listing. (Admins: Other listings, too)\n\`${msgPrefix + helpInvoker}\`\t Shows this help menu!`,
				},
				{
					name: "Finding your timezone",
					value: `To get your timezone, visit https://baabaablackgoat.com/getTimezone\nAlternatively, here's a list of all available timezones:\n${zoneListURL}`,
				},
				{
					name: "GitHub",
					value: `My code is always available on GitHub:\nhttps://github.com/baabaablackgoat/stalnks/\nFeel free to create issues, fork, or just judge me silently for my bad code!`
				}
			],
			footer: {
				text: "Made with ❤ by baa baa black goat"
			},
		});
		sendDismissableMessage(msg.channel, helpEmbed, msg.author.id);
	}
	// Show profile
	if (msg.content.startsWith(msgPrefix + profileInvoker)) {
		// searched user by mention
		if (msg.mentions.members.size > 0) {
			if (msg.mentions.members.size > 1) {
				const moreThanOneProfileEmbed = new Discord.MessageEmbed({
					author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
					color: 16312092,
					description: `⚠ I can only show one user's profile at a time.`
				});
				sendDismissableMessage(msg.channel, moreThanOneProfileEmbed, msg.author.id);
				return;
			}
			let target = msg.mentions.members.first();
			if (!userData.hasOwnProperty(target.id)) {
				const noMentionedProfileEmbed = new Discord.MessageEmbed({
					author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
					color: 16312092,
					description: `⚠ The mentioned user ${target.user.tag} does not have a profile with me.`
				});
				sendDismissableMessage(msg.channel, noMentionedProfileEmbed, msg.author.id);
				return;
			}
			msg.channel.send(userProfileEmbed(msg.mentions.members.first()));
			return;
		}

		// if there's more data try to find a member by name
		let possibleUsername = msg.content.substring(msgPrefix.length + profileInvoker.length).trim();
		if (possibleUsername.length > 0) {
			msg.guild.members.fetch()
				.then(guildMembers => {
					let target = guildMembers.find(guildMember => guildMember.displayName == possibleUsername);
					if (!target) target = guildMembers.find(guildMember => guildMember.user.username == possibleUsername);
					if (!target) {
						const noMemberWithNameFoundEmbed = new Discord.MessageEmbed({
							author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
							color: 16312092,
							description: `⚠ I couldn't find a member on this server with this name.`
						});
						sendDismissableMessage(msg.channel, noMemberWithNameFoundEmbed, msg.author.id);
						return;
					}
					if (!userData.hasOwnProperty(target.id)) {
						const noProfileEmbed = new Discord.MessageEmbed({
							author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
							color: 16312092,
							description: `⚠ The found user ${target.user.tag} does not have a profile with me.`
						});
						sendDismissableMessage(msg.channel, noProfileEmbed, msg.author.id);
						return;
					}
					sendDismissableMessage(msg.channel, userProfileEmbed(target), msg.author.id);
					return;
				}).catch(err => {
					console.log("Error while fetching guild members to show other users profile: "+err);
					const somethingWentWrongMemberFetchEmbed = new Discord.MessageEmbed({
						author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
						color: 16312092,
						description: `♿ Something went wrong while fetching the server members. Please try again later.`
					});
					sendDismissableMessage(msg.channel, somethingWentWrongMemberFetchEmbed, msg.author.id);
				});
			return;
		}
		// if there's no data, get the profile of the invoking user
		if (!userData.hasOwnProperty(msg.member.id)) {
			const noSelfProfileEmbed = new Discord.MessageEmbed({
				author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
				color: 16312092,
				description: `⚠ You don't have a profile with me!`
			});
			sendDismissableMessage(msg.channel, noSelfProfileEmbed, msg.author.id);
			return;
		}
		sendDismissableMessage(msg.channel, userProfileEmbed(msg.member), msg.author.id); // show invoking member profile;
		return;
	}

	// set/update timezone
	if (msg.content.startsWith(msgPrefix + timezoneInvoker)) {
		timezone = msg.content.substring(msgPrefix.length + timezoneInvoker.length).trim().replace(" ", "_");
		if (timezone == 'list') {
			const timezoneListEmbed = new Discord.MessageEmbed({
				author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
				color: 4886754,
				description: `You can estimate your timezone here:\nhttps://baabaablackgoat.com/getTimezone\n\nAlternatively, here's a list of all available timezones: \n${zoneListURL}`
			});
			sendDismissableMessage(msg.channel, timezoneListEmbed, msg.author.id);
			return;
		}
		if (!moment.tz.names().includes(timezone)) {
			// attempt to find the timezone in a lowercased list
			let tzLowerIndex = lowercasedTimezones.indexOf(timezone.toLowerCase());
			if (tzLowerIndex < 0) { // not retrievable even in lowercase
				const invalidTimezoneEmbed = new Discord.MessageEmbed({
					author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
					color: 16312092,
					description: `⚠ **${timezone} is not a valid timezone.**`,
					fields: [
						{name: "What's my timezone?", value: "You can find your estimated timezone at https://baabaablackgoat.com/getTimezone"},
						{name: "Usage and notes", value: "If you can, please avoid using timezones that apply for larger regions like `EST`, and instead use `America/New_York` to account for things like daylight savings."},
						{name: "All timezones" , value: `Here's a list of all valid timezones: ${zoneListURL}.`}
					]
				});
				sendDismissableMessage(msg.channel, invalidTimezoneEmbed, msg.author.id);
				return;
			} else {
				timezone = moment.tz.names()[tzLowerIndex];
			}
		}
		if (userData.hasOwnProperty(msg.author.id)) userData[msg.author.id].timezone = timezone;
		else userData[msg.author.id] = new userEntry(msg.author.id, timezone, null, null, null);
		if (inaccurateTimezones.includes(timezone)) {
			const confirmDangerousTimezoneSetEmbed = new Discord.MessageEmbed({
				author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
				color: 4289797,
				description: `✅ Your timezone is now set to ${timezone}. It should be ${moment().tz(timezone).format("dddd, MMMM Do YYYY, h:mm:ss a")}.\n**Please note that this timezone does NOT account for things like Daylight Savings.** It is highly recommended to switch to a timezone involving your location.`
			});
			sendDismissableMessage(msg.channel, confirmDangerousTimezoneSetEmbed, msg.author.id);
		} else {
			const confirmTimezoneSetEmbed = new Discord.MessageEmbed({
				author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
				color: 4289797,
				description: `✅ Your timezone is now set to ${timezone}. It should be ${moment().tz(timezone).format("dddd, MMMM Do YYYY, h:mm:ss a")}`
			});
			sendDismissableMessage(msg.channel, confirmTimezoneSetEmbed, msg.author.id);
		}
		return;
	}

	// friendcode handling
	if (msg.content.startsWith(msgPrefix + fcInvoker)) {
		fc = msg.content.substring(msgPrefix.length + fcInvoker.length);
		const fcRegex = /^SW-\d{4}-\d{4}-\d{4}$/;
		if (['remove', 'delete', 'no'].includes(fc)) {
			if (!userData.hasOwnProperty(msg.author.id) || !userData[msg.author.id].friendcode) {
				const noFriendcodeFoundEmbed = new Discord.MessageEmbed({
					author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
					color: 13632027,
					description: `⚠ No friendcode associated with your user was found.`
				});
				sendDismissableMessage(msg.channel, noFriendcodeFoundEmbed, msg.author.id);
				return;
			}
			userData[msg.author.id].friendcode = null;
			const friendcodeRemovedEmbed = new Discord.MessageEmbed({
				author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
				color: 13632027,
				description: `🚮 Your friend code has been removed.`
			});
			sendDismissableMessage(msg.channel, friendcodeRemovedEmbed, msg.author.id);
			return;
		}
		if (!fcRegex.test(fc)) {
			const invalidFriendcodeEmbed = new Discord.MessageEmbed({
				author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
				color: 16312092,
				description: `⚠ Your supplied friend code is invalid. Valid formatting: \`SW-XXXX-XXXX-XXXX\``
			});
			sendDismissableMessage(msg.channel, invalidFriendcodeEmbed, msg.author.id);
			return;
		}
		if (userData.hasOwnProperty(msg.author.id)) {
			userData[msg.author.id].friendcode = fc;
			const friendcodeAddedEmbed = new Discord.MessageEmbed({
				author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
				color: 4289797,
				description: `✅ Your friendcode has been added to your profile.`
			});
			sendDismissableMessage(msg.channel, friendcodeAddedEmbed, msg.author.id);
			return;
		} else {
			userData[msg.author.id] = new userEntry(msg.author.id, null, fc, null, null);
			const profileWithFriendcodeCreatedEmbed = new Discord.MessageEmbed({
				author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
				color: 4289797,
				description: `✅ Your profile with the associated friend code has been created.`
			});
			sendDismissableMessage(msg.channel, profileWithFriendcodeCreatedEmbed, msg.author.id);
			return;
		}
	}

	// list best stonks
	if (msg.content.startsWith(msgPrefix + listInvoker)) {
		msg.channel.send(bestStonksEmbed());
		return;
	}
	// remove a stonk
	if (msg.content.startsWith(msgPrefix + removeInvoker)) {
		if (msg.mentions.members.size > 0) {
			// Check if the user has elevated permissions to remove other entries
			if (!hasElevatedPermissions(msg.member)) {
				const noPermissionRemoveEmbed = new Discord.MessageEmbed({
					author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
					color: 16312092,
					description: `⚠ You don't have permission to remove other users' entries.`
				});
				// THESE MESSAGES ARE PURPOSELY NOT DISMISSABLE TO BLATANTLY SHOW TAMPER ATTEMPTS.
				msg.channel.send(noPermissionRemoveEmbed);
				return;
			}
			if (msg.mentions.members.size > 1) {
				const tooManyMentionsEmbed = new Discord.MessageEmbed({
					author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
					color: 16312092,
					description: `⚠ You've mentioned too many people! I can only remove one price at a time.`
				});
				sendDismissableMessage(msg.channel, tooManyMentionsEmbed, msg.author.id);
				return;
			}

			// Removing the other users' listing
			let target = msg.mentions.members.first();
			if (!priceData.hasOwnProperty(target.id)) {
				const noOtherUserPriceEmbed = new Discord.MessageEmbed({
					author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
					color: 16312092,
					description: `⚠ ${target.user.tag} does not seem to have a registered price.`
				});
				sendDismissableMessage(msg.channel, noOtherUserPriceEmbed, msg.author.id);
				return;
			}
			delete priceData[target.id];
			sendBestStonksToUpdateChannel();
			const removedOtherUserPriceEmbed = new Discord.MessageEmbed({
				author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
				color: 4289797,
				description: `🗑 The listing of ${target.user.tag} has been removed.`
			});
			sendDismissableMessage(msg.channel, removedOtherUserPriceEmbed, msg.author.id);
			return;
		}
		let possibleUsername = msg.content.substring(msgPrefix.length + removeInvoker.length).trim();
		if (possibleUsername.length > 0) {
			// Check if the user has elevated permissions to remove other entries
			if (!hasElevatedPermissions(msg.member)) {
				const noPermissionRemoveEmbed = new Discord.MessageEmbed({
					author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
					color: 16312092,
					description: `⚠ You don't have permission to remove other users' entries.`
				});
				// THESE MESSAGES ARE PURPOSELY NOT DISMISSABLE TO BLATANTLY SHOW TAMPER ATTEMPTS.
				msg.channel.send(noPermissionRemoveEmbed);
				return;
			}
			msg.guild.members.fetch()
				.then(guildMembers => {
					let target = guildMembers.find(guildMember => guildMember.displayName == possibleUsername);
					if (!target) target = guildMembers.find(guildMember => guildMember.user.username == possibleUsername);
					if (!target) {
						const noMemberWithNameFoundEmbed = new Discord.MessageEmbed({
							author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
							color: 16312092,
							description: `⚠ I couldn't find a member on this server with this name.`
						});
						sendDismissableMessage(msg.channel, noMemberWithNameFoundEmbed, msg.author.id);
						return;
					}
					// Removing the other users' listing
					if (!priceData.hasOwnProperty(target.id)) {
						const noOtherUserPriceEmbed = new Discord.MessageEmbed({
							author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
							color: 16312092,
							description: `⚠ ${target.user.tag} does not seem to have a registered price.`
						});
						sendDismissableMessage(msg.channel, noOtherUserPriceEmbed, msg.author.id);
						return;
					}
					delete priceData[target.id];
					sendBestStonksToUpdateChannel();
					const removedOtherUserPriceEmbed = new Discord.MessageEmbed({
						author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
						color: 4289797,
						description: `🗑 The listing of ${target.user.tag} has been removed.`
					});
					sendDismissableMessage(msg.channel, removedOtherUserPriceEmbed, msg.author.id);
					return;
				}).catch(err => {
					console.log("Error while trying to remove a listing from another user: "+err);
					const somethingWentWrongMemberFetchEmbed = new Discord.MessageEmbed({
						author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
						color: 16312092,
						description: `♿ Something went wrong while fetching the server members. Please try again later.`
					});
					sendDismissableMessage(msg.channel, somethingWentWrongMemberFetchEmbed, msg.author.id);
				});
			return;
		}
		// Removing your own listing
		if (!priceData.hasOwnProperty(msg.author.id)) {
			const noSelfListingEmbed = new Discord.MessageEmbed({
				author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
				color: 16312092,
				description: `⚠ You currently don't have any active listings.`
			});
			sendDismissableMessage(msg.channel, noSelfListingEmbed, msg.author.id);
			return;
		}
		delete priceData[msg.author.id];
		sendBestStonksToUpdateChannel();
		const selfListingRemovedEmbed = new Discord.MessageEmbed({
			author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
			color: 4289797,
			description: `🗑 Your listing has been removed.`
		});
		sendDismissableMessage(msg.channel, selfListingRemovedEmbed, msg.author.id);
		return;
	}

	// create queues for players to join one by one
	const validDodoCodeRegex = /(\d|[A-HJ-NP-Z]){5}/;
	if (msg.content.startsWith(msgPrefix + queueInvoker)) {
		if (queueData.hasOwnProperty(msg.author.id)) { // prevent two queues from one user
			const alreadyExistingQueueEmbed = new Discord.MessageEmbed({
				author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
				color: 16312092,
				description: `♿ You seem to already have a running queue!`
			});
			sendDismissableMessage(msg.channel, alreadyExistingQueueEmbed, msg.author.id);
			return;
		}
		// Create a new queue
		queueData[msg.author.id] = new queueEntry(msg.author.id);
		msg.author.send({embed: {
			author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
			color: 16711907,
			description: `ℹ Please send your Dodo-Code™ as a direct DM to me.\nIf you wish to add more information, simply put it in *the same message* seperated from the Dodo-Code™ with a single space. Keep your additional information PG, please.\nExample: \`A1BC2 Nook's Cranny is in the top left corner!\`\n **This request will expire in 3 minutes.**`
		}})
			.then(dmMsg => {
				// Create a message collector in the DM Channel of the creating user to collect the dodo code and potential additional information.
				const dodoCodeCollector = dmMsg.channel.createMessageCollector(m => !m.author.bot && validDodoCodeRegex.test(m.content.substring(0,6).trim().toUpperCase()), {time: 3*60*1000, max: 1});
				let informationMessage;
				let informationEmbed;
				dodoCodeCollector.on('end', (collected, reason) => {
					if (reason == 'time' || collected.size != 1) {
						dmMsg.edit({embed: {
							author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
							color: 16312092,
							description: `⚠ This queue creation request has expired, or the sent message was invalid.`
						}});
						// Update the queue info message to notify users this queue was never created.
						if (informationMessage) {
							informationEmbed.description = `❌ This queue has been cancelled or has timed out on creation.`;
							informationMessage.edit(informationEmbed);
						}
						delete queueData[msg.author.id];
						return;
					}
					else {
						dmMsg.edit({embed: {
							author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
							color: 4289797,
							description: `✅ Your Dodo code and possible additional information have been added. Queueing will now commence.`
						}});
						// Update the new queue entry with the collected message
						const collectedCreatorMessage = collected.first() ;
						queueData[msg.author.id].dodoCode = collectedCreatorMessage.content.substring(0,5).toUpperCase();
						if (collectedCreatorMessage.content.substring(6).trim().length != 0) queueData[msg.author.id].addlInformation = collectedCreatorMessage.content.substring(6, 1000).trim();

						// Update the queue info message to contain useful data.
						if (informationMessage) {
							informationEmbed.description = `ℹ If you wish to join this queue, react to this message with 📈. **This queue will close in ${queueAcceptingMinutes} minutes from creation.**`; // TODO Change this
							informationEmbed.fields = [
								{name: "Stalk price", value: priceData.hasOwnProperty(msg.author.id) ? priceData[msg.author.id].price + " Bells" : "Unknown", inline: false},
								{name: "Additional information", value: queueData[msg.author.id].addlInformation, inline: false}
							];
							informationMessage.edit(informationEmbed);
						}
						// Update said queue to allow processing of users.
						queueData[msg.author.id].update();
					}
				});

				// Create a message for users to react to to join the queue.
				informationEmbed = new Discord.MessageEmbed();
				informationEmbed.author = {name: msg.member.displayName, icon_url: msg.author.avatarURL()};
				informationEmbed.color = 16711907;
				informationEmbed.description = `ℹ A queue is currently being set up for **${priceData.hasOwnProperty(msg.author.id) ? priceData[msg.author.id].price : "an unknown amount of"} Bells.**\n If you wish to join this queue, react to this message with 📈. **This queue will close in ${queueAcceptingMinutes} minutes.**`; // TODO CHange this
				informationEmbed.timestamp = moment().utc().format();
				msg.channel.send(informationEmbed).then(reactionJoinMsg => {
						informationMessage = reactionJoinMsg;
						reactionJoinMsg.react("📈");
						const joinReactionCollector = reactionJoinMsg.createReactionCollector((r,u) => !u.bot && u.id != msg.author.id && r.emoji.name == "📈", {time: queueAcceptingMinutes*60*1000});
						joinReactionCollector.on('collect', (reaction, reactingUser) => {
							//Prevent users from queuing up multiple times
							if (queueData[msg.author.id].userQueue.filter(e => e.id == reactingUser.id).length > 0) return;
							//Add the reacting user to the queue and fire an update on the queue (in case it is empty to immediately allow the user to join)
							let addedToQueueEmbed = new Discord.MessageEmbed({
								color: 16711907,
								description: `You have been added to the queue. Your position is [CALCULATING...].\nIf you wish to leave the queue, click 👋.` 
							});
							reactingUser.send(addedToQueueEmbed) // make sure first that DMs are enabled by this user then add them to the queue
							.then(confirmationMsg => {
								// Add user to queue and update the queue
								queueData[msg.author.id].userQueue.push(reactingUser);
								// Add the queue position
								addedToQueueEmbed.description = addedToQueueEmbed.description.replace("[CALCULATING...]", queueData[msg.author.id].userQueuePosition(reactingUser.id) + 1); 
								confirmationMsg.edit(addedToQueueEmbed);
								// Update the queue
								queueData[msg.author.id].update();
								
								// Users unqueueing from the queue
								confirmationMsg.react('👋');
								const leaveQueueCollector = confirmationMsg.createReactionCollector((r,u) => !u.bot && r.emoji.name == '👋', {time: queueAcceptingMinutes*60*1000, max: 1});
								leaveQueueCollector.on('collect', (leaveR, leavingUser) => {
									if (!queueData.hasOwnProperty(msg.author.id)) return; // just in case the queue was already deleted
									let foundUserIndex = queueData[msg.author.id].userQueue.findIndex(queue_u => queue_u.id == leavingUser.id);
									if (foundUserIndex >= 0) {
										queueData[msg.author.id].userQueue.splice(foundUserIndex, 1);
										leavingUser.send({embed: { // make sure first that DMs are enabled by this user then add them to the queue
											color: 16711907,
											description: `You have been removed from the queue.`
										}});
									}
								});
							}).catch(err => console.log("Failed to add reacting user to queue, aborting: "+err));
						});
						joinReactionCollector.on('end', (collected, reason) => {
							if (queueData.hasOwnProperty(msg.author.id)) queueData[msg.author.id].acceptingEntries = false;
							reactionJoinMsg.edit({embed: {
								author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
								color: 16711907,
								description: `🛑 Signup for this queue has been closed, and no further entries will be accepted.`
								}});
							queueData[msg.author.id].update();
						});
					});
			})
			.catch(err => { // something went wrong while writing the DM to the creator.
				msg.channel.send({embed: {
					author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
					color: 16312092,
					description: `⚠ I was unable to send you a direct message. Please enable direct messages for this server.`
				}});
			});
	}

	if (msg.content.startsWith(msgPrefix + weekInvoker)) {
		if (!userData.hasOwnProperty(msg.author.id)) { // check if profile exists
			const noProfileWeekStats = new Discord.MessageEmbed({
				author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
				color: 16312092,
				description: `⚠ You didn't register a profile with me so far.`
			});
			sendDismissableMessage(msg.channel, noProfileWeekStats, msg.author.id);
			return;
		}
		let weekPrices = userData[msg.author.id].weekPrices;
		let filledWeekPrices = userData[msg.author.id].filledWeekPrices;
		let weeks = [
			["Mon", 1],
			["Tue", 3],
			["Wed", 5],
			["Thu", 7],
			["Fri", 9],
			["Sat", 11],
		];
		const weekStatEmbed = new Discord.MessageEmbed({
			author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
			title: "Your week's (registered) prices",
			color: 16711907,
			fields: [ // holy shit this is ugly please make it stop and beautiful
				{name: "Purchased for", value: `${weekPrices[0] ? weekPrices[0] : "???"} Bells`},
			].concat(weeks.map(([day,idx]) => {
				return {
					name: day,
					value: `${weekPrices[idx] ? weekPrices[idx] : "???"} / ${weekPrices[idx+1] ? weekPrices[idx+1] : "???"} Bells`,
					inline: true,
				};
			})).concat([
				{
					name: "turnipprophet.io - Predictions link",
					value: `**https://turnipprophet.io?prices=${filledWeekPrices.join('.')}**\nPlease note that turnipprophet.io was NOT made by me, and leads to said external site. I don't have control over the things shown there, only about the price input.`,
					inline: false}
			])
		});
		sendDismissableMessage(msg.channel, weekStatEmbed, msg.author.id);
	}

	// actual stonks handling ("default case")
	let tokens = msg.content.split(" ");
	let interval;
	if (tokens.length > 1) {
		let rawInterval = tokens[1].toLowerCase();
		interval = Number(rawInterval);
	}
	stonks_value = Number(tokens[0].substring(1));

	if (isNaN(stonks_value)) return;
	if (!userData.hasOwnProperty(msg.author.id) || !userData[msg.author.id].timezone) {
		const registerTimezoneFirstEmbed = new Discord.MessageEmbed({
			author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
			color: 16312092,
			description: `⚠ Please register your timezone with me by using \`${msgPrefix + timezoneInvoker}timezoneCode\` first.`
		});
		sendDismissableMessage(msg.channel, registerTimezoneFirstEmbed, msg.author.id);
		return;
	}
	let localTime = moment().tz(userData[msg.author.id].timezone);
	if (localTime.weekday() == 7) {
		const sundayEmbed = new Discord.MessageEmbed({
			author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
			color: 16312092,
			description: `⚠ It is Sunday on your island.`
		});
		sendDismissableMessage(msg.channel, sundayEmbed, msg.author.id);
		return;
	}
	if (stonks_value < 0 || stonks_value > 1000 || stonks_value % 1 != 0) {
		const invalidStalkPriceEmbed = new Discord.MessageEmbed({
			author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
			color: 16312092,
			description: `⚠ Invalid stalk price specified.`
		});
		sendDismissableMessage(msg.channel, invalidStalkPriceEmbed, msg.author.id);
		return;
	}
	if (interval !== undefined) {
		if (interval >= 0 && interval < 13) {
			let weekDayName = moment().day(Math.floor(interval + 1) / 2).format('dddd');
			if (interval != 0) {
				weekDayName += interval % 2 ? ' AM' : ' PM';
			}
			userData[msg.author.id].weekPrices[interval] = stonks_value;
			msg.channel.send({embed: {
				author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
				color: 4289797,
				description: `💰 updated listing: **${stonks_value} Bells** for ${weekDayName}`
			}});
		} else {
			const invalidIntervalEmbed = new Discord.MessageEmbed({
				author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
				color: 16312092,
				description: `⚠ Invalid interval specified.`
			});
			sendDismissableMessage(msg.channel, invalidIntervalEmbed, msg.author.id);
		}
		return;
	}
	if (priceData.hasOwnProperty(msg.author.id)) {
		priceData[msg.author.id].updatePrice(stonks_value);
		msg.channel.send({embed: {
			author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
			color: 4289797,
			description: `💰 updated listing: **${stonks_value} Bells**, expires in ${priceData[msg.author.id].timeLeftString()}`
		}});
		sendBestStonksToUpdateChannel();
		return;
	} else {
		priceData[msg.author.id] = new priceEntry(msg.author.id, stonks_value);
		msg.channel.send({embed: {
			author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
			color: 4289797,
			description: `💰 new listing: **${stonks_value} Bells**, expires in ${priceData[msg.author.id].timeLeftString()}`
		}});
		sendBestStonksToUpdateChannel();
		return;
	}
});

client.on('ready', () => {
	console.log(`stalnks. logged in as ${client.user.tag}`);

	// get stuff about the channel and the possibly editable message
	updateChannelID = getEnv('DISCORD_STONKS_UPDATECHANNELID', false);

	if (updateChannelID) {
		client.channels.fetch(updateChannelID)
			.then(channel => {
				updateChannel = channel;
				channel.messages.fetch({limit:10})
					.then(messages => {
						let lastMessage = messages.filter(m => m.author.id == client.user.id).sort((a,b) => b.createdTimestamp - a.createdTimestamp).first();
						if (!lastMessage) {
							updateChannel.send(bestStonksEmbed()).then(message => {
								if (message.editable) {
									updateMessage = message;
									console.log("Created a new editable update message. Updates will edit this message.");
								} else {
									console.log("Created a new update message, but it isn't editable. Updates will be sent as new messages.");
								}
							});
						} else {
							if (lastMessage.editable) {
								updateMessage = lastMessage;
								console.log("Found valid last update message. Updates will edit this message.");
								sendBestStonksToUpdateChannel();
							} else {
								console.log("Last update message was found, but isn't editable. Updates will be sent as new messages.");
								sendBestStonksToUpdateChannel();
							}
						}
					})
					.catch(err => {
						updateChannel = false;
						console.log("Error occured while attempting to fetch messages from channel: "+err+ "\nAssuming channel is inaccessible. No updates will be sent.");
					});
			})
			.catch(err => {
				updateChannel = false;
				console.error("Error occured while attempting to fetch update channel: "+err+"\nNo updates will be sent.");
			});
	} else {
		console.log("No channel was specified as an environment variable. No updates will be sent.");
	}
});

client.login(getEnv('DISCORD_STONKS_TOKEN'));