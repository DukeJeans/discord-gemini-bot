require('dotenv').config();
const { VertexAI } = require('@google-cloud/vertexai');
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, Events, GatewayIntentBits } = require('discord.js');

const client = new Client({ intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
] });
client.commands = new Collection();

client.once(Events.ClientReady, readyClient => {
    console.log(`Logged in as ${readyClient.user.tag}`);
});

boot();

client.on('messageCreate', message => {
    if (message.mentions.users.has(client.user.id)) {
        createStreamChat(message);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) {
        console.log('test'); return;
    }

	const command = interaction.client.commands.get(interaction.commandName);

	if (!command) {
		console.error(`No command matching ${interaction.commandName} was found.`);
		return;
	}

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
        } else {
            await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
        }
    }
})

async function createStreamChat(message) {
    projectId = process.env.PROJECT_ID,
    location = process.env.LOCATION,
    model = 'gemini-1.0-pro-002'
    // Initialize Vertex with your Cloud project and location
    const vertexAI = new VertexAI({project: projectId, location: location});
  
    // Instantiate the model
    const generativeModel = vertexAI.getGenerativeModel({
      model: model,
    });
  
    const chat = generativeModel.startChat({});
    const chatInput1 = message.content.slice(22);
  
    console.log(`User: ${chatInput1}`);
  
    const result1 = await chat.sendMessageStream(chatInput1);
    let concatenatedResult = '';
    for await (const item of result1.stream) {
        if(item.candidates[0].content.parts[0]) {
            console.log(item.candidates[0].content.parts[0].text);
            concatenatedResult += item.candidates[0].content.parts[0].text;
        }
    }
    message.reply(concatenatedResult);
  }

function boot() {
    console.log('Compiling commands...');
    compileCommandsCollection();
    console.log('Logging in...');
    client.login(process.env.BOT_TOKEN);
}

function compileCommandsCollection() {
    const foldersPath = path.join(__dirname, 'commands');
    const commandFolders = fs.readdirSync(foldersPath);
    
    for (const folder of commandFolders) {
        const commandsPath = path.join(foldersPath, folder);
        const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
        for (const file of commandFiles) {
            const filePath = path.join(commandsPath, file);
            const command = require(filePath);
            // Set a new item in the Collection with the key as the command name and the value as the exported module
            if ('data' in command && 'execute' in command) {
                client.commands.set(command.data.name, command);
            } else {
                console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
            }
        }
    }
}