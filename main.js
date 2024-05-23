require('dotenv').config();
const {VertexAI} = require('@google-cloud/vertexai');
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, Events, GatewayIntentBits } = require('discord.js');

const vertex = new VertexAI({project: process.env.PROJECT_ID, location: process.env.LOCATION});
const generativeModel = vertex.preview.getGenerativeModel({
    model: process.env.MODEL,
    generationConfig: {
      'maxOutputTokens': 1500,
      'temperature': 1,
      'topP': 1,
    },
    safetySettings: [
      {
          'category': 'HARM_CATEGORY_HATE_SPEECH',
          'threshold': 'BLOCK_ONLY_HIGH'
      },
      {
          'category': 'HARM_CATEGORY_DANGEROUS_CONTENT',
          'threshold': 'BLOCK_ONLY_HIGH'
      },
      {
          'category': 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
          'threshold': 'BLOCK_ONLY_HIGH'
      },
      {
          'category': 'HARM_CATEGORY_HARASSMENT',
          'threshold': 'BLOCK_ONLY_HIGH'
      }
    ],
});

const streamChat = generativeModel.startChat({})

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
    // console.log(message);
    console.log(`Author: ${message.author.username}`);
    console.log(`Author: ${message.author.globalName}`);
    message.channel.sendTyping();
  
    // const chat = generativeModel.startChat({});
    const messageContent = message.content.startsWith('<@') ? message.content.slice(22) : message.content;

    console.log(messageContent);

    const streamResult = await streamChat.sendMessageStream(messageContent);
    const streamResponse = await streamResult.response;
    const discordResponse = streamResponse.candidates[0].content.parts[0].text;
  
    // const responseStream = await chat.sendMessageStream(chatInput1);
    // let aggragatedResponse = await responseStream.response;
    // let reply = aggragatedResponse.candidates[0].content.parts[0].text
    // console.log(reply)
    if(discordResponse) message.reply(discordResponse.substring(0, 2000));
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