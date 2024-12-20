const { SlashCommandBuilder } = require('discord.js');
const fs = require('node:fs');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('personality')
        .setDescription('Change the bot\'s generative personality.')
        .addStringOption(option =>
            option.setName('personality')
                .setDescription('The type of individual the bot should start acting like')
                .setRequired(true)),
    async execute(interaction) {
        await interaction.deferReply();

        let config;
        try {
            const data = fs.readFileSync('./botConfig.json');
            config = JSON.parse(data);
        } catch (err) {
            console.error('Failed to read botConfig.json:', err);
            return interaction.editReply('Failed to update personality. Please check the logs.');
        }

        config.personality = interaction.options.getString('personality'); 

        try {
            fs.writeFileSync('./botConfig.json', JSON.stringify(config, null, 2));
            interaction.editReply(`Personality set to: ${config.personality}`);
        } catch (err) {
            console.error('Failed to write to botConfig.json:', err);
            return interaction.editReply('Failed to update personality. Please check the logs.');
        }
    },
};