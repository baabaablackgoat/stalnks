const fs = require('fs');
const moment = require('moment-timezone');
const Discord = require('discord.js');
const client = new Discord.Client();

// timezone & friend code data 
const userDataPath = './data/userData.json';
let userData = {}; // this shall store the timezones of our users
const priceDataPath = './data/priceData.json';
let priceData = {}; // this will be some form of an ordered list

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
					userData[key] = new userEntry(key, rawData[key].timezone, rawData[key].friendcode);
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
						priceData[key] = new priceEntry(key, rawData[key].price, rawData[key].expiresAt);
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
	console.debug(`Removed ${del_counter} expired entries`);
	// if (del_counter > 0) { updateBestStonks(); }
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




class userEntry { // there doesn't seem to be anything non-experimental for private fields
	constructor(id, timezone, friendcode = null) {
		this.id = id; // probably redundant
		this.timezone = timezone;
		this.friendcode = friendcode;
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

	updatePrice(price) {
		if (isNaN(price) || price < 0 || price > 1000 || price % 1 != 0) throw new RangeError("Supplied price "+price+" is invalid");
		let now_tz = moment().tz(userData[this.user.id].timezone); // the current time, adjusted with the timezone of the user.
		if (now_tz.weekday() == 7) throw new RangeError("Cannot create offers on a sunday - turnips arent sold on sundays.");
		this.price = price;
		this.expiresAt = now_tz.hour() < 12 ? now_tz.clone().hour(12).minute(0).second(0).millisecond(0) : now_tz.clone().hour(24).minute(0).second(0).millisecond(0);
		// updateBestStonks();
	}
}

const msgPrefix = '*';
const timezoneInvoker = 'timezone ';
const helpInvoker = 'help';
const fcInvoker = 'friendcode ';
const listInvoker = 'stonks';
const removeInvoker = 'remove';
const zoneListURL = "https://gist.github.com/baabaablackgoat/92f7408897f0f7e673d20a1301ca5bea";
client.on('message', msg => {
	if (msg.author.bot) return;
	if (msg.channel.type != "text") return;
	if (!msg.content.startsWith(msgPrefix)) return;

	// help i've fallen and I can't get up
	if (msg.content.startsWith(msgPrefix + helpInvoker)) {
		msg.channel.send({embed: {
			author: {name: client.user.displayName, icon_url: client.user.avatarURL()},
			description: "Hi, I'm stalnks! I try to keep track of ~~stock~~ stalk prices in Animal Crossing.",
			color: 16711907,
			fields: [
				{
					name: "Register",
					value: `To start putting your stalk prices into my database, you have to register your timezone with me first.\nTo do so, use \`${msgPrefix+timezoneInvoker} timeZoneCode\`.\nNote: Avoid using zones like "EST" - these DO NOT account for daylight savings!\nA list of zones can be found here: ${zoneListURL}`
				},
				{
					name: "Adding STONKS",
					value: `To note your current stalk price, just write ${msgPrefix}xxx and I will keep track of your turnip prices. \nYou must be registered to use this!`,
				},
				{
					name: "All commands",
					value: `\`${msgPrefix + timezoneInvoker}\` Change your timezone, or show all timezones with \`${msgPrefix + timezoneInvoker} list\`\n\`${msgPrefix + fcInvoker} SW-XXXX-XXXX-XXXX\` Set your Switch friendcode on your profile \n${msgPrefix + listInvoker} Show the best current stonks\n${msgPrefix + helpInvoker} Shows this help menu!`,
				}
			],
			footer: {
				text: "Made with ❤ by baa baa black goat"
			},
			description: `📝 Here's a list of all available timezones: ${zoneListURL}`
		}});
	}

	// set/update timezone
	if (msg.content.startsWith(msgPrefix + timezoneInvoker)) {
		timezone = msg.content.substring(msgPrefix.length + timezoneInvoker.length);
		if (timezone == 'list') {
			msg.channel.send({embed: {
				author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
				color: 4886754,
				description: `📝 Here's a list of all available timezones: https://gist.github.com/baabaablackgoat/92f7408897f0f7e673d20a1301ca5bea`
			}});
			return;
		}
		if (!moment.tz.names().includes(timezone)) {
			msg.channel.send({embed: {
				author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
				color: 16312092,
				description: `⚠ ${timezone} is not a valid timezone.`
			}});
			return;
		}
		if (userData.hasOwnProperty(msg.author.id)) userData[msg.author.id].timezone = timezone;
		else userData[msg.author.id] = new userEntry(msg.author.id, timezone);
		msg.channel.send({embed: {
			author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
			color: 4289797,
			description: `✅ Your timezone is now set to ${timezone}. It should be ${moment().tz(timezone).format("dddd, MMMM Do YYYY, h:mm:ss a")}`
		}});
		return;
	}

	// friendcode handling
	if (msg.content.startsWith(msgPrefix + fcInvoker)) {
		fc = msg.content.substring(msgPrefix.length + fcInvoker.length);
		if (!userData.hasOwnProperty(msg.author.id)) {
			msg.channel.send({embed: {
				author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
				color: 16312092,
				description: `⚠ Please register your timezone before registering your friendcode.`
			}});
			return;
		}
		const fcRegex = /^SW-\d{4}-\d{4}-\d{4}$/;
		if (['remove', 'delete', 'no'].includes(fc)) {
			userData[msg.author.id].friendcode = null;
			msg.channel.send({embed: {
				author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
				color: 13632027,
				description: `🚮 Your friend code has been removed.`
			}});
			return;
		}
		if (!fcRegex.test(fc)) {
			msg.channel.send({embed: {
				author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
				color: 16312092,
				description: `⚠ Your supplied friend code is invalid. Valid formatting: \`SW-XXXX-XXXX-XXXX\``
			}});
			return;
		}
		userData[msg.author.id].friendcode = fc;
		msg.channel.send({embed: {
			author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
			color: 4289797,
			description: `✅ Your friendcode has been added to your profile.`
		}});
		return;
	}

	// list best stonks
	if (msg.content.startsWith(msgPrefix + listInvoker)) {
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
		msg.channel.send({
			embed: {
				author: {
					name: "📈 current stalnks", url: client.user.avatarURL(),
				},
				color: 16711907,
				description: "Keep in mind that Nook's Cranny is *usually* open between 8am - 10pm local time.",
				fields: embedFields.length > 0 ? embedFields : [{name: "No prices registered so far.", value: "Register your prices with *value"}],
				footer: {
					text: 'Stalnks checked (your local time):'
				},
				timestamp: moment().utc().format()
			}
		});
		return;
	}
	// remove a stonk
	if (msg.content.startsWith(msgPrefix + removeInvoker)) {
		msg.channel.send("i'll add this soon promised");
		return;
	}

	// actual stonks handling
	stonks_value = Number(msg.content.substring(msgPrefix.length));
	if (isNaN(stonks_value)) return;
	if (!userData.hasOwnProperty(msg.author.id)) {
		msg.channel.send({embed: {
			author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
			color: 16312092,
			description: `⚠ Please register your timezone with me by using \`${msgPrefix + timezoneInvoker}timezoneCode\` first.`
		}});
		return;
	}
	let localTime = moment().tz(userData[msg.author.id].timezone);
	if (localTime.weekday() == 7) {
		msg.channel.send({embed: {
			author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
			color: 16312092,
			description: `⚠ It is Sunday on your island.`
		}});
		return;
	}
	if (stonks_value < 0 || stonks_value > 1000 || stonks_value % 1 != 0) {
		msg.channel.send({embed: {
			author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
			color: 16312092,
			description: `⚠ Invalid stalk price specified.`
		}});
		return;
	}
	if (priceData.hasOwnProperty(msg.author.id)) {
		priceData[msg.author.id].updatePrice(stonks_value);
		msg.channel.send({embed: {
			author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
			color: 4289797,
			description: `💰 updated listing: **${stonks_value} Bells**, expires in ${priceData[msg.author.id].timeLeftString()}`
		}});
		return;
	} else {
		priceData[msg.author.id] = new priceEntry(msg.author.id, stonks_value);
		msg.channel.send({embed: {
			author: {name: msg.member.displayName, icon_url: msg.author.avatarURL()},
			color: 4289797,
			description: `💰 new listing: **${stonks_value} Bells**, expires in ${priceData[msg.author.id].timeLeftString()}`
		}});
		return;
	}
});

client.on('ready', () => {
	console.log(`stalnks. logged in as ${client.user.tag}`);
});

client.login(process.env.DISCORD_STONKS_TOKEN);