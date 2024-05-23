const { SlashCommandBuilder } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('ping')
		.setDescription('Pings the bot, pongs the user.'),
	async execute(interaction) {
		console.log(interaction);
		await interaction.reply(`I see you... <@${interaction.user.id}>`);
	},
};